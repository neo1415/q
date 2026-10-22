"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import type { QMemoryItemDto } from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { CircleHelp, ICON_SIZE, ICON_STROKE } from "@capital-q/ui/icons";

import { CrmSheet } from "@/features/relationships/crm-kit";
import { useT } from "@/features/i18n/language";

import {
  accountButton,
  fieldClassName,
  Pending,
  useAccountToast,
} from "./account-kit";
import { correctMemoryAction, forgetMemoryAction } from "./memory-actions";

/**
 * What Q remembers, grouped by where it came from, each with Correct and
 * Forget (ADR 0012; chosen design "Grouped, forget in place", 2026-10-21).
 *
 * Forget leaves the list at once with Undo in the toast; the forget itself
 * is sent when the toast has gone (or the page is left), through the Q
 * API's forget route, so Undo never needs to un-forget anything. A
 * correction goes through the memory Write Gate and replaces the memory;
 * the original stays in history, marked superseded. Neither touches the
 * account's audit history.
 */
const KIND_WORDS: Readonly<Record<string, string>> = {
  fact: "Things you told Q",
  correction: "Corrections you made",
  pronunciation: "Names and how they’re said",
  preference: "How you like to work",
  // ADR 0062: only for Q's own chat with you, and gone after 90 days.
  small_talk: "Mentioned in passing (kept 90 days)",
};

/** How long Undo is offered before the forget is sent. */
const UNDO_MS = 5000;

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** The line under a memory: how Q came to know it, and when. */
export function memoryOrigin(item: QMemoryItemDto): string {
  const when = day(item.learnedAt);
  const about = item.about === "COMPANY" ? "About your company. " : "";
  if (item.kind === "small_talk") {
    return item.forgetsAt === null || item.forgetsAt === undefined
      ? `Mentioned to Q, ${when}`
      : `Mentioned to Q, ${when}. Forgotten on ${day(item.forgetsAt)}`;
  }
  switch (item.origin) {
    case "CORRECTED":
      return `${about}You corrected Q, ${when}`;
    case "LEARNED":
      return `${about}Q learned this from your conversations, ${when}`;
    case "SAID":
      return `${about}You said this to Q, ${when}`;
    case undefined:
      return item.quote === null
        ? `${about}Q learned this, ${when}`
        : `${about}You said this to Q, ${when}`;
  }
}

export function QMemoryList({
  items,
  review,
}: {
  readonly items: readonly QMemoryItemDto[];
  /**
   * Design review only (/dev/account-review): one memory just forgotten
   * (its Undo showing, nothing sent), or one with its correct sheet open.
   */
  readonly review?:
    { readonly forgotten?: string; readonly correcting?: string } | undefined;
}) {
  const t = useT();
  const toast = useAccountToast();
  const router = useRouter();
  // Hidden now; the forget is sent when its Undo window closes.
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(
    () => new Set(review?.forgotten === undefined ? [] : [review.forgotten]),
  );
  const [gone, setGone] = useState<ReadonlySet<string>>(
    () => new Set(review?.forgotten === undefined ? [] : [review.forgotten]),
  );
  const [correcting, setCorrecting] = useState<QMemoryItemDto | null>(
    () =>
      items.find((item) => item.memoryItemId === review?.correcting) ?? null,
  );
  // Design review: the forgotten memory's Undo, shown once and kept up.
  const reviewForgotten = review?.forgotten;
  const reviewShown = useRef(false);
  useEffect(() => {
    if (reviewForgotten === undefined || reviewShown.current) return;
    reviewShown.current = true;
    toast({
      text: t("Forgotten. Q won’t use it again."),
      action: {
        label: t("Undo"),
        run: () => {
          setGone((current) => without(current, reviewForgotten));
          setLeaving((current) => without(current, reviewForgotten));
        },
      },
      stay: true,
    });
  }, [reviewForgotten, t, toast]);
  // Timers waiting to send a forget, by memory id (a stable Map, not state
  // that renders).
  const [pending] = useState(
    () => new Map<string, ReturnType<typeof setTimeout>>(),
  );

  const send = useCallback(
    (id: string) => {
      const timer = pending.get(id);
      if (timer !== undefined) clearTimeout(timer);
      pending.delete(id);
      void forgetMemoryAction(id).then((result) => {
        if (!result.ok) {
          // Not forgotten: it comes back, and the person is told.
          setGone((current) => without(current, id));
          setLeaving((current) => without(current, id));
          toast(t("That wasn't forgotten. Try again in a moment."));
        }
      });
    },
    [pending, t, toast],
  );

  // The latest `send`, so the page-leave flush below binds once and a
  // re-render never flushes a forget the person could still undo.
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  // Leaving the page (or hiding it) sends every forget still waiting.
  useEffect(() => {
    const waiting = pending;
    const flush = () => {
      for (const id of [...waiting.keys()]) sendRef.current(id);
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      flush();
    };
  }, [pending]);

  const forget = useCallback(
    (item: QMemoryItemDto) => {
      const id = item.memoryItemId;
      setLeaving((current) => new Set(current).add(id));
      // The card slides out, then the list closes up (unless Undo came first).
      const closing = setTimeout(
        () => setGone((current) => new Set(current).add(id)),
        220,
      );
      pending.set(
        id,
        setTimeout(() => send(id), UNDO_MS),
      );
      toast({
        text: t("Forgotten. Q won’t use it again."),
        action: {
          label: t("Undo"),
          run: () => {
            clearTimeout(closing);
            const timer = pending.get(id);
            if (timer !== undefined) clearTimeout(timer);
            pending.delete(id);
            setGone((current) => without(current, id));
            setLeaving((current) => without(current, id));
          },
        },
      });
    },
    [pending, send, t, toast],
  );

  const shown = items.filter((item) => !gone.has(item.memoryItemId));
  const kinds = [
    ...new Set([...Object.keys(KIND_WORDS), ...items.map((item) => item.kind)]),
  ].filter((kind) => shown.some((item) => item.kind === kind));

  return (
    <>
      {shown.length === 0 ? (
        <div
          className="mt-4 flex flex-col items-center gap-2 rounded-(--cq-radius-lg) border border-dashed border-(--cq-border) bg-(--cq-surface) px-6 py-10 text-center"
          data-state="empty"
        >
          <b className="text-base text-(--cq-text-primary)">
            {t("Q hasn’t remembered anything about you yet")}
          </b>
          <p className="m-0 max-w-[44ch] text-(--cq-text-secondary)">
            {t(
              "Tell it how you like to work, or correct it, and it keeps that for every conversation.",
            )}
          </p>
        </div>
      ) : (
        kinds.map((kind, index) => (
          <section
            key={kind}
            aria-labelledby={`memory-${kind}`}
            className={index === 0 ? "mt-4" : "mt-6"}
          >
            <h2
              id={`memory-${kind}`}
              className="m-0 mb-2 text-base font-semibold text-(--cq-text-primary)"
            >
              {t(KIND_WORDS[kind] ?? kind)}
            </h2>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {shown
                .filter((item) => item.kind === kind)
                .map((item) => (
                  <li
                    key={item.memoryItemId}
                    className={cx(
                      "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3.5 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-4 py-3.5 transition-[opacity,transform] duration-200 ease-(--cq-ease) motion-reduce:transition-none",
                      leaving.has(item.memoryItemId)
                        ? "translate-x-3 opacity-0"
                        : null,
                    )}
                    data-memory-item={item.memoryItemId}
                  >
                    <div className="min-w-0">
                      <p className="m-0 text-[15px] leading-[1.45] text-(--cq-text-primary)">
                        {item.content}
                      </p>
                      <small className="mt-[3px] block text-[12.5px] text-(--cq-text-tertiary)">
                        {t(memoryOrigin(item))}
                      </small>
                    </div>
                    <div className="flex flex-nowrap items-center gap-2.5">
                      <button
                        type="button"
                        className={accountButton("quiet", "sm")}
                        onClick={() => setCorrecting(item)}
                        aria-label={`${t("Correct")}: ${item.content}`}
                        data-memory-correct
                      >
                        {t("Correct")}
                      </button>
                      <button
                        type="button"
                        className={accountButton("secondary", "sm")}
                        disabled={leaving.has(item.memoryItemId)}
                        onClick={() => forget(item)}
                        aria-label={`${t("Forget")}: ${item.content}`}
                        data-memory-forget
                      >
                        {t("Forget")}
                      </button>
                    </div>
                  </li>
                ))}
            </ul>
          </section>
        ))
      )}
      <div className="mt-5 flex items-start gap-2 rounded-[10px] bg-(--cq-surface-subtle) px-3.5 py-3 text-[13px] text-(--cq-text-secondary)">
        <CircleHelp
          size={ICON_SIZE.compact}
          strokeWidth={ICON_STROKE}
          aria-hidden="true"
          className="mt-px flex-none"
        />
        <span>
          {t(
            "This is Q’s memory, not your account’s history. Forgetting something here doesn’t erase the record of what was sent or approved; that stays in your audit history.",
          )}
        </span>
      </div>
      <CorrectSheet
        item={correcting}
        onClose={() => setCorrecting(null)}
        onSaved={() => {
          setCorrecting(null);
          toast(t("Saved. Q uses your correction from now on."));
          router.refresh();
        }}
      />
    </>
  );
}

function without(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  next.delete(id);
  return next;
}

/** The person's own words for what Q should remember instead. */
function CorrectSheet({
  item,
  onClose,
  onSaved,
}: {
  readonly item: QMemoryItemDto | null;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const t = useT();
  const id = useId();
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<"idle" | "pending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState<QMemoryItemDto | null>(null);
  if (item !== seen) {
    setSeen(item);
    setText(item?.content ?? "");
    setPhase("idle");
    setError(null);
  }
  const unchanged = item === null || text.trim() === item.content.trim();
  return (
    <CrmSheet
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("Correct what Q remembers")}
      sub={item === null ? undefined : t(KIND_WORDS[item.kind] ?? item.kind)}
      data-memory-correct-sheet
    >
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={id}
          className="text-[13px] font-medium text-(--cq-text-secondary)"
        >
          {t("What Q should remember")}
        </label>
        <textarea
          id={id}
          value={text}
          maxLength={1000}
          rows={4}
          onChange={(event) => setText(event.target.value)}
          className={cx(fieldClassName, "min-h-[84px] resize-y")}
        />
      </div>
      <span className="text-xs text-(--cq-text-tertiary)">
        {t(
          "Your correction replaces this memory. The original stays in history, marked superseded.",
        )}
      </span>
      {error === null ? null : (
        <p role="alert" className="m-0 text-sm text-(--cq-text-primary)">
          {error}
        </p>
      )}
      <button
        type="button"
        className={accountButton(phase === "done" ? "done" : "primary")}
        disabled={phase !== "idle" || unchanged || text.trim().length < 3}
        aria-busy={phase === "pending"}
        data-memory-correct-save
        onClick={() => {
          if (item === null) return;
          setPhase("pending");
          setError(null);
          void correctMemoryAction(item.memoryItemId, text).then((result) => {
            if (!result.ok) {
              setPhase("idle");
              setError(t(result.message));
              return;
            }
            setPhase("done");
            setTimeout(onSaved, 600);
          });
        }}
      >
        {phase === "pending" ? (
          <Pending>{t("Saving…")}</Pending>
        ) : phase === "done" ? (
          t("Saved")
        ) : (
          t("Save correction")
        )}
      </button>
    </CrmSheet>
  );
}
