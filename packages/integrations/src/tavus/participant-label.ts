/**
 * The name the video provider shows on Q's tile (lead decision 2026-10-16).
 *
 * The provider's stock face has a name of its own ("Steve"); that face is
 * only how Q looks. The tile must say who Q is PLAYING in this room, and
 * that it is Q, never the face's name or an internal id:
 *
 *   rehearsal  "Babatunde · Harbourline Cargo (Q rehearsal)"
 *              "Harbourline Cargo (Q rehearsal)" when no person is named
 *   interview  "Q · Savanna Seed Partners (AI interviewer)"
 *   meeting    "Q · Capital Q (AI assistant)"
 */
export const TAVUS_PARTICIPANT_LABEL_MAX = 100;

export type TavusParticipantRole =
  | {
      readonly surface: "REHEARSAL";
      /** Who Q plays (the organisation or company met). */
      readonly counterpart: string;
      /** The person Q plays, when one is named canonically. */
      readonly person?: string | null | undefined;
    }
  | { readonly surface: "INTERVIEW"; readonly fund?: string | null | undefined }
  | { readonly surface: "MEETING" };

const clean = (text: string | null | undefined): string =>
  (text ?? "").replace(/\s+/gu, " ").trim();

export function tavusParticipantLabel(role: TavusParticipantRole): string {
  const cap = (head: string, context: string, tail: string) => {
    const room = TAVUS_PARTICIPANT_LABEL_MAX - head.length - tail.length;
    const fitted =
      context.length <= room
        ? context
        : `${context.slice(0, Math.max(0, room - 1)).trimEnd()}…`;
    return `${head}${fitted}${tail}`;
  };
  switch (role.surface) {
    case "REHEARSAL": {
      const person = clean(role.person);
      const counterpart = clean(role.counterpart) || "Rehearsal";
      return person === ""
        ? cap("", counterpart, " (Q rehearsal)")
        : cap(`${person.slice(0, 40)} · `, counterpart, " (Q rehearsal)");
    }
    case "INTERVIEW": {
      const fund = clean(role.fund);
      return fund === ""
        ? "Q (AI interviewer)"
        : cap("Q · ", fund, " (AI interviewer)");
    }
    case "MEETING":
      return "Q · Capital Q (AI assistant)";
  }
}
