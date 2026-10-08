"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { cx } from "@capital-q/ui";
import { Button, buttonClassName } from "@capital-q/ui/button";

import { useGlobalQ } from "@/components/app-shell/global-q";
import { Q_SAID_EVENT, saidText } from "@/features/q-swarm/q-said";
import { useQSessionOptional } from "@/features/q/q-session";
import { noteToLine } from "@/features/voice/line-cards";

import { activityLines, arrivalWords, type ArrivalData } from "./arrival";
import {
  defaultDecide,
  defaultLoad,
  defaultReadWords,
  Sequence,
  useLaterCards,
  type ArrivalDecide,
  type ArrivalReadWords,
} from "./arrival-briefing";
import { setRoomFilled, useRoomSlots, useStageMode } from "./arrival-room";
import {
  arrivalSaidOnLine,
  isHandled,
  leftIn,
  markArrivalSaid,
  refreshArrival,
  useArrival,
  type ArrivalLoader,
} from "./arrival-store";
import { attentionHref, attentionLines, unreadWords } from "./attention";
import {
  FIT_IS_NOT_QUALITY,
  rememberSeenMatches,
  type ArrivalMatch,
} from "./matches";
import {
  revealedGroups,
  stageFocusFor,
  type StageGroup,
  type StageTarget,
} from "./stage-focus";

/**
 * The arrival as a layer of the Q stage (RECOVERY-2026-10 E1, audit
 * E-01). Zino, 2026-10-08: "a full summary of all it has done, then all
 * the things that need my attention ... as an investor it notices new
 * companies that meet my mandate ... cards appear and disappear based on
 * what it's talking about ... by the sides of the Q presence, some below
 * when needed".
 *
 * The Q page renders this once, beside (never inside) its welcome and
 * conversation branches, so it lives as long as the page: the cards stay
 * beside Q while Q speaks and the conversation runs, and the voice
 * decider stays registered. Where they go:
 *
 * - FULL, wide, columns mounted: What I did above the decisions on the
 *   left, the decisions on the right (the sequence's own left/right
 *   rule), new matches below.
 * - FULL otherwise: one stack below Q.
 * - STRIP (an answer holds the centre, or the thread is the view): one
 *   line below Q, one tap to open it in place.
 *
 * Each line Q says is matched by code (stage-focus.ts): a group appears
 * as Q reaches it during a spoken briefing, and a card Q names comes into
 * focus.
 */

const WIDE_QUERY = "(min-width: 1024px)";
function subscribeWide(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
function useWide(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () =>
      typeof window.matchMedia === "function" &&
      window.matchMedia(WIDE_QUERY).matches,
    () => false,
  );
}

function browserZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

/** How long a spoken briefing may hold a group back before it shows anyway. */
const REVEAL_SETTLE_MS = 12_000;

const CARD =
  "flex flex-col gap-2 rounded-(--cq-radius-lg) border border-(--cq-border) bg-(--cq-surface-raised) p-4";

function GroupHead({
  title,
  count,
}: {
  readonly title: string;
  readonly count?: number | undefined;
}) {
  return (
    <div className="flex min-h-9 items-center gap-2">
      <h2 className="m-0 cq-body font-semibold text-(--cq-text-primary)">
        {title}
      </h2>
      {count === undefined || count < 2 ? null : (
        <span className="cq-caption text-(--cq-text-tertiary)">
          {String(count)}
        </span>
      )}
    </div>
  );
}

/** What Q and its agents did since they were last here. */
export function ActivityCard({
  lines,
}: {
  readonly lines: readonly string[] | null;
}) {
  return (
    <section
      aria-label="What I did"
      className="flex flex-col gap-2"
      data-arrival-activity
    >
      <GroupHead title="What I did" />
      <div className={CARD}>
        {lines === null ? (
          <p className="m-0 cq-body-sm text-(--cq-text-secondary)">
            I couldn&apos;t check what my agents did just now.
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {lines.map((line) => (
              <li
                key={line}
                className="cq-body-sm text-(--cq-text-primary)"
                data-arrival-activity-line
              >
                {line}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** What needs them that is acted on elsewhere, and what could not be read. */
export function AttentionList({ data }: { readonly data: ArrivalData }) {
  const report = data.attention;
  if (report === null || report === undefined) return null;
  const lines = attentionLines(report);
  const unread = unreadWords(report.unread);
  if (lines.length === 0 && unread === null) return null;
  const links = new Map(Object.entries(data.attentionLinks ?? {}));
  return (
    <ul
      aria-label="Also waiting on you"
      className="m-0 flex list-none flex-col gap-1.5 p-0"
      data-arrival-attention
    >
      {lines.slice(0, 6).map((item) => (
        <li
          key={item.key}
          className="flex min-h-11 items-center gap-2 rounded-(--cq-radius-md) border border-(--cq-border-subtle) bg-(--cq-surface) px-3 py-1.5"
          data-arrival-attention-item={item.source}
        >
          <span className="min-w-0 flex-1 cq-body-sm text-(--cq-text-primary)">
            {item.title}
          </span>
          <Link
            href={attentionHref(item, links)}
            className={buttonClassName("quiet", "compact")}
          >
            Open
          </Link>
        </li>
      ))}
      {unread === null ? null : (
        <li
          className="cq-caption text-(--cq-text-secondary)"
          role="status"
          data-arrival-unread
        >
          {unread}
        </li>
      )}
    </ul>
  );
}

const BAND_SHORT: Readonly<Record<string, string>> = {
  STRONG_FIT: "Strong fit with your mandate",
  GOOD_FIT: "Good fit with your mandate",
  PARTIAL_FIT: "Partial fit with your mandate",
  WEAK_FIT: "Weak fit with your mandate",
  NOT_ENOUGH_INFORMATION: "Fit not known yet",
  OUTSIDE_MANDATE: "Outside a rule you declared",
};

/** One new matching company, with Q's take (fit, never quality). */
export function MatchCard({
  match,
  focused,
  onAsk,
}: {
  readonly match: ArrivalMatch;
  readonly focused: boolean;
  readonly onAsk: (question: string) => void;
}) {
  const facts = [match.stage, match.country].filter(
    (part): part is string => part !== null && part.length > 0,
  );
  return (
    <article
      aria-label={match.name}
      className={cx(
        CARD,
        focused && "border-(--cq-border-strong) bg-(--cq-surface-subtle)",
      )}
      data-arrival-match={match.companyId}
      data-focused={focused ? "" : undefined}
    >
      <div className="flex flex-col">
        <p className="m-0 cq-body-sm font-semibold text-(--cq-text-primary)">
          {match.name}
        </p>
        <p className="m-0 cq-caption text-(--cq-text-tertiary)">
          {[...facts, match.band === null ? null : BAND_SHORT[match.band]]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      {match.line === null ? null : (
        <p className="m-0 cq-body-sm text-(--cq-text-secondary)">
          {match.line}
        </p>
      )}
      <p className="m-0 cq-body-sm text-(--cq-text-primary)">
        <span className="font-semibold">Q&apos;s take: </span>
        {match.take.replace(FIT_IS_NOT_QUALITY, "").trim()}{" "}
        <span className="text-(--cq-text-secondary)">{FIT_IS_NOT_QUALITY}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/company/${encodeURIComponent(match.companyId)}`}
          className={buttonClassName("secondary", "compact")}
        >
          Open
        </Link>
        <button
          type="button"
          className={buttonClassName("quiet", "compact")}
          onClick={() => {
            onAsk(`What's your view on ${match.name}?`);
          }}
        >
          Ask Q&apos;s view
        </button>
      </div>
    </article>
  );
}

function MatchesGroup({
  matches,
  focus,
  onAsk,
}: {
  readonly matches: NonNullable<ArrivalData["matches"]>;
  readonly focus: string | null;
  readonly onAsk: (question: string) => void;
}) {
  const [shown, setShown] = useState<string | null>(null);
  const open = focus ?? shown ?? matches.items[0]?.companyId ?? null;
  return (
    <section
      aria-label="New for you"
      className="flex flex-col gap-2"
      data-arrival-matches
    >
      <GroupHead
        title={
          matches.label === "SINCE_LAST_VISIT"
            ? "New for you"
            : "In your feed, not looked at yet"
        }
        count={matches.total}
      />
      {matches.items.map((match) =>
        match.companyId === open ? (
          <MatchCard
            key={match.companyId}
            match={match}
            focused={focus === match.companyId}
            onAsk={onAsk}
          />
        ) : (
          <button
            key={match.companyId}
            type="button"
            onClick={() => setShown(match.companyId)}
            className="flex min-h-11 w-full items-center gap-2 rounded-(--cq-radius-md) border border-(--cq-border-subtle) bg-(--cq-surface) px-3 py-2 text-left transition-colors duration-(--cq-motion-fast) hover:border-(--cq-border-strong) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring)"
            data-arrival-match-line={match.companyId}
          >
            <span className="min-w-0 flex-1 truncate cq-body-sm font-semibold text-(--cq-text-primary)">
              {match.name}
            </span>
            <span className="cq-caption text-(--cq-text-tertiary)">
              {match.band === null ? "" : (BAND_SHORT[match.band] ?? "")}
            </span>
          </button>
        ),
      )}
      {matches.total > matches.items.length ? (
        <Link href="/discover" className={buttonClassName("quiet", "compact")}>
          See all {String(matches.total)} in Discover
        </Link>
      ) : null}
    </section>
  );
}

/** The arrival's round, the cards still open, without claiming the greeting. */
function useStageRound(load: ArrivalLoader) {
  const status = useArrival(load);
  useLaterCards(load, status.kind !== "PENDING");
  return useMemo(() => {
    if (status.kind !== "READY") return null;
    const cards = leftIn(status.round)
      ? []
      : status.data.cards.filter((card) => !isHandled(card.key));
    return { ...status, data: { ...status.data, cards } };
  }, [status]);
}

export function ArrivalStage({
  load = defaultLoad,
  decide = defaultDecide,
  readWords = defaultReadWords,
  now,
}: {
  readonly load?: ArrivalLoader;
  readonly decide?: ArrivalDecide;
  readonly readWords?: ArrivalReadWords;
  readonly now?: (() => Date) | undefined;
} = {}) {
  const ready = useStageRound(load);
  const mode = useStageMode();
  const room = useRoomSlots();
  const wide = useWide();
  const session = useQSessionOptional();
  const voiceActive = session?.voice.active === true;
  const { askNow } = useGlobalQ();
  const [expanded, setExpanded] = useState(false);
  const data = ready?.data ?? null;

  // Words for the late-landing case below; the same words the head says.
  const words = useMemo(
    () =>
      data === null
        ? null
        : arrivalWords(data, now?.() ?? new Date(), browserZone()),
    [data, now],
  );

  const activity =
    data === null ? null : activityLines(data.activity, data.jobsDone);
  const hasActivity = activity === null || activity.length > 0;
  const matches = data?.matches ?? null;
  const hasMatches = matches !== null && matches.items.length > 0;
  const attentionShown =
    data?.attention !== null &&
    data?.attention !== undefined &&
    (attentionLines(data.attention).length > 0 ||
      data.attention.unread.length > 0);
  const hasNeeds = (data?.cards.length ?? 0) > 0 || attentionShown;
  const present = useMemo(() => {
    const groups: StageGroup[] = [];
    if (data === null) return groups;
    if (hasActivity) groups.push("ACTIVITY");
    if (hasNeeds) groups.push("NEEDS_YOU");
    if (hasMatches) groups.push("MATCHES");
    return groups;
  }, [data, hasActivity, hasNeeds, hasMatches]);

  // Cards that follow speech: a group shows as Q reaches it on a spoken
  // briefing, and a card Q names comes into focus.
  const [reached, setReached] = useState<ReadonlySet<StageGroup>>(new Set());
  const [focus, setFocus] = useState<string | null>(null);
  const [settled, setSettled] = useState(false);
  // Whether a line was open when the briefing landed (Q is saying it).
  const [speakingAtStart, setSpeakingAtStart] = useState<boolean | null>(null);
  if (data !== null && speakingAtStart === null) {
    setSpeakingAtStart(voiceActive);
  }
  useEffect(() => {
    if (data === null) return;
    const timer = window.setTimeout(() => setSettled(true), REVEAL_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [data]);
  const targets = useMemo<readonly StageTarget[]>(() => {
    if (data === null) return [];
    return [
      ...data.cards.map((card) => ({
        key: card.key,
        group: "NEEDS_YOU" as const,
        names: [card.counterpart ?? "", card.title],
      })),
      ...(matches?.items ?? []).map((match) => ({
        key: match.companyId,
        group: "MATCHES" as const,
        names: [match.name],
      })),
    ];
  }, [data, matches]);
  useEffect(() => {
    const onSaid = (event: Event) => {
      const text = saidText(event);
      if (text === null) return;
      const found = stageFocusFor(text, targets);
      if (found.reveal.length > 0) {
        setReached((before) => {
          const next = new Set(before);
          for (const group of found.reveal) next.add(group);
          return next;
        });
      }
      if (found.focus !== null) setFocus(found.focus);
    };
    window.addEventListener(Q_SAID_EVENT, onSaid);
    return () => window.removeEventListener(Q_SAID_EVENT, onSaid);
  }, [targets]);
  const shown = revealedGroups({
    present,
    speaking: speakingAtStart === true,
    reached,
    settled,
  });

  // E-05: the call opened before the briefing was read, so Q opened
  // without it. Now that it is here, the line gets it once, to say at a
  // natural pause.
  const handedLate = useRef(false);
  useEffect(() => {
    if (words === null || handedLate.current || !voiceActive) return;
    if (arrivalSaidOnLine() || ready?.nudge === true) return;
    handedLate.current = true;
    markArrivalSaid(true);
    noteToLine(
      `Your briefing for them just came in: "${words.spoken}" At a natural pause, tell them this in your own words, briefly, then stop.`,
      true,
    );
  }, [words, voiceActive, ready?.nudge]);

  // What this arrival showed is remembered, so the next one says "new"
  // only of what is new (a per-browser convenience).
  useEffect(() => {
    if (matches !== null && matches.items.length > 0) {
      rememberSeenMatches(matches.items.map((item) => item.companyId));
    }
  }, [matches]);

  const strip = mode === "STRIP" && !expanded;
  const beside =
    !strip &&
    mode === "FULL" &&
    wide &&
    room.leftTop !== null &&
    room.rightBottom !== null;
  const besideActivity = beside && shown.includes("ACTIVITY");
  const besideMatches = beside && shown.includes("MATCHES");
  useEffect(() => {
    setRoomFilled(besideActivity || besideMatches, "stage");
    return () => setRoomFilled(false, "stage");
  }, [besideActivity, besideMatches]);
  // Back to FULL: the person's "Show" has done its job.
  const [modeSeen, setModeSeen] = useState(mode);
  if (modeSeen !== mode) {
    setModeSeen(mode);
    if (mode === "FULL") setExpanded(false);
  }

  if (data === null || present.length === 0) return null;

  const activityCard = shown.includes("ACTIVITY") ? (
    <ActivityCard lines={activity} />
  ) : null;
  const needs = shown.includes("NEEDS_YOU") ? (
    <section
      aria-label="Needs you"
      className="flex flex-col gap-2"
      data-arrival-needs
    >
      {data.cards.length === 0 ? <GroupHead title="Needs you" /> : null}
      {data.cards.length === 0 ? null : (
        <Sequence
          key={ready?.round ?? 0}
          data={data}
          decide={decide}
          readWords={readWords}
          compact={false}
          nudge={ready?.nudge === true}
          round={ready?.round ?? 0}
          reload={() => refreshArrival(load)}
          collapsed={strip}
          onExpand={() => setExpanded(true)}
          focusKey={focus}
        />
      )}
      {strip ? null : <AttentionList data={data} />}
    </section>
  ) : null;
  const matchesGroup =
    shown.includes("MATCHES") && matches !== null ? (
      <MatchesGroup
        matches={matches}
        focus={
          focus !== null &&
          matches.items.some((item) => item.companyId === focus)
            ? focus
            : null
        }
        onAsk={askNow}
      />
    ) : null;

  if (strip) {
    const parts = [
      hasActivity ? "What I did" : null,
      hasMatches && matches !== null
        ? `New for you · ${String(matches.total)}`
        : null,
    ].filter((part): part is string => part !== null);
    const line = (
      <div
        className="flex w-full flex-col gap-1 border-t border-(--cq-border-subtle) pt-2"
        data-arrival-stage="strip"
      >
        {needs}
        {parts.length === 0 ? null : (
          <div className="flex min-h-11 items-center gap-2">
            <span className="min-w-0 flex-1 truncate cq-body-sm text-(--cq-text-secondary)">
              {parts.join(" · ")}
            </span>
            <Button
              variant="quiet"
              onClick={() => setExpanded(true)}
              data-arrival-stage-show
            >
              Show
            </Button>
          </div>
        )}
      </div>
    );
    return room.below === null ? line : createPortal(line, room.below);
  }

  const stack: ReactNode = (
    <div className="flex w-full flex-col gap-5" data-arrival-stage="below">
      {activityCard}
      {needs}
      {matchesGroup}
    </div>
  );
  if (!beside) {
    return room.below === null ? stack : createPortal(stack, room.below);
  }
  // Beside Q: what Q did top left, the decisions in the sequence's own
  // columns (it portals its cards there itself; its header and command
  // bar stay below Q), new matches bottom right.
  return (
    <>
      {room.leftTop !== null && activityCard !== null
        ? createPortal(
            <div data-arrival-stage="beside">{activityCard}</div>,
            room.leftTop,
          )
        : null}
      {room.rightBottom !== null && matchesGroup !== null
        ? createPortal(
            <div data-arrival-stage="beside">{matchesGroup}</div>,
            room.rightBottom,
          )
        : null}
      {needs === null
        ? null
        : room.below === null
          ? needs
          : createPortal(
              <div className="flex w-full flex-col gap-3">{needs}</div>,
              room.below,
            )}
    </>
  );
}
