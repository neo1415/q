import {
  Q_ATTENTION_SOURCES,
  QAttentionReportSchema,
  type QActivitySummary,
  type QAttentionReport,
  type QAttentionSource,
} from "@capital-q/contracts";

/**
 * RECOVERY-2026-10 B1: the answer to "what needs me", written by code
 * from the attention report (q-tools `what_needs_me`), the way a fit
 * question is answered from computed fits -- no model round decides what
 * to leave out (live T3, 2026-10-08: the model said "nothing is waiting"
 * while an investor's message had waited 21 hours).
 */

/** The model-facing name of the attention read (q-tools `attention.read`). */
export const ATTENTION_TOOL_NAME = "what_needs_me";

/**
 * Their own words ask what needs them (TURN_READER v44 reads these as
 * QUESTION_TO_Q / THEIR_OWN_RECORDS; this decides the code-read answer).
 * Narrow on purpose: "what needs to happen for the round" is not it.
 */
const ASKS_WHAT_NEEDS_THEM =
  /\b(?:(?:needs?|requires?|deserves?)\s+(?:my|our)\s+(?:attention|input|reply|response|decision|approval|action)|(?:what|anything|something|who)(?:'s|\s+is)?\s+(?:else\s+)?(?:waiting|pending)\s+(?:on|for)\s+(?:me|us)|what(?:'s|\s+is|\s+do\s+i\s+have)?\s+(?:on\s+my\s+plate|outstanding|pending\s+for\s+me)|what\s+did\s+i\s+miss|what\s+(?:needs|requires)\s+(?:me|us)\b|(?:anything|what)\s+(?:i|we)\s+(?:need|have)\s+to\s+(?:do|deal\s+with|handle|answer|look\s+at)|(?:anything|what)\s+(?:needs|requires)\s+(?:me|us|doing)|who\s+(?:is|'s)\s+waiting\s+(?:on|for)\s+(?:me|us)|what(?:'s|\s+is)\s+new\s+(?:for\s+me|since)|catch\s+me\s+up)/iu;

export function asksWhatNeedsThem(text: string): boolean {
  return ASKS_WHAT_NEEDS_THEM.test(text.replace(/[’]/gu, "'"));
}

const SOURCE_WORDS: Readonly<Record<QAttentionSource, string>> = {
  UNANSWERED_MESSAGE: "your messages",
  APPROVAL: "your approvals",
  HELD_DRAFT: "drafts Q held back",
  AGENT_BLOCKED: "Q's agents",
  DOCUMENT_REQUEST: "document and diligence requests",
  INTEREST_REQUEST: "interest and connection requests",
  MEETING: "your calls",
  REMINDER: "your reminders",
  NEW_MATCHES: "new matches",
  NOTICE: "your notices",
};

function listed(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1] ?? ""}`;
}

function activityLine(activity: QActivitySummary): string | null {
  const parts: string[] = [];
  const add = (n: number, one: string, many: string) => {
    if (n > 0) parts.push(`${String(n)} ${n === 1 ? one : many}`);
  };
  add(activity.repliesSent, "reply sent", "replies sent");
  add(activity.messagesSent, "message sent", "messages sent");
  add(activity.callsBooked, "call booked", "calls booked");
  add(activity.interestExpressed, "interest expressed", "interests expressed");
  add(activity.jobsCompleted, "job finished", "jobs finished");
  add(activity.draftsHeld, "draft held for you", "drafts held for you");
  if (parts.length === 0) return null;
  return `Meanwhile, Q and its agents: ${listed(parts)}.`;
}

/**
 * Every item, in the report's order, then what could not be checked. It
 * says "nothing is waiting" only when every source was read and none had
 * anything; an unread source is named as unread.
 */
export function attentionAnswerText(report: QAttentionReport): string {
  const everySourceUnread = report.unread.length >= Q_ATTENTION_SOURCES.length;
  const lines: string[] = [];
  if (report.items.length === 0) {
    lines.push(
      report.unread.length === 0
        ? "Nothing is waiting on you right now: no messages to answer, approvals, requests, calls to arrange, reminders due or notices."
        : everySourceUnread
          ? "I couldn't check what's waiting for you just now."
          : "I found nothing waiting in the places I could check.",
    );
  } else {
    lines.push(
      report.items.length === 1
        ? "One thing needs you:"
        : `${String(report.items.length)} things need you:`,
    );
    report.items.forEach((item, index) => {
      lines.push(
        `${String(index + 1)}. ${item.title}${item.note === undefined ? "" : ` — ${item.note}`}`,
      );
    });
  }
  if (everySourceUnread) {
    lines.push(
      "None of the places I look could be read, so something may be waiting that I can't see yet. Try me again in a moment.",
    );
  } else if (report.unread.length > 0) {
    lines.push(
      `I couldn't check ${listed(report.unread.map((source) => SOURCE_WORDS[source]))} just now, so something may be waiting there that I can't see yet.`,
    );
  }
  const activity =
    report.activity === null ? null : activityLine(report.activity);
  if (activity !== null) lines.push(activity);
  return lines.join("\n");
}

/** The tool's result as a report, or null when it is not one. */
export function attentionReportOf(data: unknown): QAttentionReport | null {
  const read = QAttentionReportSchema.safeParse(data);
  return read.success ? read.data : null;
}
