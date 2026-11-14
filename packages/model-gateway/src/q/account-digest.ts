import type {
  AccountDigestRelationship,
  QAccountDigest,
  QAnswerCardsBlock,
  QResponseMessage,
  RelationshipStateV2,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

/**
 * Owner requirement 14 Nov 2026 ("every time you ask Q a question … you're
 * supposed to have context of everything that is already happening or that
 * has happened, that is about to happen for the user's account"; audit
 * 2026-11-14 P0 #2, D1). The account digest -- assembled by code for the
 * asking person only (q-tools `createAccountDigestReader`, their own side's
 * reads) -- is read once per turn, typed or spoken, before any lane
 * answers, and told to the answer beside the situation header. Code lanes
 * read the same digest: a stated "not the ones I'm already in touch with"
 * excludes its relationships from any list Q shows.
 *
 * Nothing here calls a model; the block is deterministic for the same
 * digest, clock and zone, and bounded.
 */

export type QAccountDigestPort = (
  actor: ActorContext,
) => Promise<QAccountDigest | null>;

/** The block's bound: it rides beside the situation and is never cut. */
export const ACCOUNT_DIGEST_BLOCK_MAX_CHARS = 3_000;

const STAGE_WORDS: Readonly<Record<RelationshipStateV2, string>> = {
  DISCOVERED: "discovered",
  INTEREST_EXPRESSED: "interest expressed",
  CONNECTED: "connected",
  DECLINED: "declined",
  MEETING_HELD: "meeting held",
  IN_DILIGENCE: "in diligence",
  PAUSED: "paused",
  PASSED: "passed",
  INVESTED: "invested",
};

const NEXT_STEP_WORDS: Readonly<Record<string, string>> = {
  ANSWER_INTEREST: "they want to connect: answer their interest",
  SCHEDULE_MEETING: "connected: book a call",
  DECIDE_NEXT_STEP: "decide the next step after the meeting",
  FOLLOW_UP: "follow up after the meeting",
  RESUME: "paused: resume when ready",
  AWAIT_ANSWER: "waiting for them to answer the interest",
};

/** Their own words for a name: one line, no quotes, bounded. */
function plain(text: string, max: number): string {
  return text
    .replace(/\p{Cc}|["`]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, max);
}

function dayKey(at: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

function knownZone(zone: string | null): zone is string {
  if (zone === null) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * A moment in their own time, labelled: "Tue 17 Nov, 14:00 (tomorrow,
 * Africa/Lagos)". Unknown zone: said in UTC, labelled UTC.
 */
export function localWhen(
  isoTime: string,
  now: Date,
  timeZone: string | null,
): string {
  const at = new Date(isoTime);
  if (Number.isNaN(at.getTime())) return "time unknown";
  const zone = knownZone(timeZone) ? timeZone : "UTC";
  const label = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
  const today = dayKey(now, zone);
  const day = dayKey(at, zone);
  const [y, m, d] = today.split("-").map(Number);
  const tomorrow = dayKey(
    new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + 1, 12)),
    "UTC",
  );
  const relative =
    day === today ? "today, " : day === tomorrow ? "tomorrow, " : "";
  return `${label} (${relative}${zone === "UTC" && !knownZone(timeZone) ? "UTC" : zone})`;
}

/** A date only, in their zone: "13 Nov". */
function localDay(isoTime: string, timeZone: string | null): string {
  const at = new Date(isoTime);
  if (Number.isNaN(at.getTime())) return "unknown date";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: knownZone(timeZone) ? timeZone : "UTC",
    day: "numeric",
    month: "short",
  }).format(at);
}

function relationshipLine(
  row: AccountDigestRelationship,
  timeZone: string | null,
): string {
  const owed =
    row.owed === "YOU_OWE_REPLY"
      ? `you owe them a reply${row.lastMessageAt === null ? "" : ` (they wrote ${localDay(row.lastMessageAt, timeZone)})`}`
      : row.owed === "AWAITING_THEM"
        ? `awaiting their reply${row.lastMessageAt === null ? "" : ` (you wrote ${localDay(row.lastMessageAt, timeZone)})`}`
        : null;
  const step = NEXT_STEP_WORDS[row.nextStep] ?? null;
  const said = [owed, owed === null || row.nextStep !== "AWAIT_ANSWER" ? step : null]
    .filter((part): part is string => part !== null)
    .join("; ");
  return `${plain(row.counterpart.name, 80)} (${row.counterpart.kind === "COMPANY" ? "company" : "investor"}, ${STAGE_WORDS[row.stage]} since ${localDay(row.stageSince, timeZone)}${said.length === 0 ? "" : `; ${said}`}) [relationship ${row.relationshipId}]`;
}

/** A section line, capped so that one long section never drowns the rest. */
function sectionLine(
  title: string,
  items: readonly string[],
  more: number,
  cap: number,
): string | null {
  if (items.length === 0 && more <= 0) return null;
  const kept: string[] = [];
  let used = title.length + 2;
  for (const item of items) {
    if (used + item.length + 2 > cap) break;
    kept.push(item);
    used += item.length + 2;
  }
  const left = items.length - kept.length + Math.max(0, more);
  return `${title}: ${kept.join("; ")}${left > 0 ? `; and ${String(left)} more` : ""}.`;
}

/**
 * The block every Q turn is told, beside the situation. Their own account
 * only, as the digest holds it; what could not be read is said so.
 */
export function accountDigestBlock(input: {
  readonly digest: QAccountDigest;
  readonly now: Date;
  readonly timeZone: string | null;
}): string {
  const { digest, now, timeZone } = input;
  const stages = Object.entries(digest.byStage)
    .filter(([, count]) => (count ?? 0) > 0)
    .map(
      ([stage, count]) =>
        `${String(count)} ${STAGE_WORDS[stage as RelationshipStateV2]}`,
    )
    .join(", ");
  const lines = [
    `ACCOUNT (Capital Q, by code, read ${localWhen(digest.readAt, now, timeZone)}; their own account only; the ids are theirs to cite and act on):`,
    sectionLine(
      `Relationships (${String(digest.relationshipsTotal)}${stages.length === 0 ? "" : `: ${stages}`}; most pressing first)`,
      digest.relationships.map((row) => relationshipLine(row, timeZone)),
      digest.relationshipsTotal - digest.relationships.length,
      1_100,
    ) ??
      (digest.unread.includes("RELATIONSHIPS")
        ? null
        : "Relationships: none yet."),
    sectionLine(
      `Waiting on them (${String(digest.waitingTotal)})`,
      digest.waiting.map(
        (item) =>
          `${plain(item.title, 140)}${item.entity === undefined ? "" : ` [${item.entity.kind.toLowerCase()} ${item.entity.id}]`}`,
      ),
      digest.waitingTotal - digest.waiting.length,
      600,
    ) ??
      (digest.unread.includes("WAITING") ? null : "Waiting on them: nothing."),
    sectionLine(
      "Calls in the next 14 days, in their time",
      digest.meetings.map(
        (meeting) =>
          `${localWhen(meeting.startsAt, now, timeZone)}: ${plain(meeting.purpose, 80)}${meeting.with.length === 0 ? "" : ` with ${meeting.with.map((name) => plain(name, 60)).join(", ")}`}${meeting.hasBrief ? " (brief ready)" : ""} [meeting ${meeting.id}]`,
      ),
      0,
      500,
    ) ??
      (digest.unread.includes("MEETINGS")
        ? null
        : "Calls in the next 14 days: none booked."),
    sectionLine(
      "Q's work for them",
      digest.work.map(
        (work) =>
          `${plain(work.goal, 100)} (${work.status.toLowerCase()}${work.open > 0 ? `, ${String(work.open)} open` : ""}) [work ${work.id}]`,
      ),
      0,
      350,
    ),
    sectionLine(
      "Diligence requests",
      digest.requests.map(
        (request) =>
          `${request.direction === "FROM_YOU" ? "you asked" : "asked of you by"} ${plain(request.counterpart, 60)}: ${String(request.openCount)} open, ${String(request.answeredCount)} answered${request.open.length === 0 ? "" : ` (${request.open.map((text) => plain(text, 60)).join("; ")})`} [relationship ${request.relationshipId}]`,
      ),
      0,
      350,
    ),
    gateqLine(digest, timeZone),
    sectionLine(
      "Recent (last 3 days)",
      digest.recent.map(
        (event) => `${localDay(event.at, timeZone)}: ${plain(event.text, 120)}`,
      ),
      0,
      350,
    ),
    digest.unread.length === 0
      ? null
      : `Could not be read just now: ${digest.unread.map((section) => section.toLowerCase()).join(", ")} -- never say there is none of these.`,
    "Answer what is waiting, who to follow up with, what is coming up and where things stand from this; never contradict it, and never list a company this says they are in touch with when they asked to leave those out.",
  ].filter((line): line is string => line !== null);
  return lines.join(" ").slice(0, ACCOUNT_DIGEST_BLOCK_MAX_CHARS);
}

function gateqLine(
  digest: QAccountDigest,
  timeZone: string | null,
): string | null {
  const gateq = digest.gateq;
  if (gateq === null) return null;
  const parts: string[] = [];
  if (gateq.inbox !== null) {
    const inbox = gateq.inbox;
    parts.push(
      `their gateway ${plain(inbox.gatewayName, 60)}: ${String(inbox.unread)} unread, ${String(inbox.fits)} fit, ${String(inbox.partial)} partial, ${String(inbox.notAFit)} not a fit; ${String(inbox.needsJudgement)} need their judgement${inbox.top.length === 0 ? "" : ` (${inbox.top.map((item) => `${plain(item.companyName, 60)}, ${item.fit.toLowerCase().replace(/_/gu, " ")}${item.daysLeft === null ? "" : `, ${String(item.daysLeft)} days left`} [application ${item.applicationId}]`).join("; ")})`}`,
    );
  }
  if (gateq.applications.length > 0) {
    parts.push(
      `their applications (${String(gateq.applicationsTotal)}): ${gateq.applications
        .map(
          (application) =>
            `${plain(application.fund, 60)} ${application.status.toLowerCase()} (sent ${localDay(application.sentAt, timeZone)}${application.replyBy === null || application.status !== "SENT" ? "" : `, reply promised by ${application.replyBy}`}) [application ${application.applicationId}]`,
        )
        .join("; ")}`,
    );
  }
  return parts.length === 0
    ? null
    : `GateQ: ${parts.join("; ")}.`.slice(0, 500);
}

/** The digest's counterparts: whom "already in touch with" means. */
export function relationshipCounterparts(
  digest: QAccountDigest | null,
): ReadonlySet<string> {
  return new Set(digest?.relationshipCounterpartIds ?? []);
}

/**
 * The code check behind a stated exclusion (D1): every company card the
 * answer would show that the person's constraint excludes is dropped, and
 * the answer says so plainly -- never a list that quietly breaks what they
 * asked. A card set left empty is removed.
 */
export function withoutExcludedCompanies(
  blocks: QResponseMessage["blocks"] | undefined,
  excluded: ReadonlySet<string>,
): {
  readonly blocks: QResponseMessage["blocks"] | undefined;
  readonly dropped: readonly string[];
} {
  if (blocks === undefined || excluded.size === 0) {
    return { blocks, dropped: [] };
  }
  const dropped: string[] = [];
  const kept: NonNullable<QResponseMessage["blocks"]>[number][] = [];
  for (const block of blocks) {
    if (block.kind !== "ANSWER_CARDS") {
      kept.push(block);
      continue;
    }
    const cardsBlock: QAnswerCardsBlock = block;
    const cards = cardsBlock.cards.filter((card) => {
      const subject = card.subject;
      const out =
        subject !== null &&
        subject.kind === "COMPANY" &&
        excluded.has(subject.companyId);
      if (out) dropped.push(card.name);
      return !out;
    });
    if (cards.length === cardsBlock.cards.length) kept.push(block);
    else if (cards.length > 0) kept.push({ ...cardsBlock, cards });
  }
  return { blocks: kept, dropped: [...new Set(dropped)] };
}

/** What the answer says when the check dropped companies. */
export function exclusionLine(dropped: readonly string[]): string | null {
  if (dropped.length === 0) return null;
  const names = dropped.slice(0, 5).map((name) => plain(name, 60));
  const more = dropped.length - names.length;
  return `I left out ${names.join(", ")}${more > 0 ? ` and ${String(more)} more` : ""}: you're already in touch with ${dropped.length === 1 ? "them" : "those companies"}, and you asked me to leave those out.`;
}
