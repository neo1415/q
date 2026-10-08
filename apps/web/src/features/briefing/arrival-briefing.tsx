"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  focusedCard,
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
  focusNote,
  readSpokenReply,
  sequenceCardOf,
  voiceOutcome,
  type ArrivalCard,
  type ArrivalData,
} from "./arrival";
import {
  arrivalBriefingAction,
  decideArrivalCardAction,
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

/**
 * Q on arrival (Zino, 2026-10-08; design docs/design/2026-10-08/briefing):
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
  }
}

/** The sequence and its one way to change: the same for buttons and voice. */
function useSequence(
  cards: readonly ArrivalCard[],
  decide: ArrivalDecide,
): {
  readonly state: SequenceState;
  readonly status: string | null;
  readonly send: (
    event: SequenceEvent,
    source: "BUTTON" | "VOICE",
  ) => Promise<Readonly<Record<string, unknown>>>;
} {
  const [state, setState] = useState(() =>
    startSequence(cards.map(sequenceCardOf)),
  );
  const [status, setStatus] = useState<string | null>(null);
  const ref = useRef(state);
  const commit = useCallback((next: SequenceState) => {
    ref.current = next;
    setState(next);
  }, []);
  const send = useCallback(
    async (event: SequenceEvent, source: "BUTTON" | "VOICE") => {
      const before = ref.current.focus;
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
        done = result.ok ? doneWords(effect, card) : result.message;
        setStatus(result.ok ? `${done}.` : result.message);
      } else if (step.note === "EDIT_NOT_APPLIED") {
        setStatus("That change didn't fit the message. Edit it here instead.");
      }
      // Moved on by a tap while a line is open: Q picks up the next card.
      if (source === "BUTTON" && ref.current.focus !== before) {
        const note = focusNote(cards, ref.current);
        if (note !== null) {
          noteToLine(
            `${note}${done === null ? "" : ` Just now: ${done}.`} Put this card to them briefly, then stop.`,
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
    [cards, commit, decide],
  );
  return { state, status, send };
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
  const command = (kind: "APPROVE" | "DISMISS" | "LATER" | "CANCEL") =>
    send({ type: "COMMAND", command: { kind } }, "BUTTON");
  const meta = [
    card.kind === "HELD" ? "Held back, not sent" : null,
    total > 1 ? `${String(position)} of ${String(total)}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
  return (
    <article
      aria-label={`${card.title}${card.counterpart === null ? "" : `, ${card.counterpart}`}`}
      className={cx(
        "relative z-[1] flex flex-col rounded-(--cq-radius-lg) border border-(--cq-border) bg-(--cq-surface-raised)",
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
              ? "Send this as it is?"
              : "Here's your version. Send this?"}
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
            {card.relationshipId !== null && card.message !== null ? (
              <Button
                variant={card.kind === "HELD" ? "primary" : "secondary"}
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
              Or say “send it”, “change the second sentence to…”, “skip”, “not
              now”.
            </p>
          )}
        </>
      )}
    </article>
  );
}

/** The cards, one in focus, the rest a count. */
function Sequence({
  data,
  decide,
  compact,
  nudge,
  round,
  onSettled,
}: {
  readonly data: ArrivalData;
  readonly decide: ArrivalDecide;
  readonly compact: boolean;
  readonly nudge: boolean;
  readonly round: number;
  readonly onSettled?: (() => void) | undefined;
}) {
  const { state, status, send } = useSequence(data.cards, decide);
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

  // The open line knows which card is in focus; a line opened later too.
  useEffect(() => {
    setStandingNote(active ? focusNote(data.cards, state) : null);
    return () => setStandingNote(null);
  }, [active, data.cards, state]);

  // Spoken replies to the card in focus: the person's own words, read by
  // the same code as the buttons (never the model's say-so).
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);
  useEffect(() => {
    if (!active) return;
    return registerCardDecider(async ({ words, heard }) => {
      const reading = readSpokenReply({ words, heard });
      if (reading.kind === "NOT_A_COMMAND") {
        return {
          ok: false,
          situation:
            "That isn't a reply to the card. Pass their words to ask_q; the card stays on screen.",
        };
      }
      if (reading.kind === "UNSURE") {
        return {
          ok: false,
          situation:
            "Their words didn't come through clearly as a decision. Nothing was done; ask them to say it again or tap the button.",
        };
      }
      return sendRef.current(
        { type: "COMMAND", command: reading.command },
        "VOICE",
      );
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
        {status} That's everything for now.
      </p>
    );
  }
  return (
    <section
      aria-label="Needs you"
      className={cx("flex w-full flex-col", compact ? "gap-2" : "gap-2.5")}
      data-arrival-sequence
    >
      <div className="flex min-h-11 items-center gap-2">
        <h2 className="m-0 cq-body font-semibold text-(--cq-text-primary)">
          {nudge ? "New for you" : "Needs you"}
        </h2>
        {data.cards.length > 1 ? (
          <span
            className="cq-caption text-(--cq-text-tertiary)"
            data-arrival-count
          >
            {state.focus + 1} of {data.cards.length}
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
      <div className="relative">
        {left > 0 ? (
          <div
            aria-hidden="true"
            className="absolute inset-x-3 -bottom-1.5 h-full rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface)"
          />
        ) : null}
        <FocusCard
          key={`${current.key}-${state.confirming === null ? "a" : "c"}`}
          card={current}
          state={state}
          position={state.focus + 1}
          total={data.cards.length}
          compact={compact}
          send={(event, source) => void send(event, source)}
        />
      </div>
      <p
        className="m-0 mt-1 cq-caption text-(--cq-text-tertiary)"
        role="status"
        data-arrival-status
      >
        {status === null ? "" : `${status} `}
        {left > 0
          ? `${String(left)} more after this. Anything you leave stays in Needs you on Work.`
          : ""}
      </p>
    </section>
  );
}

const defaultLoad: ArrivalLoader = (since) => arrivalBriefingAction(since);
const defaultDecide: ArrivalDecide = (decision) =>
  decideArrivalCardAction(decision);

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
        </div>
      )}
      {ready.data.cards.length === 0 ? null : (
        <Sequence
          key={ready.round}
          data={ready.data}
          decide={decide}
          compact={compact}
          nudge={ready.nudge}
          round={ready.round}
          onSettled={onSettled}
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
