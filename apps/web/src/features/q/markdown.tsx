import { Fragment, type ReactNode } from "react";

import { cx } from "@capital-q/ui";
import {
  AlertTriangle,
  Check,
  CircleAlert,
  ICON_SIZE,
  ICON_STROKE,
  Info,
} from "@capital-q/ui/icons";

/**
 * Q's answer text as structure (founder direction D, 2026-09-28).
 *
 * The answer model writes a small Markdown subset: headings, bullet and
 * numbered lists, tables, bold, italics, inline code, links and quoted
 * callouts. This renders that subset and nothing else, and it is safe by
 * construction rather than by sanitising: the source is parsed into a
 * handful of block and inline kinds and every character reaches the page
 * as a React text node. Raw HTML is never interpreted (a `<script>` in an
 * answer is shown as the characters it is), there is no
 * `dangerouslySetInnerHTML`, and a link is kept only when its target is an
 * absolute http(s) URL -- anything else (`javascript:`, `data:`, relative
 * paths) keeps its visible words and loses the link.
 *
 * It is written for text that is still arriving. It is re-parsed on every
 * delta (answers are short, the parse is linear), and while `streaming` a
 * half-written construct renders as what it is becoming rather than as
 * stray syntax: an unclosed `**` is already bold, a link whose target has
 * not arrived shows its words, and table rows wait for the header's
 * separator line instead of flashing as pipes.
 *
 * Why not a Markdown library: the subset is small, the output must never
 * contain HTML, and a hand-rolled parser keeps the dependency tree and
 * the bundle unchanged.
 */

type Align = "left" | "center" | "right" | null;

export type CalloutTone = "info" | "positive" | "warning" | "danger";

type ListItem = {
  readonly text: string;
  readonly children: readonly MdBlock[];
};

export type MdBlock =
  | { readonly kind: "heading"; readonly level: number; readonly text: string }
  | { readonly kind: "paragraph"; readonly text: string }
  | {
      readonly kind: "list";
      readonly ordered: boolean;
      readonly start: number;
      readonly items: readonly ListItem[];
    }
  | {
      readonly kind: "table";
      readonly header: readonly string[];
      readonly align: readonly Align[];
      readonly rows: readonly (readonly string[])[];
    }
  | {
      readonly kind: "callout";
      readonly tone: CalloutTone | null;
      readonly label: string | null;
      readonly blocks: readonly MdBlock[];
    }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "rule" };

/** Quoted callouts by meaning: the label always says what the colour does. */
const CALLOUTS: Readonly<
  Record<string, { readonly tone: CalloutTone; readonly label: string }>
> = {
  NOTE: { tone: "info", label: "Note" },
  IMPORTANT: { tone: "info", label: "Important" },
  TIP: { tone: "positive", label: "Tip" },
  STRENGTH: { tone: "positive", label: "Strength" },
  WARNING: { tone: "warning", label: "Warning" },
  GAP: { tone: "warning", label: "Gap" },
  CAUTION: { tone: "danger", label: "Caution" },
  RISK: { tone: "danger", label: "Risk" },
};

const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const FENCE = /^ {0,3}(```|~~~)/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const CALLOUT_MARK = /^\[!([A-Za-z]+)\]\s*(.*)$/;

function indentOf(line: string): number {
  const match = /^\s*/.exec(line);
  return match === null ? 0 : match[0].replace(/\t/g, "    ").length;
}

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

function splitRow(line: string): string[] {
  let body = line.trim();
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|") && !body.endsWith("\\|")) body = body.slice(0, -1);
  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === "\\" && body[index + 1] === "|") {
      current += "|";
      index += 1;
    } else if (char === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function separatorAlign(line: string): Align[] | null {
  if (!line.includes("-")) return null;
  const cells = splitRow(line);
  if (cells.length === 0) return null;
  const align: Align[] = [];
  for (const cell of cells) {
    if (!/^:?-+:?$/.test(cell)) return null;
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    align.push(
      left && right ? "center" : right ? "right" : left ? "left" : null,
    );
  }
  return align;
}

function looksLikeRow(line: string): boolean {
  return line.includes("|") && !isBlank(line);
}

function startsBlock(line: string): boolean {
  return (
    HEADING.test(line) ||
    RULE.test(line) ||
    FENCE.test(line) ||
    QUOTE.test(line) ||
    LIST_ITEM.test(line)
  );
}

/**
 * The source's blocks. Pure, so tests read the structure directly.
 * `streaming` holds back a table whose separator line has not arrived.
 */
export function parseMarkdown(source: string, streaming = false): MdBlock[] {
  return parseLines(source.replace(/\r\n?/g, "\n").split("\n"), streaming);
}

function parseLines(lines: readonly string[], streaming: boolean): MdBlock[] {
  const blocks: MdBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (isBlank(line)) {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence !== null) {
      const marker = fence[1] ?? "```";
      const body: string[] = [];
      index += 1;
      while (
        index < lines.length &&
        !(lines[index] ?? "").trim().startsWith(marker)
      ) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      index += 1;
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading !== null) {
      blocks.push({
        kind: "heading",
        level: Math.min((heading[1] ?? "#").length, 4),
        text: heading[2] ?? "",
      });
      index += 1;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (index < lines.length) {
        const quoted = QUOTE.exec(lines[index] ?? "");
        if (quoted === null) break;
        body.push(quoted[1] ?? "");
        index += 1;
      }
      const mark = CALLOUT_MARK.exec(body[0]?.trim() ?? "");
      const known =
        mark === null ? undefined : CALLOUTS[(mark[1] ?? "").toUpperCase()];
      if (mark !== null && known !== undefined) {
        const rest = mark[2] ?? "";
        const inner =
          rest.length > 0 ? [rest, ...body.slice(1)] : body.slice(1);
        blocks.push({
          kind: "callout",
          tone: known.tone,
          label: known.label,
          blocks: parseLines(inner, streaming),
        });
      } else {
        blocks.push({
          kind: "callout",
          tone: null,
          label: null,
          blocks: parseLines(body, streaming),
        });
      }
      continue;
    }

    if (LIST_ITEM.test(line)) {
      index = parseList(lines, index, blocks, streaming);
      continue;
    }

    if (looksLikeRow(line)) {
      const header = splitRow(line);
      const align = separatorAlign(lines[index + 1] ?? "");
      if (align !== null && align.length === header.length) {
        const rows: string[][] = [];
        index += 2;
        while (index < lines.length && looksLikeRow(lines[index] ?? "")) {
          rows.push(splitRow(lines[index] ?? ""));
          index += 1;
        }
        blocks.push({ kind: "table", header, align, rows });
        continue;
      }
      // A table still arriving: its header is here, its separator is not
      // (or is half-written). Held back rather than shown as pipes.
      if (
        streaming &&
        line.trim().startsWith("|") &&
        lines
          .slice(index + 1)
          .every((rest) => isBlank(rest) || looksLikeRow(rest))
      ) {
        break;
      }
    }

    const body: string[] = [line.trim()];
    index += 1;
    while (index < lines.length) {
      const next = lines[index] ?? "";
      if (isBlank(next) || startsBlock(next)) break;
      if (looksLikeRow(next) && separatorAlign(lines[index + 1] ?? "") !== null)
        break;
      body.push(next.trim());
      index += 1;
    }
    blocks.push({ kind: "paragraph", text: body.join("\n") });
  }
  return blocks;
}

/** One list, from `start`; returns the index after it. */
function parseList(
  lines: readonly string[],
  start: number,
  blocks: MdBlock[],
  streaming: boolean,
): number {
  const first = LIST_ITEM.exec(lines[start] ?? "");
  const baseIndent = indentOf(first?.[1] ?? "");
  const firstMarker = first?.[2] ?? "-";
  const ordered = /\d/.test(firstMarker);
  const items: { text: string; nested: string[] }[] = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const item = LIST_ITEM.exec(line);
    if (item !== null && indentOf(item[1] ?? "") <= baseIndent + 1) {
      if (/\d/.test(item[2] ?? "") !== ordered) break;
      items.push({ text: item[3] ?? "", nested: [] });
      index += 1;
      continue;
    }
    const current = items.at(-1);
    if (current === undefined) break;
    if (isBlank(line)) {
      // A blank line ends the list unless the list, or this item, goes on.
      const next = lines[index + 1] ?? "";
      if (
        !isBlank(next) &&
        (indentOf(next) > baseIndent ||
          (LIST_ITEM.test(next) &&
            indentOf(LIST_ITEM.exec(next)?.[1] ?? "") <= baseIndent + 1))
      ) {
        current.nested.push("");
        index += 1;
        continue;
      }
      break;
    }
    if (indentOf(line) > baseIndent) {
      current.nested.push(line.slice(Math.min(indentOf(line), baseIndent + 2)));
      index += 1;
      continue;
    }
    if (startsBlock(line)) break;
    // A lazy continuation of the item's own line.
    if (current.nested.length === 0) {
      current.text = `${current.text}\n${line.trim()}`;
      index += 1;
      continue;
    }
    break;
  }
  const startNumber = ordered ? Number.parseInt(firstMarker, 10) : 1;
  blocks.push({
    kind: "list",
    ordered,
    start: Number.isFinite(startNumber) ? startNumber : 1,
    items: items.map((item) => ({
      text: item.text,
      children: parseLines(item.nested, streaming),
    })),
  });
  return index;
}

/** An absolute http(s) URL, or nothing: the only links an answer may carry. */
export function safeHref(target: string): string | null {
  const trimmed = target.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!|>~<]/;
const LINK = /^\[([^\]\n]*)\]\(\s*<?((?:[^()\s<>]|\([^()\s]*\))*)>?\s*\)/;
const PARTIAL_LINK = /^\[([^\]\n]*)(\](\([^)]*)?)?$/;

/**
 * Inline Markdown to React nodes. Text only ever becomes text nodes;
 * `<`, `&` and friends are escaped by React like any other character.
 */
export function renderInline(
  text: string,
  streaming: boolean,
  key = "i",
): ReactNode[] {
  const out: ReactNode[] = [];
  let plain = "";
  let index = 0;
  let n = 0;
  const flush = () => {
    if (plain.length > 0) {
      out.push(plain);
      plain = "";
    }
  };
  const next = () => `${key}.${String((n += 1))}`;

  while (index < text.length) {
    const char = text[index] ?? "";
    const rest = text.slice(index);

    if (char === "\\" && ESCAPABLE.test(text[index + 1] ?? "")) {
      plain += text[index + 1];
      index += 2;
      continue;
    }

    if (char === "\n") {
      flush();
      out.push(<br key={next()} />);
      index += 1;
      continue;
    }

    if (char === "`") {
      const close = text.indexOf("`", index + 1);
      if (close > index + 1 || (close === -1 && streaming)) {
        flush();
        const end = close === -1 ? text.length : close;
        out.push(
          <code key={next()} className="cq-md-code">
            {text.slice(index + 1, end)}
          </code>,
        );
        index = close === -1 ? text.length : close + 1;
        continue;
      }
    }

    const strong = rest.startsWith("**")
      ? "**"
      : rest.startsWith("__") && !/\w/.test(text[index - 1] ?? "")
        ? "__"
        : null;
    if (strong !== null) {
      const close = text.indexOf(strong, index + 2);
      if (close > index + 2 || (close === -1 && streaming)) {
        flush();
        const end = close === -1 ? text.length : close;
        const id = next();
        out.push(
          <strong key={id} className="font-semibold">
            {renderInline(text.slice(index + 2, end), streaming, id)}
          </strong>,
        );
        index = close === -1 ? text.length : close + 2;
        continue;
      }
    }

    if (
      (char === "*" || char === "_") &&
      !/\s/.test(text[index + 1] ?? " ") &&
      !(char === "_" && /\w/.test(text[index - 1] ?? ""))
    ) {
      let close = index + 1;
      for (;;) {
        close = text.indexOf(char, close);
        if (close === -1) break;
        // `**` inside an emphasis belongs to a strong, not to this close.
        if (text[close + 1] === char) {
          close += 2;
          continue;
        }
        break;
      }
      if (
        close > index + 1 &&
        !/\s/.test(text[close - 1] ?? " ") &&
        !(char === "_" && /\w/.test(text[close + 1] ?? ""))
      ) {
        flush();
        const id = next();
        out.push(
          <em key={id}>
            {renderInline(text.slice(index + 1, close), streaming, id)}
          </em>,
        );
        index = close + 1;
        continue;
      }
    }

    if (char === "[") {
      const link = LINK.exec(rest);
      if (link !== null) {
        flush();
        const label = link[1] ?? "";
        const href = safeHref(link[2] ?? "");
        const id = next();
        out.push(
          href === null ? (
            <Fragment key={id}>{renderInline(label, streaming, id)}</Fragment>
          ) : (
            <a
              key={id}
              href={href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="underline underline-offset-2"
            >
              {renderInline(label, streaming, id)}
            </a>
          ),
        );
        index += link[0].length;
        continue;
      }
      const partial = streaming ? PARTIAL_LINK.exec(rest) : null;
      if (partial !== null) {
        // Its target is still arriving: its words, not its syntax.
        flush();
        const id = next();
        out.push(
          <Fragment key={id}>
            {renderInline(partial[1] ?? "", streaming, id)}
          </Fragment>,
        );
        index = text.length;
        continue;
      }
    }

    plain += char;
    index += 1;
  }
  flush();
  return out;
}

const TONE_CLASS: Readonly<Record<CalloutTone, string>> = {
  info: "cq-md-callout is-info",
  positive: "cq-md-callout is-positive",
  warning: "cq-md-callout is-warning",
  danger: "cq-md-callout is-danger",
};

function ToneIcon({ tone }: { readonly tone: CalloutTone }) {
  const props = {
    "aria-hidden": true,
    size: ICON_SIZE.compact,
    strokeWidth: ICON_STROKE,
  } as const;
  switch (tone) {
    case "info":
      return <Info {...props} />;
    case "positive":
      return <Check {...props} />;
    case "warning":
      return <CircleAlert {...props} />;
    case "danger":
      return <AlertTriangle {...props} />;
  }
}

/**
 * A list whose every item is "**Label:** value" reads as a key-value card
 * (a company's stage, raise, runway): the same words, laid out to scan.
 */
const KEY_VALUE = /^\*\*([^*\n]{1,48}?):?\*\*:?\s+(\S[\s\S]*)$/;

function keyValues(
  items: readonly ListItem[],
): readonly { key: string; value: string }[] | null {
  if (items.length < 2) return null;
  const pairs: { key: string; value: string }[] = [];
  for (const item of items) {
    if (item.children.length > 0) return null;
    const match = KEY_VALUE.exec(item.text);
    if (match === null) return null;
    pairs.push({ key: match[1] ?? "", value: match[2] ?? "" });
  }
  return pairs;
}

function Blocks({
  blocks,
  streaming,
  path,
}: {
  readonly blocks: readonly MdBlock[];
  readonly streaming: boolean;
  readonly path: string;
}) {
  return (
    <>
      {blocks.map((block, position) => {
        const key = `${path}.${String(position)}`;
        switch (block.kind) {
          case "heading":
            return block.level <= 2 ? (
              <h3 key={key} className="cq-title-sm text-(--cq-text-primary)">
                {renderInline(block.text, streaming, key)}
              </h3>
            ) : (
              <h4
                key={key}
                className="cq-body font-semibold text-(--cq-text-primary)"
              >
                {renderInline(block.text, streaming, key)}
              </h4>
            );
          case "paragraph":
            return <p key={key}>{renderInline(block.text, streaming, key)}</p>;
          case "rule":
            return <hr key={key} className="border-(--cq-border-subtle)" />;
          case "code":
            return (
              <pre key={key} className="cq-md-pre">
                <code>{block.text}</code>
              </pre>
            );
          case "list": {
            const pairs = block.ordered ? null : keyValues(block.items);
            if (pairs !== null) {
              return (
                <dl key={key} className="cq-md-kv" data-md-kv>
                  {pairs.map((pair, row) => (
                    <div key={`${key}.${String(row)}`} className="cq-md-kv-row">
                      <dt>
                        {renderInline(
                          pair.key,
                          streaming,
                          `${key}.k${String(row)}`,
                        )}
                      </dt>
                      <dd>
                        {renderInline(
                          pair.value,
                          streaming,
                          `${key}.v${String(row)}`,
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              );
            }
            const items = block.items.map((item, row) => {
              const itemKey = `${key}.${String(row)}`;
              return (
                <li key={itemKey}>
                  {renderInline(item.text, streaming, itemKey)}
                  {item.children.length > 0 ? (
                    <Blocks
                      blocks={item.children}
                      streaming={streaming}
                      path={itemKey}
                    />
                  ) : null}
                </li>
              );
            });
            return block.ordered ? (
              <ol
                key={key}
                className="cq-md-list list-decimal"
                {...(block.start === 1 ? {} : { start: block.start })}
              >
                {items}
              </ol>
            ) : (
              <ul key={key} className="cq-md-list list-disc">
                {items}
              </ul>
            );
          }
          case "table": {
            const width = block.header.length;
            const cellAlign = (column: number) => {
              const align = block.align[column] ?? null;
              return align === "right"
                ? "text-right"
                : align === "center"
                  ? "text-center"
                  : "text-left";
            };
            return (
              <div key={key} className="cq-md-table" data-md-table>
                <table>
                  <thead>
                    <tr>
                      {block.header.map((cell, column) => (
                        <th
                          key={`${key}.h${String(column)}`}
                          scope="col"
                          className={cellAlign(column)}
                        >
                          {renderInline(
                            cell,
                            streaming,
                            `${key}.h${String(column)}`,
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={`${key}.r${String(rowIndex)}`}>
                        {Array.from({ length: width }, (_, column) => {
                          const cell = row[column] ?? "";
                          const cellKey = `${key}.r${String(rowIndex)}.${String(column)}`;
                          const content =
                            cell === "" ? (
                              // An empty cell is unknown, never zero.
                              <span className="text-(--cq-text-tertiary)">
                                Not known
                              </span>
                            ) : (
                              renderInline(cell, streaming, cellKey)
                            );
                          return column === 0 ? (
                            <th
                              key={cellKey}
                              scope="row"
                              className={cellAlign(column)}
                            >
                              {content}
                            </th>
                          ) : (
                            <td key={cellKey} className={cellAlign(column)}>
                              {content}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          case "callout":
            return (
              <div
                key={key}
                className={
                  block.tone === null ? "cq-md-quote" : TONE_CLASS[block.tone]
                }
                {...(block.tone === null
                  ? {}
                  : { "data-md-callout": block.tone })}
              >
                {block.tone !== null && block.label !== null ? (
                  <span className="cq-md-callout-label">
                    <ToneIcon tone={block.tone} />
                    {block.label}
                  </span>
                ) : null}
                <Blocks
                  blocks={block.blocks}
                  streaming={streaming}
                  path={key}
                />
              </div>
            );
        }
      })}
    </>
  );
}

export function QMarkdown({
  text,
  streaming = false,
  className,
}: {
  readonly text: string;
  readonly streaming?: boolean | undefined;
  readonly className?: string | undefined;
}) {
  return (
    <div className={cx("cq-md", className)} data-q-markdown>
      <Blocks
        blocks={parseMarkdown(text, streaming)}
        streaming={streaming}
        path="b"
      />
    </div>
  );
}

/**
 * The answer as it is said aloud: the words, none of the syntax. Links
 * keep their words, table cells become short phrases, callout markers go.
 */
export function plainFromMarkdown(source: string): string {
  return source
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => separatorAlign(line) === null && !RULE.test(line))
    .map((line) =>
      line
        .replace(/^ {0,3}(```|~~~).*$/, "")
        .replace(/^ {0,3}#{1,6}\s+/, "")
        .replace(/^ {0,3}>\s?/, "")
        .replace(/^\[![A-Za-z]+\]\s*/, "")
        .replace(/^(\s*)([-*+]|\d{1,9}[.)])\s+/, "$1")
        .replace(/^\s*\|(.*)\|?\s*$/, (_, cells: string) =>
          splitRow(cells)
            .filter((cell) => cell.length > 0)
            .join(", "),
        )
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/(\*\*|__)(.+?)\1/g, "$2")
        .replace(/(^|[^\w*])[*_](\S(?:.*?\S)?)[*_](?=[^\w*]|$)/g, "$1$2")
        .replace(/`([^`]*)`/g, "$1")
        .trim(),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
