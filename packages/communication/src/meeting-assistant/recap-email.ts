/**
 * The recap email after a call Q kept the record of (meet2-64, founder
 * report 2026-10-04: "nothing in email"). One per participant, once.
 *
 * Context Firewall: it carries only what both sides of the call read on
 * the meeting record (who attended, what was agreed, money mentioned).
 * Q's own analysis (summary, flags, follow-ups) is written for one person
 * and never goes in it. Money mentioned is said to be detected, not a
 * commitment, until both sides confirm it (ADR 0027, spec 6.6.14).
 */

export type MeetingRecap = {
  readonly meetingId: string;
  readonly userId: string;
  readonly to: string;
  readonly name: string | null;
  readonly purpose: string;
  readonly startsAt: Date;
  /** The participant's own side's page, as the notice links it. */
  readonly linkPath: string | null;
  readonly attendees: readonly string[];
  readonly agreements: readonly string[];
  readonly money: readonly {
    readonly party: string;
    readonly amount: string;
    readonly quote: string;
  }[];
  /** The record is from part of the call (ended early, partial audio). */
  readonly partial: boolean;
  /**
   * The call's transcript, as both sides read it on the meeting record
   * (founder 2026-10-05: "the actual transcript sent three ways"). Shared
   * by both sides already, so it crosses no firewall.
   */
  readonly transcript?: readonly {
    readonly speaker: string | null;
    readonly text: string;
  }[];
};

/** Enough for any real call; a very long one says where the rest is. */
const TRANSCRIPT_MAX_LINES = 400;
const TRANSCRIPT_MAX_CHARS = 60_000;

function transcriptLinesOf(recap: MeetingRecap): {
  readonly lines: readonly string[];
  readonly cut: boolean;
} {
  const lines: string[] = [];
  let chars = 0;
  for (const line of recap.transcript ?? []) {
    const text = line.text.replace(/\s+/g, " ").trim();
    if (text.length === 0) continue;
    const entry = `${line.speaker?.trim() || "Someone"}: ${text}`;
    if (
      lines.length >= TRANSCRIPT_MAX_LINES ||
      chars + entry.length > TRANSCRIPT_MAX_CHARS
    ) {
      return { lines, cut: true };
    }
    lines.push(entry);
    chars += entry.length;
  }
  return { lines, cut: false };
}

export type MeetingRecapEmail = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
};

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const MONEY_NOTE =
  "Detected in the call, not a commitment: it counts only once both of you confirm it in Capital Q.";

export function meetingRecapEmail(
  recap: MeetingRecap,
  appOrigin: string | null,
): MeetingRecapEmail {
  const first = recap.name?.trim().split(/\s+/)[0] ?? null;
  const when = `${recap.startsAt.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  const link =
    appOrigin === null || recap.linkPath === null
      ? null
      : `${appOrigin.replace(/\/$/, "")}${recap.linkPath}`;
  const agreements =
    recap.agreements.length === 0
      ? ["Nothing was recorded as agreed."]
      : recap.agreements.slice(0, 12);
  const money = recap.money.slice(0, 10);
  const lines: string[] = [
    `${first === null ? "Hello" : `Hi ${first}`},`,
    "",
    `Q kept the record of your call "${recap.purpose}" (${when}).`,
    ...(recap.partial
      ? [
          "This record is partial: it is what Q heard before the call ended or its audio stopped.",
        ]
      : []),
    "",
    `Attended: ${recap.attendees.length === 0 ? "not recorded" : recap.attendees.join(", ")}`,
    "",
    "Agreed:",
    ...agreements.map((line) => `- ${line}`),
  ];
  if (money.length > 0) {
    lines.push(
      "",
      "Money mentioned:",
      ...money.map(
        (item) => `- ${item.amount}, ${item.party}: "${item.quote}"`,
      ),
      MONEY_NOTE,
    );
  }
  const transcript = transcriptLinesOf(recap);
  if (transcript.lines.length > 0) {
    lines.push("", "Transcript:", ...transcript.lines);
    if (transcript.cut) lines.push("(The rest is on the meeting record.)");
  }
  lines.push(
    "",
    link === null
      ? "The full transcript is on the meeting record in Capital Q."
      : `The full transcript is on the meeting record: ${link}`,
  );
  const list = (items: readonly string[]) =>
    `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  const html = [
    `<p>${escapeHtml(first === null ? "Hello" : `Hi ${first}`)},</p>`,
    `<p>Q kept the record of your call &ldquo;${escapeHtml(recap.purpose)}&rdquo; (${escapeHtml(when)}).</p>`,
    recap.partial
      ? "<p>This record is partial: it is what Q heard before the call ended or its audio stopped.</p>"
      : "",
    `<p><strong>Attended:</strong> ${escapeHtml(recap.attendees.length === 0 ? "not recorded" : recap.attendees.join(", "))}</p>`,
    `<p><strong>Agreed</strong></p>${list(agreements)}`,
    money.length === 0
      ? ""
      : `<p><strong>Money mentioned</strong></p>${list(
          money.map((item) => `${item.amount}, ${item.party}: "${item.quote}"`),
        )}<p>${escapeHtml(MONEY_NOTE)}</p>`,
    transcript.lines.length === 0
      ? ""
      : `<p><strong>Transcript</strong></p>${transcript.lines
          .map((line) => `<p style="margin:0 0 6px">${escapeHtml(line)}</p>`)
          .join("")}${
          transcript.cut ? "<p>(The rest is on the meeting record.)</p>" : ""
        }`,
    link === null
      ? "<p>The full transcript is on the meeting record in Capital Q.</p>"
      : `<p><a href="${escapeHtml(link)}">Open the meeting record</a></p>`,
  ].join("");
  return {
    to: recap.to,
    subject: `Q's record of your call: ${recap.purpose}`.slice(0, 160),
    text: lines.join("\n"),
    html,
  };
}
