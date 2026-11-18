"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type TextareaHTMLAttributes,
} from "react";

import {
  isSafeSiteHref,
  type RichNode,
  type RichSpan,
  type RichText,
} from "@capital-q/contracts";

/**
 * Inline editing for the content editor (decision 107).
 *
 * `RichTextEditable` is a contentEditable region that only ever holds what
 * the block model can say: paragraphs and lists of text with bold, italic
 * and safe links. The DOM is BUILT from that model with createElement and
 * textContent (never innerHTML), and READ back by walking it and keeping
 * only text and those three marks, so pasted markup, scripts, styles or
 * event attributes have nowhere to live. Paste inserts plain text.
 *
 * `InlineText` is an auto-growing textarea styled as the text it edits,
 * for headings, titles, questions and labels.
 */

function buildInto(root: HTMLElement, value: RichText): void {
  const doc = root.ownerDocument;
  root.replaceChildren();
  const spansInto = (parent: HTMLElement, spans: readonly RichSpan[]) => {
    for (const span of spans) {
      let node: Node = doc.createTextNode(span.text);
      if (span.italic === true) {
        const em = doc.createElement("em");
        em.append(node);
        node = em;
      }
      if (span.bold === true) {
        const strong = doc.createElement("strong");
        strong.append(node);
        node = strong;
      }
      if (span.href !== undefined && isSafeSiteHref(span.href)) {
        const a = doc.createElement("a");
        a.setAttribute("href", span.href);
        a.append(node);
        node = a;
      }
      parent.append(node);
    }
  };
  const nodes =
    value.length === 0 ? [{ kind: "paragraph" as const, spans: [] }] : value;
  for (const node of nodes) {
    if (node.kind === "paragraph") {
      const p = doc.createElement("p");
      spansInto(p, node.spans);
      if (node.spans.length === 0) p.append(doc.createElement("br"));
      root.append(p);
    } else {
      const list = doc.createElement(node.ordered ? "ol" : "ul");
      for (const item of node.items) {
        const li = doc.createElement("li");
        spansInto(li, item);
        if (item.length === 0) li.append(doc.createElement("br"));
        list.append(li);
      }
      root.append(list);
    }
  }
}

type Marks = { bold: boolean; italic: boolean; href: string | null };

function spansOf(element: Node, inherited: Marks, out: RichSpan[]): void {
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === 3) {
      const text = (child.textContent ?? "").replace(/\u00a0/gu, " ");
      if (text === "") continue;
      const last = out.at(-1);
      const same =
        last !== undefined &&
        (last.bold === true) === inherited.bold &&
        (last.italic === true) === inherited.italic &&
        (last.href ?? null) === inherited.href;
      if (same) {
        out[out.length - 1] = { ...last, text: last.text + text };
      } else {
        out.push({
          text,
          ...(inherited.bold ? { bold: true as const } : {}),
          ...(inherited.italic ? { italic: true as const } : {}),
          ...(inherited.href !== null ? { href: inherited.href } : {}),
        });
      }
      continue;
    }
    if (!(child instanceof HTMLElement)) continue;
    const tag = child.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEMPLATE") continue;
    if (tag === "BR") continue;
    const href = tag === "A" ? child.getAttribute("href") : null;
    spansOf(
      child,
      {
        bold:
          inherited.bold ||
          tag === "B" ||
          tag === "STRONG" ||
          Number.parseInt(child.style.fontWeight || "0", 10) >= 600,
        italic: inherited.italic || tag === "I" || tag === "EM",
        href: href !== null && isSafeSiteHref(href) ? href : inherited.href,
      },
      out,
    );
  }
}

const PLAIN: Marks = { bold: false, italic: false, href: null };

function readFrom(root: HTMLElement): RichText {
  const out: RichNode[] = [];
  let loose: RichSpan[] = [];
  const flushLoose = () => {
    if (loose.length > 0) out.push({ kind: "paragraph", spans: loose });
    loose = [];
  };
  for (const child of Array.from(root.childNodes)) {
    if (
      child instanceof HTMLElement &&
      (child.tagName === "UL" || child.tagName === "OL")
    ) {
      flushLoose();
      const items: RichSpan[][] = [];
      for (const li of Array.from(child.children)) {
        const spans: RichSpan[] = [];
        spansOf(li, PLAIN, spans);
        items.push(spans);
      }
      out.push({ kind: "list", ordered: child.tagName === "OL", items });
    } else if (
      child instanceof HTMLElement &&
      (child.tagName === "P" ||
        child.tagName === "DIV" ||
        /^H[1-6]$/u.test(child.tagName))
    ) {
      flushLoose();
      const spans: RichSpan[] = [];
      spansOf(child, PLAIN, spans);
      out.push({ kind: "paragraph", spans });
    } else {
      const holder = root.ownerDocument.createElement("span");
      holder.append(child.cloneNode(true));
      spansOf(holder, PLAIN, loose);
    }
  }
  flushLoose();
  // Trailing empty paragraphs are an artefact of the caret, not content.
  while (out.length > 1) {
    const last = out.at(-1);
    if (last?.kind === "paragraph" && last.spans.length === 0) out.pop();
    else break;
  }
  return out;
}

const isEmpty = (value: RichText) =>
  value.every((node) =>
    node.kind === "paragraph"
      ? node.spans.every((s) => s.text.trim() === "")
      : node.items.length === 0,
  );

export function RichTextEditable({
  value,
  onChange,
  placeholder,
  label,
  className = "",
}: {
  readonly value: RichText;
  readonly onChange: (next: RichText) => void;
  readonly placeholder: string;
  readonly label: string;
  readonly className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const emitted = useRef<RichText | null>(null);
  const [focused, setFocused] = useState(false);
  const [empty, setEmpty] = useState(isEmpty(value));
  const [linking, setLinking] = useState<string | null>(null);
  const savedRange = useRef<Range | null>(null);
  const toolbarId = useId();

  // Rebuild only when the value changed from outside (undo, restore, load);
  // the person's own typing is already in the DOM.
  useLayoutEffect(() => {
    const root = ref.current;
    if (root === null || emitted.current === value) return;
    buildInto(root, value);
    setEmpty(isEmpty(value));
  }, [value]);

  const emit = () => {
    const root = ref.current;
    if (root === null) return;
    const next = readFrom(root);
    emitted.current = next;
    setEmpty(isEmpty(next));
    onChange(next);
  };

  const command = (name: string, argument?: string) => {
    ref.current?.focus();
    // execCommand is deprecated but remains the one cross-browser way to
    // toggle marks inside contentEditable with native undo.
    document.execCommand(name, false, argument);
    emit();
  };

  const startLink = () => {
    const selection = window.getSelection();
    if (selection === null || selection.rangeCount === 0) return;
    savedRange.current = selection.getRangeAt(0).cloneRange();
    setLinking("");
  };

  const applyLink = (href: string) => {
    const selection = window.getSelection();
    const range = savedRange.current;
    setLinking(null);
    if (selection === null || range === null) return;
    ref.current?.focus();
    selection.removeAllRanges();
    selection.addRange(range);
    if (href === "") document.execCommand("unlink");
    else if (isSafeSiteHref(href))
      document.execCommand("createLink", false, href);
    emit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === "k") {
      event.preventDefault();
      startLink();
    }
  };

  const tool =
    "cq-cms-press inline-flex size-8 items-center justify-center rounded-(--cq-radius-sm) text-(--cq-text-secondary) hover:bg-(--cq-surface-subtle) hover:text-(--cq-text-primary)";

  return (
    <div className="relative">
      {focused || linking !== null ? (
        <div
          id={toolbarId}
          role="toolbar"
          aria-label="Text formatting"
          className="absolute -top-11 left-0 z-(--cq-z-popover) flex items-center gap-0.5 rounded-(--cq-radius-md) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-1 shadow-(--cq-shadow-overlay)"
          onMouseDown={(event) => {
            // Keep the selection in the text while a tool is pressed.
            if (!(event.target instanceof HTMLInputElement))
              event.preventDefault();
          }}
        >
          {linking === null ? (
            <>
              <button
                type="button"
                className={tool}
                aria-label="Bold"
                onClick={() => command("bold")}
              >
                <b className="text-[15px]">B</b>
              </button>
              <button
                type="button"
                className={tool}
                aria-label="Italic"
                onClick={() => command("italic")}
              >
                <i className="font-serif text-[15px]">I</i>
              </button>
              <button
                type="button"
                className={tool}
                aria-label="Link"
                onClick={startLink}
              >
                <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
                  <path
                    d="M6.5 9.5l3-3M5 11a2.5 2.5 0 010-3.5l1.5-1.5M11 5a2.5 2.5 0 010 3.5L9.5 10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
              <span
                aria-hidden="true"
                className="mx-1 h-5 w-px bg-(--cq-border-subtle)"
              />
              <button
                type="button"
                className={tool}
                aria-label="Bulleted list"
                onClick={() => command("insertUnorderedList")}
              >
                <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
                  <circle cx="3" cy="4.5" r="1" fill="currentColor" />
                  <circle cx="3" cy="11.5" r="1" fill="currentColor" />
                  <path
                    d="M6 4.5h7M6 11.5h7"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
              <button
                type="button"
                className={tool}
                aria-label="Numbered list"
                onClick={() => command("insertOrderedList")}
              >
                <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
                  <text x="1.2" y="6.4" fontSize="5" fill="currentColor">
                    1
                  </text>
                  <text x="1.2" y="13.4" fontSize="5" fill="currentColor">
                    2
                  </text>
                  <path
                    d="M6 4.5h7M6 11.5h7"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </>
          ) : (
            <form
              data-q-editing=""
              className="flex items-center gap-1"
              onSubmit={(event) => {
                event.preventDefault();
                applyLink(linking.trim());
              }}
            >
              <input
                ref={(element) => element?.focus()}
                aria-label="Link address"
                placeholder="/pricing, #anchor, https://… or mailto:…"
                value={linking}
                onChange={(event) => setLinking(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setLinking(null);
                }}
                className="cq-body-sm h-8 w-64 rounded-(--cq-radius-sm) border border-(--cq-border) bg-(--cq-surface) px-2 text-(--cq-text-primary)"
              />
              <button
                type="submit"
                className="cq-label h-8 rounded-(--cq-radius-sm) px-2 text-(--cq-text-primary) hover:bg-(--cq-surface-subtle)"
              >
                {linking.trim() === "" ? "Remove" : "Apply"}
              </button>
              {linking.trim() !== "" && !isSafeSiteHref(linking.trim()) ? (
                <span
                  role="alert"
                  className="cq-caption px-1 text-(--cq-danger)"
                >
                  Not a link this site allows
                </span>
              ) : null}
            </form>
          )}
        </div>
      ) : null}
      <div
        ref={ref}
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        aria-describedby={focused ? toolbarId : undefined}
        tabIndex={0}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        data-empty={empty}
        onFocus={() => {
          setFocused(true);
          document.execCommand("defaultParagraphSeparator", false, "p");
        }}
        onBlur={() => setFocused(false)}
        onInput={emit}
        onKeyDown={onKeyDown}
        onPaste={(event) => {
          // Plain text only: no markup crosses from the clipboard.
          event.preventDefault();
          const text = event.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, text);
          emit();
        }}
        onDrop={(event) => event.preventDefault()}
        className={`cq-cms-editable cq-site-prose [&_a]:underline [&_ol]:list-decimal [&_ol]:ps-5 [&_p+p]:mt-3 [&_ul]:list-disc [&_ul]:ps-5 [&_ul]:my-2 [&_ol]:my-2 ${className}`}
      />
    </div>
  );
}

/** A textarea that grows with its words and looks like the text it edits. */
export function InlineText({
  value,
  onChange,
  placeholder,
  label,
  className = "",
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly placeholder: string;
  readonly label: string;
  readonly className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    element.style.height = "0px";
    element.style.height = `${String(element.scrollHeight)}px`;
  }, [value]);
  return (
    <textarea
      {...rest}
      ref={ref}
      rows={1}
      aria-label={label}
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value.replace(/\n/gu, " "))}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.preventDefault();
        rest.onKeyDown?.(event);
      }}
      className={`cq-cms-editable block w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-(--cq-text-primary) placeholder:text-(--cq-text-tertiary) ${className}`}
    />
  );
}
