"use client";

import {
  useId,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { IconButton } from "../components/button.js";
import { InlineNotice } from "../components/states.js";
import { ArrowUp, ICON_SIZE, Mic, Plus } from "../icons/index.js";
import { cx } from "../primitives/class-names.js";
import type { ContextScope } from "../tokens/index.js";
import { ContextIndicator } from "./context-indicator.js";
import { QMark } from "./q-mark.js";
import { useUiText } from "../primitives/ui-text.js";

/**
 * The Q composer: Q identity, a labelled growing input, a submit affordance
 * and the context the question will be asked in.
 *
 * It is an entry point, not an intelligence. When no `onSubmit` is wired the
 * composer says plainly that nothing was sent; it never fabricates an
 * answer, a stage or a "thinking" animation. The microphone appears only
 * when a surface wires `onVoice` to a real capability: a dead microphone
 * is worse than none, and the same is true of the attach control.
 *
 * Typing, talking and attaching are one surface rather than three
 * (QX-001 §5). Each is a way of saying something to Q in the same
 * conversation, so they sit on the same row and none of them starts a
 * separate history.
 */

/** Role-neutral (QA F-53: an investor was asked about "your company"). */
export const Q_COMPOSER_PLACEHOLDER =
  "Ask Q about companies, capital or relationships";

/**
 * Lane 8: one attached file as the composer shows it. `ready` means the
 * server has it: Send is live on a ready file alone, and stays off while
 * any file is still uploading, so a question never leaves without the
 * document it is about.
 */
export type QComposerAttachment = {
  readonly key: string;
  readonly label: string;
  readonly state: "uploading" | "ready" | "failed";
};

export type QComposerProps = {
  readonly id?: string | undefined;
  readonly contextScope?: ContextScope | undefined;
  readonly contextDetail?: string | undefined;
  /** Absent means Q is not connected on this surface. */
  readonly onSubmit?: ((question: string) => void | Promise<void>) | undefined;
  readonly disabled?: boolean | undefined;
  readonly autoFocus?: boolean | undefined;
  readonly className?: string | undefined;
  /** What the input is waiting for on this surface; the general cue by default. */
  readonly placeholder?: string | undefined;
  /** Talk with Q instead: present only where voice is wired. */
  readonly onVoice?: (() => void) | undefined;
  readonly voiceLabel?: string | undefined;
  /**
   * Attach a file to this conversation: present only where a surface can
   * actually accept one. On Home that means a founder with a company, and
   * nobody else sees the control rather than seeing one that refuses.
   */
  readonly onAttach?: ((file: File) => void | Promise<void>) | undefined;
  readonly attachLabel?: string | undefined;
  /**
   * What is attached or attaching, in the surface's own words. A plain
   * string is a note only; a QComposerAttachment also decides Send.
   */
  readonly attachments?: readonly (string | QComposerAttachment)[] | undefined;
  readonly attachAccept?: string | undefined;
  /**
   * Where the attachments are (the surface's WorkingLine: "Reading
   * term-sheet.pdf"), set under the field. Words from real progress only.
   */
  readonly attachmentStatus?: ReactNode | undefined;
  /**
   * A question to start from, which the person can edit or clear. Only
   * ever a draft: nothing is sent until they send it.
   */
  readonly initialValue?: string | undefined;
  /**
   * What is in the field, on every change and when a send clears it, so a
   * surface can keep an unsent draft (onboarding keeps one per interview).
   */
  readonly onValueChange?: ((value: string) => void) | undefined;
  /**
   * False where the surface already shows the scope elsewhere (the Q
   * page's top line): the field carries the words, not a chip.
   */
  readonly showContext?: boolean | undefined;
  /**
   * Controls that belong to the field while something is live (Mute and
   * End during a voice session), set at its leading edge.
   */
  readonly actions?: ReactNode | undefined;
  /**
   * Icon controls set in the field's own icon row, before Send (Mute and
   * End during a voice session: owner 2026-10-18, full-size buttons made
   * the box look cluttered on a phone).
   */
  readonly iconActions?: ReactNode | undefined;
};

export function QComposer({
  id,
  contextScope = "unset",
  contextDetail,
  onSubmit,
  disabled = false,
  autoFocus = false,
  className,
  placeholder = Q_COMPOSER_PLACEHOLDER,
  onVoice,
  voiceLabel = "Talk with Q",
  onAttach,
  attachLabel = "Attach a document",
  attachments = [],
  attachAccept,
  attachmentStatus,
  initialValue = "",
  onValueChange,
  showContext = true,
  actions,
  iconActions,
}: QComposerProps) {
  const t = useUiText();
  const generatedId = useId();
  const inputId = id ?? `q-composer-${generatedId}`;
  const [value, setValue] = useState(initialValue);
  const [notice, setNotice] = useState<"unavailable" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const trimmed = value.trim();
  const attached = attachments.filter(
    (entry): entry is QComposerAttachment => typeof entry !== "string",
  );
  // Lane 8: a finished attachment is something to say on its own; one
  // still uploading holds Send, so the question waits for its document.
  const uploading = attached.some((entry) => entry.state === "uploading");
  const ready = attached.some((entry) => entry.state === "ready");
  const canSubmit =
    (trimmed.length > 0 || ready) && !uploading && !disabled && !submitting;

  const attachFiles = (files: FileList | null | undefined) => {
    if (onAttach === undefined || files === null || files === undefined) {
      return;
    }
    for (const file of Array.from(files).slice(0, 5)) void onAttach(file);
  };

  // JS fallback for browsers without `field-sizing: content`; the class's
  // max-height caps it, and past the cap the field scrolls.
  function resize(element: HTMLTextAreaElement) {
    element.style.height = "auto";
    element.style.height = `${String(element.scrollHeight)}px`;
  }

  async function submit() {
    if (!canSubmit) {
      return;
    }
    if (onSubmit === undefined) {
      setNotice("unavailable");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
      setValue("");
      onValueChange?.("");
      setNotice(null);
      const element = textareaRef.current;
      if (element !== null) {
        resize(element);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter keeps writing.
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-labelledby={`${inputId}-title`}
      // Lane 8: a file dropped on the composer is attached, as the
      // button does; the border says where it will land.
      {...(onAttach === undefined || disabled
        ? {}
        : {
            onDragOver: (event: DragEvent<HTMLFormElement>) => {
              if (!event.dataTransfer.types.includes("Files")) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              if (!dragging) setDragging(true);
            },
            onDragLeave: (event: DragEvent<HTMLFormElement>) => {
              if (
                event.relatedTarget instanceof Node &&
                event.currentTarget.contains(event.relatedTarget)
              ) {
                return;
              }
              setDragging(false);
            },
            onDrop: (event: DragEvent<HTMLFormElement>) => {
              if (!event.dataTransfer.types.includes("Files")) return;
              event.preventDefault();
              setDragging(false);
              attachFiles(event.dataTransfer.files);
            },
          })}
      data-dragging={dragging ? "" : undefined}
      className={cx(
        "flex flex-col gap-2 rounded-lg border border-(--cq-border) bg-(--cq-surface-raised) px-2 py-1 shadow-(--cq-shadow-xs) transition-colors duration-(--cq-motion-fast) focus-within:border-(--cq-border-strong) data-[dragging]:border-dashed data-[dragging]:border-(--cq-accent)",
        className,
      )}
    >
      {/* One line: the mark, the field, and its controls. The field grows
          with what is typed up to a cap, then scrolls inside itself, so the
          composer never pushes a conversation off a phone's screen. */}
      <div className="flex items-end gap-1" data-q-composer-row>
        <div className="flex h-11 flex-none items-center ps-1">
          <QMark size="sm" state={submitting ? "WORKING" : "IDLE"} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <label id={`${inputId}-title`} htmlFor={inputId} className="sr-only">
            {t("Ask Q")}
          </label>
          <textarea
            ref={textareaRef}
            id={inputId}
            name="question"
            rows={1}
            value={value}
            autoFocus={autoFocus}
            disabled={disabled}
            placeholder={t(placeholder)}
            enterKeyHint="send"
            autoComplete="off"
            onChange={(event) => {
              setValue(event.target.value);
              onValueChange?.(event.target.value);
              resize(event.target);
              if (notice !== null) {
                setNotice(null);
              }
            }}
            onKeyDown={handleKeyDown}
            className="cq-body max-h-40 min-h-11 w-full resize-none overflow-y-auto bg-transparent px-1 py-2.5 text-(--cq-text-primary) outline-none placeholder:truncate placeholder:text-(--cq-text-tertiary) [field-sizing:content] disabled:opacity-50"
            data-q-composer-input
          />
        </div>
        <div className="flex flex-none items-center gap-1">
          {iconActions}
          {onAttach !== undefined ? (
            <>
              <input
                ref={fileRef}
                type="file"
                multiple
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                {...(attachAccept === undefined
                  ? {}
                  : { accept: attachAccept })}
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  // The input is cleared either way, so choosing the same
                  // file twice still fires.
                  event.target.value = "";
                  for (const file of files.slice(0, 5)) void onAttach(file);
                }}
              />
              <IconButton
                type="button"
                variant="quiet"
                aria-label={attachLabel}
                title={attachLabel}
                disabled={disabled}
                onClick={() => fileRef.current?.click()}
                data-q-attach
              >
                <Plus
                  aria-hidden="true"
                  size={ICON_SIZE.prominent}
                  strokeWidth={2}
                />
              </IconButton>
            </>
          ) : null}
          {onVoice !== undefined ? (
            <IconButton
              type="button"
              variant="quiet"
              aria-label={t(voiceLabel)}
              title={t(voiceLabel)}
              disabled={disabled}
              onClick={onVoice}
              data-q-talk
            >
              <Mic
                aria-hidden="true"
                size={ICON_SIZE.prominent}
                strokeWidth={2}
              />
            </IconButton>
          ) : null}
          <IconButton
            type="submit"
            variant="primary"
            aria-label={t("Send to Q")}
            disabled={!canSubmit}
          >
            <ArrowUp
              aria-hidden="true"
              size={ICON_SIZE.prominent}
              strokeWidth={2}
            />
          </IconButton>
        </div>
      </div>
      {showContext || actions !== undefined ? (
        <div className="flex min-w-0 items-center gap-1 pb-1">
          {showContext ? (
            <ContextIndicator scope={contextScope} detail={contextDetail} />
          ) : null}
          {actions}
        </div>
      ) : null}
      {attachments.length > 0 ? (
        <ul
          aria-label={t("Attached")}
          className="flex flex-wrap gap-2"
          data-q-attachments
        >
          {attachments.map((attachment) =>
            typeof attachment === "string" ? (
              <li
                key={attachment}
                className="cq-caption rounded-md bg-(--cq-surface-sunken) px-2 py-1 text-(--cq-text-secondary)"
              >
                {attachment}
              </li>
            ) : (
              <li
                key={attachment.key}
                className="cq-caption rounded-md bg-(--cq-surface-sunken) px-2 py-1 text-(--cq-text-secondary)"
                data-q-attachment={attachment.state}
              >
                {attachment.label}
              </li>
            ),
          )}
        </ul>
      ) : null}
      {attachmentStatus === undefined ? null : (
        <div className="px-1 pb-1" data-q-attachment-status>
          {attachmentStatus}
        </div>
      )}
      {notice === "unavailable" ? (
        <InlineNotice
          tone="info"
          title={t("Q isn't connected on this surface yet.")}
        >
          {t(
            "Nothing was sent. Your question is still here when Q is available.",
          )}
        </InlineNotice>
      ) : null}
    </form>
  );
}
