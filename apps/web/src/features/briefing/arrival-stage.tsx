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
import { useQControl } from "@/features/q/control/q-control";
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
import { FollowUpStack } from "@/features/readiness/follow-up-stack";

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

// xl, as the room grid: at 1024px the side columns were ~95px wide.
const WIDE_QUERY = "(min-width: 1280px)";
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
  const ref = useRef<HTMLElement>(null);
  useQControl({ id: "section.what-i-did", kind: "SECTION", ref });
  return (
    <section
      ref={ref}
      aria-label="What I did"
      data-q-control="section.what-i-did"
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
          data-q-attention-item={item.source}
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
      data-q-control-item
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
  // "Show me the second one": brings that company's card forward here,
  // as a tap on its line does (opening the profile stays the person's).
  const ref = useRef<HTMLElement>(null);
  useQControl({
    id: "list.new-matches",
    kind: "LIST",
    ref,
    count: matches.items.length,
    onAct: (intent) => {
      if (intent.act !== "SELECT_ITEM") return "NOT_APPLICABLE";
      const target = matches.items[(intent.index ?? 1) - 1];
      if (target === undefined) return "TARGET_MISSING";
      setShown(target.companyId);
      return "DONE";
    },
  });
  return (
    <section
      ref={ref}
      aria-label="New for you"
      data-q-control="list.new-matches"
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
            data-q-control-item
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
  // C1 hooks: "scroll to what needs me", "show me Q's questions".
  const needsRef = useRef<HTMLElement>(null);
  const questionsRef = useRef<HTMLElement>(null);
  useQControl({ id: "section.needs-you", kind: "SECTION", ref: needsRef });
  useQControl({
    id: "section.q-questions",
    kind: "SECTION",
    ref: questionsRef,
  });

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
  const questions = data?.questions ?? null;
  const hasQuestions = questions !== null && questions.length > 0;
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
    if (hasQuestions) groups.push("QUESTIONS");
    if (hasMatches) groups.push("MATCHES");
    return groups;
  }, [data, hasActivity, hasNeeds, hasQuestions, hasMatches]);

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
    // The call already greeted them; the lowdown goes on without a second
    // hello.
    const warm = [words.greeting, words.welcome]
      .filter((part): part is string => part !== null)
      .join(" ");
    const lowdown = words.spoken.startsWith(warm)
      ? words.spoken.slice(warm.length).trim()
      : words.spoken;
    if (lowdown.length === 0) return;
    noteToLine(
      `Their lowdown just came in (you already greeted them; don't greet again): "${lowdown}" At a natural pause, tell them this in your own words, briefly, then stop.`,
      true,
      // The standard line says the lowdown's own words.
      lowdown,
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
  const besideQuestions = beside && shown.includes("QUESTIONS");
  useEffect(() => {
    setRoomFilled(besideActivity || besideMatches || besideQuestions, "stage");
    return () => setRoomFilled(false, "stage");
  }, [besideActivity, besideMatches, besideQuestions]);
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
      ref={needsRef}
      aria-label="Needs you"
      data-q-control="section.needs-you"
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
  // Q.01: the questions Q still has, answerable in place.
  const questionsGroup =
    shown.includes("QUESTIONS") &&
    questions !== null &&
    questions.length > 0 ? (
      <section
        ref={questionsRef}
        aria-label="Q still wants to know"
        data-q-control="section.q-questions"
        className="flex flex-col gap-2"
        data-arrival-questions
      >
        <GroupHead title="Q still wants to know" count={questions.length} />
        <FollowUpStack followUps={questions} heading={false} />
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
      hasQuestions && questions !== null
        ? `Q still wants to know · ${String(questions.length)}`
        : null,
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
      {questionsGroup}
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
      {room.leftBottom !== null && questionsGroup !== null
        ? createPortal(
            <div data-arrival-stage="beside">{questionsGroup}</div>,
            room.leftBottom,
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
