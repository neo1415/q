"use client";

import {
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { IconButton } from "../components/button.js";
import { InlineNotice } from "../components/states.js";
import { ArrowUp, ICON_SIZE } from "../icons/index.js";
import { cx } from "../primitives/class-names.js";
import type { ContextScope } from "../tokens/index.js";
import { ContextIndicator } from "./context-indicator.js";
import { QMark } from "./q-mark.js";

/**
 * The Q composer: Q identity, a labelled growing input, a submit affordance
 * and the context the question will be asked in.
 *
 * It is an entry point, not an intelligence. When no `onSubmit` is wired the
 * composer says plainly that nothing was sent; it never fabricates an
 * answer, a stage or a "thinking" animation. Voice is omitted until a real
 * capability exists -- a dead microphone is worse than none.
 */

export const Q_COMPOSER_PLACEHOLDER =
  "Ask Q about your company, capital, or relationships";

export type QComposerProps = {
  readonly id?: string | undefined;
  readonly contextScope?: ContextScope | undefined;
  readonly contextDetail?: string | undefined;
  /** Absent means Q is not connected on this surface. */
  readonly onSubmit?: ((question: string) => void | Promise<void>) | undefined;
  readonly disabled?: boolean | undefined;
  readonly autoFocus?: boolean | undefined;
  readonly className?: string | undefined;
};

export function QComposer({
  id,
  contextScope = "unset",
  contextDetail,
  onSubmit,
  disabled = false,
  autoFocus = false,
  className,
}: QComposerProps) {
  const generatedId = useId();
  const inputId = id ?? `q-composer-${generatedId}`;
  const [value, setValue] = useState("");
  const [notice, setNotice] = useState<"unavailable" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0 && !disabled && !submitting;

  // JS fallback for browsers without `field-sizing: content`.
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
      className={cx(
        "flex flex-col gap-3 rounded-lg border border-(--cq-border) bg-(--cq-surface-raised) p-3 shadow-(--cq-shadow-xs) transition-colors duration-(--cq-motion-fast) focus-within:border-(--cq-border-strong)",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <QMark size="md" state={submitting ? "WORKING" : "IDLE"} />
        <div className="flex min-w-0 flex-1 flex-col">
          <label id={`${inputId}-title`} htmlFor={inputId} className="sr-only">
            Ask Q
          </label>
          <textarea
            ref={textareaRef}
            id={inputId}
            name="question"
            rows={1}
            value={value}
            autoFocus={autoFocus}
            disabled={disabled}
            placeholder={Q_COMPOSER_PLACEHOLDER}
            enterKeyHint="send"
            autoComplete="off"
            onChange={(event) => {
              setValue(event.target.value);
              resize(event.target);
              if (notice !== null) {
                setNotice(null);
              }
            }}
            onKeyDown={handleKeyDown}
            className="cq-body min-h-8 w-full resize-none bg-transparent py-1 text-(--cq-text-primary) outline-none placeholder:text-(--cq-text-tertiary) [field-sizing:content] disabled:opacity-50"
          />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <ContextIndicator scope={contextScope} detail={contextDetail} />
        <IconButton
          type="submit"
          variant="primary"
          aria-label="Send to Q"
          disabled={!canSubmit}
        >
          <ArrowUp
            aria-hidden="true"
            size={ICON_SIZE.prominent}
            strokeWidth={2}
          />
        </IconButton>
      </div>
      {notice === "unavailable" ? (
        <InlineNotice
          tone="info"
          title="Q isn't connected on this surface yet."
        >
          Nothing was sent. Your question is still here when Q is available.
        </InlineNotice>
      ) : null}
    </form>
  );
}
