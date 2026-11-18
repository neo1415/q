import type { MeetingOutcomes, OutcomeSide } from "./meeting-outcomes.js";

/**
 * S7 (R9): the next time either side talks to Q after a held meeting, Q
 * opens with it, once: how it went, what the other side asked of them
 * (and whether Q can share it now or they need to upload it first), and a
 * reminder for each thing they said they'd do. Composed by code from the
 * meeting's post-call reading, no model and no extra round trip.
 *
 * Only what that person may see: the requests made OF them, the promises
 * and money signals THEY made, and their own documents. Nothing is sent
 * or set here: every offer is a question, and acting on it goes through
 * the app's own actions behind their approval (Prepare, Recommend, Human
 * Approval, Execute).
 */

export type FollowUpDocument = { readonly id: string; readonly title: string };

export type MeetingFollowUp = {
  readonly line: string;
  /** Requests made of them, each with the document of theirs it matches. */
  readonly requests: readonly {
    readonly id: string;
    readonly item: string;
    readonly dueText: string | null;
    readonly documents: readonly FollowUpDocument[];
    /** Parts of the item none of their documents match. */
    readonly missing: readonly string[];
  }[];
  /** What they said they'd do, each offered as an email reminder. */
  readonly reminders: readonly {
    readonly id: string;
    readonly what: string;
    readonly dueText: string | null;
  }[];
  /** Money they said in the call: a signal for them to confirm. */
  readonly signals: readonly {
    readonly id: string;
    readonly level: "SOFT" | "HARD";
    readonly amount: string | null;
    readonly currencyCode: string | null;
    readonly share: string | null;
    readonly condition: string | null;
  }[];
};

const STOP = new Set([
  "the",
  "a",
  "an",
  "our",
  "your",
  "their",
  "my",
  "of",
  "for",
  "data",
  "latest",
  "current",
  "copy",
  "both",
  "us",
  "me",
  "please",
]);

const wordsOf = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/gu, " ")
    .split(/\s+/u)
    .filter((w) => w.length > 1 && !STOP.has(w));

/** "the cohort retention data and the cap table" → its parts. */
export function itemParts(item: string): string[] {
  return item
    .split(/\s*(?:,|\band\b|&)\s*/iu)
    .map((part) => part.trim())
    .filter((part) => wordsOf(part).length > 0);
}

const bare = (part: string) =>
  part.replace(/^(?:the|a|an|our|your|their)\s+/iu, "").trim();

/** Their document whose title holds every meaningful word of the part. */
function documentFor(
  part: string,
  documents: readonly FollowUpDocument[],
): FollowUpDocument | null {
  const want = wordsOf(part);
  if (want.length === 0) return null;
  return (
    documents.find((d) => {
      const have = new Set(wordsOf(d.title));
      return want.every((w) => have.has(w) || have.has(`${w}s`));
    }) ?? null
  );
}

const list = (items: readonly string[]) =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1] ?? ""}`;

const by = (due: string | null) => (due === null ? "" : ` by ${capital(due)}`);

function capital(due: string): string {
  return due.replace(
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/giu,
    (d) => `${d.charAt(0).toUpperCase()}${d.slice(1).toLowerCase()}`,
  );
}

function money(signal: MeetingFollowUp["signals"][number]): string {
  const parts: string[] = [];
  if (signal.amount !== null) {
    const figure = Number(signal.amount).toLocaleString("en-GB");
    parts.push(
      signal.currencyCode === null
        ? `${figure} (no currency was said)`
        : `${signal.currencyCode} ${figure}`,
    );
  }
  if (signal.share !== null) parts.push(`${signal.share} of the round`);
  return list(parts);
}

/** What they said they'd do, in their own direction ("send both"). */
function said(what: string): string {
  const flat = what
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[.!]+$/u, "");
  const m =
    /\b(?:i|we)\s+(?:will|'ll|shall|can|am going to|are going to)\s+(.+)$/iu.exec(
      flat,
    );
  return (m?.[1] ?? flat).replace(/\s+by\s+\w+(?:\s+\w+)?$/iu, "").trim();
}

export function meetingFollowUpOf(input: {
  readonly userId: string;
  readonly side: OutcomeSide;
  /** The other side's organisation, as the person knows it. */
  readonly counterpart: string | null;
  readonly outcomes: MeetingOutcomes;
  /** The person's own documents (the company's, for a founder). */
  readonly documents: readonly FollowUpDocument[];
}): MeetingFollowUp | null {
  const { outcomes, side } = input;
  const requests = outcomes.requests
    .filter((r) => r.askedSide === side)
    .map((r) => {
      const parts = itemParts(r.item);
      const matched = parts.map((part) => ({
        part,
        document: documentFor(part, input.documents),
      }));
      return {
        id: r.id,
        item: r.item,
        dueText: r.dueText,
        documents: matched.flatMap((m) =>
          m.document === null ? [] : [m.document],
        ),
        missing: matched.filter((m) => m.document === null).map((m) => m.part),
      };
    });
  // Each thing they said they'd do, offered as a reminder in case they
  // do not act on the offer above now. Unknown owners are offered nothing.
  const reminders = outcomes.promises
    .filter((p) => p.ownerUserId === input.userId)
    .map((p) => ({ id: p.id, what: said(p.what), dueText: p.dueText }));
  const signals = outcomes.commitments
    .filter((c) => c.evidence.speakerUserId === input.userId)
    .map((c) => ({
      id: c.id,
      level: c.level,
      amount: c.amount,
      currencyCode: c.currencyCode,
      share: c.share,
      condition: c.condition,
    }));
  if (requests.length === 0 && reminders.length === 0 && signals.length === 0) {
    return null;
  }

  const lines: string[] = [
    `How was your meeting${input.counterpart === null ? "" : ` with ${input.counterpart}`}?`,
  ];
  for (const request of requests.slice(0, 2)) {
    lines.push(`They asked for ${bare(request.item)}${by(request.dueText)}.`);
    const held = request.documents.map((d) => d.title);
    const several = itemParts(request.item).length > 1;
    if (request.missing.length === 0) {
      lines.push(`Shall I share ${several ? "them" : "it"} with them?`);
    } else if (held.length === 0) {
      lines.push(
        `I don't see ${list(request.missing.map(bare))} in your documents yet. Shall I open the upload, then share ${several ? "them" : "it"} for their due diligence?`,
      );
    } else {
      lines.push(
        `I can share ${list(held)} now; ${list(request.missing.map(bare))} isn't in your documents yet. Shall I open the upload, then share both for their due diligence?`,
      );
    }
  }
  for (const reminder of reminders.slice(0, 2)) {
    lines.push(
      `You said you'd ${reminder.what}${by(reminder.dueText)}. Want an email reminder?`,
    );
  }
  for (const signal of signals.slice(0, 1)) {
    const amount = money(signal);
    lines.push(
      `You mentioned ${amount}${signal.condition === null ? "" : ` ${signal.condition}`}. I've kept it as a ${signal.level === "HARD" ? "firm" : "soft"} signal, not a commitment. Shall I record it for them to confirm?`,
    );
  }
  return { line: lines.join(" ").slice(0, 900), requests, reminders, signals };
}
