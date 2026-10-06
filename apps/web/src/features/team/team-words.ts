import type { TeamKind } from "@capital-q/contracts";

/**
 * The Team pages' words (G2; research §5.9): a founder's "company", an
 * investor's "firm". Never "organisation" on screen.
 */
export function teamWords(kind: TeamKind) {
  const company = kind === "COMPANY";
  return {
    word: company ? "company" : "firm",
    label: company ? "Company" : "Firm",
    soloLine: (name: string) =>
      company
        ? `Invite your co-founder and team. They'll work on ${name}'s profile, data room and investor conversations with you.`
        : "You invest as yourself. Invite a colleague and this becomes a shared firm: one inbox, shared notes, and everyone sees the same relationships.",
    admin: company
      ? "Invites people, edits the company profile, decides who sees each data room document, and approves what Q sends."
      : "Invites people, edits the firm's mandate and gate, and approves what Q sends: replies, passes, interest.",
    member: company
      ? "Works on everything day to day. Can suggest, but can't share private documents or approve what Q sends."
      : "Reviews companies, writes notes, works the inbox. Can suggest, but can't approve what Q sends.",
  } as const;
}

/** Addresses as typed: commas, semicolons, spaces or new lines, once each. */
export function splitEmailInput(raw: string): readonly string[] {
  return [
    ...new Set(
      raw
        .split(/[\s,;]+/u)
        .map((part) => part.trim())
        .filter((part) => part.length > 0),
    ),
  ];
}

/** "2 days ago", "today": when an invitation went. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const days = Math.floor(
    (now.getTime() - new Date(iso).getTime()) / 86_400_000,
  );
  if (!Number.isFinite(days) || days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${String(days)} days ago`;
}
