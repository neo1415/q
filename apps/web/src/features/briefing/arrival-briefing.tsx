"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  AnimatePresence,
  domAnimation,
  LazyMotion,
  m,
  useReducedMotion,
} from "motion/react";

import type {
  BriefingCommandRequest,
  BriefingCommandResultDto,
} from "@capital-q/contracts";
import {
  focusedCard,
  parseCardCommand,
  remainingAfterFocus,
  startSequence,
  stepSequence,
  type SequenceEffect,
  type SequenceEvent,
  type SequenceState,
} from "@capital-q/q-core/speech";
import { cx } from "@capital-q/ui";
import { Button } from "@capital-q/ui/button";

import { EntityAvatar } from "@/features/entity/entity-avatar";
import {
  noteToLine,
  registerCardDecider,
  setStandingNote,
} from "@/features/voice/line-cards";
import { useNotices } from "@/features/work/notice-store";
import { dismissHeld } from "@/features/work/decision-queue";

import {
  arrivalWords,
  commandCardsOf,
  focusNote,
  planFromReading,
  readSpokenReply,
  sequenceCardOf,
  voiceOutcome,
  type ArrivalCard,
  type ArrivalData,
} from "./arrival";
import {
  arrivalBriefingAction,
  decideArrivalCardAction,
  readArrivalWordsAction,
  type ArrivalDecision,
  type ArrivalDecisionResult,
} from "./arrival-actions";
import {
  claimGreeting,
  isHandled,
  leftIn,
  markHandled,
  markLeft,
  refreshArrival,
  setArrivalSpoken,
  useArrival,
  type ArrivalLoader,
} from "./arrival-store";
import { setRoomFilled, useRoomSlots } from "./arrival-room";

/**
 * Q on arrival (Zino, 2026-10-08; designs docs/design/2026-10-08/briefing
 * and q-presence-room): all of it in a sentence up front ("Three things:
 * ..."), the cards either side of Q on a wide Q page (below it otherwise),
 * and any words about them, typed or said, read into the same verbs.
 * Before that:
 * "Good afternoon, Zino.", the lowdown in a sentence or three, then what
 * needs them as cards, one in focus at a time, with the exact message and
 * Approve & send · Edit & send · Dismiss · Later. Spoken replies reach the
 * same verbs through code (line-cards.ts). Leaving is always one tap; what
 * is left stays in Needs you on Work. Never blocks the page: until the
 * briefing is read, or when there is none, the page's own welcome shows.
 */

export type ArrivalDecide = (
  decision: ArrivalDecision,
) => Promise<ArrivalDecisionResult>;

/** Reads the person's own words into card verbs (BRIEFING_COMMAND). */
export type ArrivalReadWords = (
  request: BriefingCommandRequest,
) => Promise<BriefingCommandResultDto>;

const NAMED_KIND = {
  PERSON: "person",
  COMPANY: "company",
  INVESTOR_ORGANISATION: "investor",
} as const;

function browserZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

/** What happened, in plain words, for the voice and the status line. */
function doneWords(
  effect: SequenceEffect,
  card: ArrivalCard | undefined,
): string {
  const who = card?.counterpart ?? "them";
  switch (effect.kind) {
    case "APPROVE":
      return card?.message === null || card === undefined
        ? `Approved: ${card?.summary ?? "it"}`
        : `Sent to ${who}`;
    case "SEND_EDITED":
      return `Your edited message went to ${who}`;
    case "DISMISS_APPROVAL":
    case "DISMISS_HELD":
      return `Dropped the message to ${who}; nothing was sent`;
    case "RETRY_HELD":
      return `Q wrote the message to ${who} again`;
  }
}

async function run(
  effect: SequenceEffect,
  card: ArrivalCard | undefined,
  decide: ArrivalDecide,
): Promise<ArrivalDecisionResult> {
  switch (effect.kind) {
    case "APPROVE":
      return decide({
        kind: "APPROVE",
        approvalId: effect.approvalId,
        // Exactly what was on screen: the message, or what Q will do.
        shown: card?.message ?? card?.reason ?? null,
      });
    case "SEND_EDITED": {
      const result = await decide({
        kind: "SEND_EDITED",
        relationshipId: effect.relationshipId,
        body: effect.body,
        idempotencyKey: effect.idempotencyKey,
        replacesApprovalId: effect.replacesApprovalId,
      });
      if (result.ok && effect.replacesDraftId !== null) {
        dismissHeld(effect.replacesDraftId);
      }
      return result;
    }
    case "DISMISS_APPROVAL":
      return decide({
        kind: "DISMISS_APPROVAL",
        approvalId: effect.approvalId,
      });
    case "DISMISS_HELD":
      dismissHeld(effect.draftId);
      return { ok: true };
    case "RETRY_HELD": {
      const result = await decide({
        kind: "RETRY_HELD",
        draftId: effect.draftId,
        relationshipId: effect.relationshipId,
        // One rewrite per press.
        idempotencyKey: `retry-${crypto.randomUUID()}`,
      });
      // The old hold is replaced by what came back (a card, or a new hold).
      if (result.ok) dismissHeld(effect.draftId);
      return result;
    }
  }
}

/** The sequence and its one way to change: the same for buttons and voice. */
function useSequence(
  cards: readonly ArrivalCard[],
  decide: ArrivalDecide,
  reload: () => void,
  readWords: ArrivalReadWords,
): {
  readonly state: SequenceState;
  readonly status: string | null;
  readonly reading: boolean;
  readonly send: (
    event: SequenceEvent,
    source: "BUTTON" | "VOICE",
  ) => Promise<Readonly<Record<string, unknown>>>;
  /**
   * Any words about the cards (Zino, 2026-10-08): a plain command acts on
   * the card in focus; anything else is read into card verbs by a model
   * and each verb is checked against the same words by code.
   */
  readonly runWords: (
    words: string,
    source: "BUTTON" | "VOICE",
  ) => Promise<Readonly<Record<string, unknown>> | null>;
} {
  const [state, setState] = useState(() =>
    startSequence(cards.map(sequenceCardOf)),
  );
  const [status, setStatus] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const ref = useRef(state);
  const commit = useCallback((next: SequenceState) => {
    ref.current = next;
    setState(next);
  }, []);
  const send = useCallback(
    async (event: SequenceEvent, source: "BUTTON" | "VOICE") => {
      const before = focusedCard(ref.current)?.key ?? null;
      const step = stepSequence(ref.current, event);
      commit(step.state);
      let done: string | null = null;
      if (step.effect !== null) {
        const effect = step.effect;
        const card = cards.find((one) => one.key === effect.key);
        setStatus(null);
        const result = await run(effect, card, decide).catch(
          (): ArrivalDecisionResult => ({
            ok: false,
            message: "That didn't go through. Nothing was sent.",
          }),
        );
        commit(
          stepSequence(ref.current, {
            type: "SETTLED",
            key: effect.key,
            ok: result.ok,
          }).state,
        );
        done = result.ok
          ? (result.message ?? `${doneWords(effect, card)}.`)
          : result.message;
        setStatus(done);
        // A retry brings a new card (or a new hold): read the cards again.
        if (result.ok && result.reload === true) reload();
      } else if (step.note === "EDIT_NOT_APPLIED") {
        setStatus("That change didn't fit the message. Edit it here instead.");
      }
      // Moved on by a tap while a line is open: Q picks up the next card.
      const after = focusedCard(ref.current)?.key ?? null;
      if (source === "BUTTON" && after !== before) {
        const note = focusNote(cards, ref.current);
        if (note !== null) {
          noteToLine(
            `${note}${done === null ? "" : ` Just now: ${done.replace(/\.$/u, "")}.`} Put this card to them briefly, then stop.`,
            true,
          );
        }
      }
      return voiceOutcome({
        state: ref.current,
        cards,
        note: step.note,
        done,
      });
    },
    [cards, commit, decide, reload],
  );
  const runWords = useCallback(
    async (raw: string, source: "BUTTON" | "VOICE") => {
      const words = raw.trim().slice(0, 700);
      if (words.length === 0) return null;
      const own = parseCardCommand(words);
      if (own !== null) {
        return send({ type: "COMMAND", command: own }, source);
      }
      // Only what is still on screen, in the order it is shown.
      const open = ref.current.cards
        .filter((one) => {
          const outcome = ref.current.outcomes[one.key];
          return outcome === undefined || outcome === "LATER";
        })
        .map((one) => cards.find((card) => card.key === one.key))
        .filter((card): card is ArrivalCard => card !== undefined);
      if (open.length === 0) return null;
      setReading(true);
      setStatus(null);
      const result = await readWords({
        words,
        timeZone: browserZone(),
        cards: commandCardsOf(open),
      })
        .catch(() => null)
        .finally(() => setReading(false));
      if (result === null || result.unclear) {
        if (source === "BUTTON") {
          setStatus(
            "I couldn't tell which card or what to do. Say it another way, or use the buttons.",
          );
        }
        return null;
      }
      const plan = planFromReading(result, open, words);
      let outcome: Readonly<Record<string, unknown>> = {};
      for (const event of plan.events) outcome = await send(event, source);
      if (plan.held.length > 0) {
        setStatus((now) =>
          [now, `${plan.held.join(". ")}.`].filter(Boolean).join(" "),
        );
      }
      return plan.held.length === 0
        ? outcome
        : { ...outcome, heldBack: plan.held };
    },
    [cards, readWords, send],
  );
  return { state, status, reading, send, runWords };
}

function Mark({
  card,
  size,
}: {
  readonly card: ArrivalCard;
  readonly size: number;
}) {
  const name = card.counterpart ?? "Q";
  return (
    <EntityAvatar
      kind={card.named === null ? "company" : NAMED_KIND[card.named.kind]}
      name={name}
      src={card.named?.photoUrl ?? null}
      size={size}
      decorative
    />
  );
}

function Editor({
  initial,
  onSubmit,
  onCancel,
}: {
  readonly initial: string;
  readonly onSubmit: (body: string) => void;
  readonly onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  return (
    <div className="flex flex-col gap-2">
      <label className="sr-only" htmlFor="arrival-edit">
        Your message
      </label>
      <textarea
        id="arrival-edit"
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={Math.min(10, Math.max(4, text.split("\n").length + 1))}
        maxLength={4000}
        className="w-full rounded-(--cq-radius-md) border border-(--cq-border) bg-(--cq-surface) px-3 py-2.5 cq-body-sm text-(--cq-text-primary) outline-none focus:border-(--cq-border-strong)"
        data-arrival-editor
      />
      <div className="flex flex-wrap items-center gap-1">
        <Button
          variant="primary"
          disabled={text.trim().length === 0}
          onClick={() => onSubmit(text)}
        >
          Review
        </Button>
        <Button
          variant="quiet"
          onClick={onCancel}
          className="text-(--cq-text-secondary)"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function FocusCard({
  card,
  state,
  position,
  total,
  compact,
  send,
}: {
  readonly card: ArrivalCard;
  readonly state: SequenceState;
  readonly position: number;
  readonly total: number;
  readonly compact: boolean;
  readonly send: (event: SequenceEvent, source: "BUTTON" | "VOICE") => void;
}) {
  const busy = state.pending === card.key;
  const confirming =
    state.confirming?.key === card.key ? state.confirming : null;
  const command = (
    kind: "APPROVE" | "DISMISS" | "LATER" | "CANCEL" | "RETRY",
  ) => send({ type: "COMMAND", command: { kind } }, "BUTTON");
  // The count is the sequence's header; the card says what it is.
  const meta = card.kind === "HELD" ? "Held back, not sent" : "";
  const place = total > 1 ? `, ${String(position)} of ${String(total)}` : "";
  return (
    <article
      aria-label={`${card.title}${card.counterpart === null ? "" : `, ${card.counterpart}`}${place}`}
      className={cx(
        "relative flex flex-col rounded-(--cq-radius-lg) border border-(--cq-border) bg-(--cq-surface-raised)",
        compact ? "gap-2 p-3" : "gap-3 p-4",
      )}
      data-arrival-card={card.key}
    >
      <div className="flex min-h-11 items-center gap-2.5">
        <Mark card={card} size={compact ? 28 : 32} />
        <div className="min-w-0">
          <p className="m-0 cq-body-sm font-semibold text-(--cq-text-primary)">
            {card.counterpart ?? card.title}
          </p>
          <p className="m-0 cq-caption text-(--cq-text-tertiary)">
            {card.counterpart === null
              ? meta
              : [card.title, meta].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
      {card.theySaid === null ? null : (
        <div className="border-l-2 border-(--cq-border) pl-2.5">
          <p className="m-0 cq-caption text-(--cq-text-tertiary)">
            What they said
          </p>
          <p className="m-0 cq-body-sm text-(--cq-text-secondary)">
            {card.theySaid.length > 280
              ? `${card.theySaid.slice(0, 280)}…`
              : card.theySaid}
          </p>
        </div>
      )}
      {state.editing && !confirming ? (
        <Editor
          initial={card.message ?? ""}
          onSubmit={(body) => send({ type: "EDITED", body }, "BUTTON")}
          onCancel={() => command("CANCEL")}
        />
      ) : confirming !== null ? (
        <>
          <p className="m-0 cq-body font-medium text-(--cq-text-primary)">
            {card.kind === "HELD" && confirming.body === card.message
              ? "Send this exact message?"
              : "Here's your version. Send this exact message?"}
          </p>
          <blockquote
            className="m-0 rounded-(--cq-radius-md) bg-(--cq-surface-sunken) px-3 py-2.5 cq-body-sm whitespace-pre-wrap text-(--cq-text-primary)"
            data-arrival-confirm
          >
            <span className="sr-only">What will be sent: </span>
            {confirming.body}
          </blockquote>
          <div className="flex flex-wrap items-center gap-1">
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => command("APPROVE")}
            >
              Yes, send this
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                send(
                  { type: "COMMAND", command: { kind: "EDIT", edit: null } },
                  "BUTTON",
                )
              }
            >
              Keep editing
            </Button>
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => command("CANCEL")}
              className="text-(--cq-text-secondary)"
            >
              Cancel edit
            </Button>
          </div>
          <p className="m-0 cq-caption text-(--cq-text-tertiary)">
            Nothing is sent until you say yes.
          </p>
        </>
      ) : (
        <>
          {card.message !== null || card.reason !== null ? (
            <div>
              <p className="m-0 mb-0.5 cq-caption text-(--cq-text-tertiary)">
                {card.message !== null
                  ? card.kind === "HELD"
                    ? "What Q drafted"
                    : "What Q will send"
                  : "What Q will do"}
              </p>
              <blockquote
                className={cx(
                  "m-0 rounded-(--cq-radius-md) bg-(--cq-surface-sunken) px-3 py-2.5 cq-body-sm whitespace-pre-wrap text-(--cq-text-primary)",
                  compact && "max-h-32 overflow-y-auto",
                )}
              >
                {card.message ?? card.reason}
              </blockquote>
            </div>
          ) : (
            <p className="m-0 cq-body-sm text-(--cq-text-primary)">
              {card.summary}
            </p>
          )}
          {card.kind === "HELD" && card.reason !== null ? (
            <p className="m-0 cq-caption text-(--cq-text-secondary)">
              {card.reason}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-1" data-arrival-verbs>
            {card.kind === "APPROVAL" ? (
              <Button
                variant="primary"
                disabled={busy || !card.canDecide}
                onClick={() => command("APPROVE")}
              >
                {card.message === null ? "Approve" : "Approve & send"}
              </Button>
            ) : null}
            {card.kind === "HELD" &&
            card.relationshipId !== null &&
            card.message !== null ? (
              // Held, never offered: "Send this exact message?" first.
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => command("APPROVE")}
                data-arrival-send-as-is
              >
                Send as is
              </Button>
            ) : null}
            {card.relationshipId !== null && card.message !== null ? (
              <Button
                variant="secondary"
                disabled={busy || (card.kind === "APPROVAL" && !card.canDecide)}
                onClick={() =>
                  send(
                    { type: "COMMAND", command: { kind: "EDIT", edit: null } },
                    "BUTTON",
                  )
                }
              >
                Edit &amp; send
              </Button>
            ) : null}
            {card.kind === "HELD" && card.draftId !== null ? (
              <Button
                variant="quiet"
                disabled={busy}
                onClick={() => command("RETRY")}
                className="text-(--cq-text-secondary)"
                data-arrival-retry
              >
                {busy ? "Q is trying again…" : "Ask Q to try again"}
              </Button>
            ) : null}
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => command("DISMISS")}
              className="text-(--cq-text-secondary)"
            >
              Dismiss
            </Button>
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => command("LATER")}
              className="text-(--cq-text-secondary)"
            >
              Later
            </Button>
          </div>
          {card.kind === "APPROVAL" && !card.canDecide ? (
            <p className="m-0 cq-caption text-(--cq-text-secondary)">
              Open it on Work to read it in full and decide.
            </p>
          ) : null}
          {compact ? null : (
            <p className="m-0 cq-caption text-(--cq-text-tertiary)">
              Or say “send it”, “change the second sentence to…”, “try again”,
              “skip”, “not now”.
            </p>
          )}
        </>
      )}
    </article>
  );
}

/** A card not in focus: who and what, one tap to bring it forward. */
function CardLine({
  card,
  onFocus,
}: {
  readonly card: ArrivalCard;
  readonly onFocus: () => void;
}) {
  const what =
    card.kind === "HELD"
      ? "Held back, not sent"
      : card.message === null
        ? card.summary
        : card.title;
  return (
    <button
      type="button"
      onClick={onFocus}
      className="flex min-h-13 w-full items-center gap-2.5 rounded-(--cq-radius-md) border border-(--cq-border-subtle) bg-(--cq-surface) px-3 py-2 text-left transition-colors duration-(--cq-motion-fast) hover:border-(--cq-border-strong) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring)"
      data-arrival-line={card.key}
    >
      <Mark card={card} size={28} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate cq-body-sm font-semibold text-(--cq-text-primary)">
          {card.counterpart ?? card.title}
        </span>
        <span className="truncate cq-caption text-(--cq-text-secondary)">
          {what}
        </span>
      </span>
      <span className="sr-only">: bring this one forward</span>
    </button>
  );
}

/** "Tell Q what to do with these": any words, typed (voice says them too). */
function CommandBar({
  busy,
  onWords,
}: {
  readonly busy: boolean;
  readonly onWords: (words: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <form
      className="flex w-full items-center gap-1.5 rounded-full border border-(--cq-border) bg-(--cq-surface-raised) py-1 pr-1 pl-4 focus-within:border-(--cq-border-strong)"
      onSubmit={(event) => {
        event.preventDefault();
        const words = text.trim();
        if (words.length === 0 || busy) return;
        setText("");
        onWords(words);
      }}
      data-arrival-command
    >
      <label className="sr-only" htmlFor="arrival-command">
        Tell Q what to do with these
      </label>
      <input
        id="arrival-command"
        value={text}
        onChange={(event) => setText(event.target.value)}
        maxLength={700}
        placeholder="Tell Q what to do with these"
        autoComplete="off"
        className="min-h-11 min-w-0 flex-1 bg-transparent cq-body-sm text-(--cq-text-primary) outline-none placeholder:text-(--cq-text-tertiary)"
      />
      <Button
        type="submit"
        variant="secondary"
        disabled={busy || text.trim().length === 0}
        className="rounded-full"
      >
        {busy ? "Reading…" : "Do it"}
      </Button>
    </form>
  );
}

const EASE = [0.2, 0, 0, 1] as const;

/** The cards, one in focus, the others a line each; around Q when wide. */
function Sequence({
  data,
  decide,
  readWords,
  compact,
  nudge,
  round,
  onSettled,
  reload,
}: {
  readonly data: ArrivalData;
  readonly decide: ArrivalDecide;
  readonly readWords: ArrivalReadWords;
  readonly compact: boolean;
  readonly nudge: boolean;
  readonly round: number;
  readonly onSettled?: (() => void) | undefined;
  /** New cards may be waiting (a retry): read the briefing again. */
  readonly reload: () => void;
}) {
  const { state, status, reading, send, runWords } = useSequence(
    data.cards,
    decide,
    reload,
    readWords,
  );
  const reduced = useReducedMotion() === true;
  // What this sequence settled stays settled across pages (arrival-store).
  useEffect(() => {
    for (const key of Object.keys(state.outcomes)) markHandled(key);
    if (state.left) markLeft(round);
  }, [state.outcomes, state.left, round]);
  const card = focusedCard(state);
  const current =
    card === null ? undefined : data.cards.find((one) => one.key === card.key);
  const left = remainingAfterFocus(state);
  const active = current !== undefined;
  const settledRef = useRef(onSettled);
  useEffect(() => {
    settledRef.current = onSettled;
  }, [onSettled]);
  useEffect(() => {
    if (!active) settledRef.current?.();
  }, [active]);

  // Around Q on a wide Q page; below Q (inline) everywhere else.
  const room = useRoomSlots();
  const wide = useWide();
  const flank =
    !compact && wide && room.left !== null && room.right !== null && active;
  useEffect(() => {
    setRoomFilled(flank);
    return () => setRoomFilled(false);
  }, [flank]);

  // The open line knows which card is in focus; a line opened later too.
  useEffect(() => {
    setStandingNote(active ? focusNote(data.cards, state) : null);
    return () => setStandingNote(null);
  }, [active, data.cards, state]);

  // Spoken replies: the person's own words, read by the same code as the
  // buttons (never the model's say-so); anything else they say about the
  // cards is read from their own transcript into the same verbs.
  const sendRef = useRef(send);
  const wordsRef = useRef(runWords);
  useEffect(() => {
    sendRef.current = send;
    wordsRef.current = runWords;
  }, [send, runWords]);
  useEffect(() => {
    if (!active) return;
    return registerCardDecider(async ({ words, heard }) => {
      const spoken = readSpokenReply({ words, heard });
      if (spoken.kind === "COMMAND") {
        return sendRef.current(
          { type: "COMMAND", command: spoken.command },
          "VOICE",
        );
      }
      // Any other words: only the provider's transcript of the person.
      const own = heard?.trim() ?? "";
      if (own.length > 0) {
        const outcome = await wordsRef.current(own, "VOICE");
        if (outcome !== null) return outcome;
      }
      return spoken.kind === "UNSURE"
        ? {
            ok: false,
            situation:
              "Their words didn't come through clearly as a decision. Nothing was done; ask them to say it again or tap the button.",
          }
        : {
            ok: false,
            situation:
              "That isn't about the cards. Pass their words to ask_q; the cards stay on screen.",
          };
    });
  }, [active]);

  // A nudge: a new card while a line is open is mentioned once, gently.
  const nudged = useRef(false);
  useEffect(() => {
    if (!nudge || nudged.current || !active) return;
    nudged.current = true;
    const note = focusNote(data.cards, state);
    if (note !== null) {
      noteToLine(
        `${note} This just came in from Q's work. At a natural pause, mention it once, gently, in a sentence; don't interrupt them.`,
        true,
      );
    }
  }, [nudge, active, data.cards, state]);

  if (!active) {
    if (state.left) {
      return (
        <p className="m-0 cq-body-sm text-(--cq-text-secondary)" role="status">
          Fine. Anything left is in Needs you on Work.
        </p>
      );
    }
    return status === null ? null : (
      <p className="m-0 cq-body-sm text-(--cq-text-secondary)" role="status">
        {status} That&apos;s everything for now.
      </p>
    );
  }

  const focusCard = (
    <FocusCard
      key={`${current.key}-${state.confirming === null ? "a" : "c"}`}
      card={current}
      state={state}
      position={state.focus + 1}
      total={state.cards.length}
      compact={compact}
      send={(event, source) => void send(event, source)}
    />
  );
  // Still to decide, in the order they came: the one in focus is full.
  const open = data.cards.filter((one) => {
    const outcome = state.outcomes[one.key];
    return outcome === undefined || outcome === "LATER";
  });
  const item = (one: ArrivalCard, index: number) => (
    <m.div
      key={one.key}
      layout={reduced ? false : "position"}
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
      transition={{ duration: reduced ? 0 : 0.22, ease: EASE }}
      data-arrival-item={index}
    >
      {one.key === current.key ? (
        focusCard
      ) : (
        <CardLine
          card={one}
          onFocus={() => void send({ type: "FOCUS", key: one.key }, "BUTTON")}
        />
      )}
    </m.div>
  );
  // Left, right, left...: each card keeps its side, so nothing jumps.
  const sides = { left: [] as ReactNode[], right: [] as ReactNode[] };
  open.forEach((one) => {
    const index = data.cards.findIndex((card) => card.key === one.key);
    (index % 2 === 0 ? sides.left : sides.right).push(item(one, index));
  });

  return (
    <section
      aria-label="Needs you"
      className={cx("flex w-full flex-col", compact ? "gap-2" : "gap-2.5")}
      data-arrival-sequence
      data-arrival-layout={compact ? "dock" : flank ? "room" : "below"}
    >
      <div className="flex min-h-11 items-center gap-2">
        <h2 className="m-0 cq-body font-semibold text-(--cq-text-primary)">
          {nudge ? "New for you" : "Needs you"}
        </h2>
        {state.cards.length > 1 ? (
          <span
            className="cq-caption text-(--cq-text-tertiary)"
            data-arrival-count
          >
            {state.focus + 1} of {state.cards.length}
          </span>
        ) : null}
        <Button
          variant="quiet"
          className="ml-auto text-(--cq-text-secondary)"
          onClick={() =>
            void send({ type: "COMMAND", command: { kind: "LEAVE" } }, "BUTTON")
          }
          data-arrival-leave
        >
          Not now
        </Button>
      </div>
      {compact ? (
        <div className="relative">
          {left > 0 ? (
            <div
              aria-hidden="true"
              className="absolute inset-x-3 -bottom-1.5 h-full rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface)"
            />
          ) : null}
          {focusCard}
        </div>
      ) : (
        <LazyMotion features={domAnimation} strict>
          {flank && room.left !== null && room.right !== null ? (
            <>
              {createPortal(
                <AnimatePresence initial={false}>{sides.left}</AnimatePresence>,
                room.left,
              )}
              {createPortal(
                <AnimatePresence initial={false}>
                  {sides.right}
                </AnimatePresence>,
                room.right,
              )}
            </>
          ) : (
            <div className="flex flex-col gap-2.5" data-arrival-below>
              <AnimatePresence initial={false}>
                {open.map((one) =>
                  item(
                    one,
                    data.cards.findIndex((card) => card.key === one.key),
                  ),
                )}
              </AnimatePresence>
            </div>
          )}
        </LazyMotion>
      )}
      <CommandBar
        busy={reading || state.pending !== null}
        onWords={(words) => void runWords(words, "BUTTON")}
      />
      <p
        className="m-0 mt-1 cq-caption text-(--cq-text-tertiary)"
        role="status"
        data-arrival-status
      >
        {reading ? "Q is reading that… " : ""}
        {status === null ? "" : `${status} `}
        {left > 0
          ? `${String(left)} more after this. Anything you leave stays in Needs you on Work.`
          : ""}
      </p>
    </section>
  );
}

const WIDE_QUERY = "(min-width: 1024px)";
function subscribeWide(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
/** Room for columns either side of Q (Tailwind's lg). */
function useWide(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () =>
      typeof window.matchMedia === "function" &&
      window.matchMedia(WIDE_QUERY).matches,
    () => false,
  );
}

const defaultLoad: ArrivalLoader = (since) => arrivalBriefingAction(since);
const defaultDecide: ArrivalDecide = (decision) =>
  decideArrivalCardAction(decision);
const defaultReadWords: ArrivalReadWords = (request) =>
  readArrivalWordsAction(request);

/** New decisions later (an agent needs them): a NEEDS_YOU notice arrives. */
function useLaterCards(load: ArrivalLoader, ready: boolean): void {
  const items = useNotices().items;
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!ready || items === null) return;
    const waiting = items
      .filter((item) => item.priority === "NEEDS_YOU" && !item.read)
      .map((item) => item.id);
    if (known.current === null) {
      known.current = new Set(waiting);
      return;
    }
    const fresh = waiting.filter((id) => !known.current?.has(id));
    for (const id of fresh) known.current.add(id);
    if (fresh.length > 0) refreshArrival(load);
  }, [items, ready, load]);
}

export function ArrivalBriefing({
  variant,
  fallback = null,
  load = defaultLoad,
  decide = defaultDecide,
  readWords = defaultReadWords,
  now,
  onSettled,
  onClose,
}: {
  readonly variant: "page" | "dock";
  /** The cards are all decided, or the person left them. */
  readonly onSettled?: (() => void) | undefined;
  /** Dock: the person closed it. */
  readonly onClose?: (() => void) | undefined;
  /** The page's own welcome, shown until (and unless) there is a briefing. */
  readonly fallback?: ReactNode;
  readonly load?: ArrivalLoader;
  readonly decide?: ArrivalDecide;
  /** Reads their own words into card verbs (the dev harness scripts it). */
  readonly readWords?: ArrivalReadWords;
  /** The clock (the dev harness fixes it). */
  readonly now?: (() => Date) | undefined;
}) {
  const status = useArrival(load);
  useLaterCards(load, status.kind !== "PENDING");
  const loaded = status.kind === "READY" ? status : null;
  // Once per round: the first surface greets; a later one (another page,
  // the Q page again) shows only what is still undecided.
  const [greets, setGreets] = useState<{
    round: number;
    fresh: boolean;
  } | null>(null);
  const claimed = useRef<number | null>(null);
  useEffect(() => {
    if (loaded === null || greets?.round === loaded.round) return;
    // This surface's own claim survives a re-run of the effect.
    const fresh =
      claimed.current === loaded.round || claimGreeting(loaded.round);
    if (fresh) claimed.current = loaded.round;
    setGreets({ round: loaded.round, fresh });
  }, [loaded, greets]);
  const ready = useMemo(() => {
    if (loaded === null || greets?.round !== loaded.round) return null;
    const cards = leftIn(loaded.round)
      ? []
      : loaded.data.cards.filter((card) => !isHandled(card.key));
    return {
      ...loaded,
      // A round already greeted elsewhere: no greeting again, cards only.
      quietHead: loaded.nudge || !greets.fresh,
      data: { ...loaded.data, cards },
    };
  }, [loaded, greets]);
  const words = useMemo(
    () =>
      ready === null
        ? null
        : arrivalWords(ready.data, now?.() ?? new Date(), browserZone()),
    [ready, now],
  );
  useEffect(() => {
    if (words !== null && ready !== null && !ready.quietHead) {
      setArrivalSpoken(words.spoken);
    }
  }, [words, ready]);

  if (ready === null || words === null) return <>{fallback}</>;
  const compact = variant === "dock";
  // On another page, a quiet day says nothing: the dock does not pop up.
  if (compact && ready.data.cards.length === 0 && words.quiet) return null;
  // Nothing left to put to them, and the greeting was given: the page's
  // own welcome (or, in the dock, nothing).
  if (ready.quietHead && ready.data.cards.length === 0) {
    return compact ? null : <>{fallback}</>;
  }
  return (
    <div
      className={cx(
        "flex w-full flex-col",
        compact ? "gap-2.5" : "items-stretch gap-5",
      )}
      data-arrival={variant}
      data-arrival-quiet={words.quiet ? "" : undefined}
    >
      {ready.quietHead ? (
        variant === "page" ? (
          fallback
        ) : null
      ) : compact ? (
        <div className="flex items-start gap-2">
          <p className="m-0 flex-1 cq-body-sm text-(--cq-text-secondary)">
            <span className="font-semibold text-(--cq-text-primary)">
              {words.greeting}
            </span>{" "}
            {words.lowdown}
            {words.summary === null ? null : (
              <>
                {" "}
                <span data-arrival-summary>{words.summary}</span>
              </>
            )}
          </p>
          {onClose === undefined ? null : (
            <Button
              variant="quiet"
              onClick={onClose}
              className="-mt-2 -mr-2 text-(--cq-text-secondary)"
              aria-label="Close Q's briefing"
            >
              Close
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 text-center">
          <h1
            id="returning-headline"
            className="cq-title-lg text-balance text-(--cq-text-primary)"
            data-arrival-greeting
          >
            {words.greeting}
          </h1>
          <p
            className="cq-body-lg cq-prose text-balance text-(--cq-text-secondary)"
            data-arrival-lowdown
          >
            {words.lowdown}
          </p>
          {words.summary === null ? null : (
            <p
              className="cq-body cq-prose text-balance text-(--cq-text-primary)"
              data-arrival-summary
            >
              {words.summary}
            </p>
          )}
        </div>
      )}
      {ready.data.cards.length === 0 ? null : (
        <Sequence
          key={ready.round}
          data={ready.data}
          decide={decide}
          readWords={readWords}
          compact={compact}
          nudge={ready.nudge}
          round={ready.round}
          onSettled={onSettled}
          reload={() => refreshArrival(load)}
        />
      )}
    </div>
  );
}

/**
 * For the dev harness: feed words through the voice path (as if heard
 * from the person), returning what the voice would be told.
 */
export function heardOnLine(said: string): Promise<string | null> {
  return import("@/features/voice/line-cards").then(({ decideCardByVoice }) =>
    decideCardByVoice(JSON.stringify({ words: said }), said),
  );
}
