import type { PresenceReading } from "@capital-q/q-core";

/**
 * Presence on camera in a rehearsal (founder ask 2026-10-01): with the
 * person's explicit consent, the played person sees them and may react the
 * way someone on a real call would -- to reading from notes, looking away,
 * poor light or framing, a busy background, someone else in view.
 *
 * The model reads each consented frame into a typed presence reading of
 * meeting behaviour and setup only. Code keeps those readings as text, in
 * memory, for this rehearsal; decides which single issue, if any, the
 * played person may remark on this turn (each at most once, never two turns
 * running, gentler on Gentle); and writes the review's Presence section
 * from the counts. No image is ever kept.
 */

export const PRESENCE_ISSUES = [
  "READING_NOTES",
  "DISTRACTED",
  "LOOKING_AWAY",
  "COMPANY",
  "POOR_LIGHTING",
  "POOR_FRAMING",
  "BUSY_BACKGROUND",
] as const;
export type PresenceIssue = (typeof PRESENCE_ISSUES)[number];

/** The issues a reading shows, most important first. */
export function issuesOf(reading: PresenceReading): PresenceIssue[] {
  const shows: Readonly<Record<PresenceIssue, boolean>> = {
    READING_NOTES: reading.gaze === "READING_OFF_SCREEN",
    DISTRACTED: reading.distracted,
    LOOKING_AWAY: reading.gaze === "LOOKING_AWAY",
    COMPANY: reading.company,
    POOR_LIGHTING: reading.lighting === "POOR",
    POOR_FRAMING: reading.framing === "POOR",
    BUSY_BACKGROUND: reading.background === "BUSY",
  };
  return PRESENCE_ISSUES.filter((issue) => shows[issue]);
}

/** What the played person saw, in words the prompt can use. */
const SEEN: Readonly<Record<PresenceIssue, string>> = {
  READING_NOTES: "they seem to be reading from notes or another screen",
  DISTRACTED: "they seem busy with something else",
  LOOKING_AWAY: "they keep looking away from the call",
  COMPANY:
    'someone else is in view (say at most "looks like you have company")',
  POOR_LIGHTING: "the lighting makes them hard to see",
  POOR_FRAMING: "they are poorly framed (cut off, too close or too far)",
  BUSY_BACKGROUND: "the background is busy and distracting",
};

/** Gentle stays kind: it lets distraction and a busy room pass. */
const GENTLE_REMARKS: ReadonlySet<PresenceIssue> = new Set([
  "READING_NOTES",
  "COMPANY",
  "POOR_LIGHTING",
  "POOR_FRAMING",
]);

const HOW: Readonly<Record<"GENTLE" | "REALISTIC" | "TOUGH", string>> = {
  GENTLE:
    'kindly, as a helpful aside ("no need for notes, just talk me through it")',
  REALISTIC: "naturally, as this person would on a call",
  TOUGH: 'bluntly, calling it out ("are you reading that?")',
};

export type PresenceState = {
  readonly readings: PresenceReading[];
  readonly offered: Set<PresenceIssue>;
  /** The THEM turn count when a remark was last offered. */
  lastOfferAt: number | null;
};

export function newPresenceState(): PresenceState {
  return { readings: [], offered: new Set(), lastOfferAt: null };
}

const GUARD =
  "Only meeting behaviour and setup; never appearance, identity, bystanders or emotion read from a face.";

/**
 * What the played person may say about what they see this turn, and the
 * one issue (if any) it offers. Each issue is offered at most once, never
 * on two turns running, and only from the latest clear reading.
 */
export function presenceNote(
  state: PresenceState | undefined,
  cameraOn: boolean,
  difficulty: "GENTLE" | "REALISTIC" | "TOUGH",
  themTurns: number,
  consent = cameraOn,
): { readonly note: string; readonly offer: PresenceIssue | null } {
  if (!cameraOn && !consent) {
    // Never pretend (2026-10-01): asked to look, they hear plainly why not.
    return {
      note: 'You cannot see them: their camera is not shared with you. Say nothing about how they look or their setup. If they ask you to look at them or at something, say plainly you can\'t see them and that they can switch on "Let Q see you" at the bottom of the call.',
      offer: null,
    };
  }
  if (!cameraOn) {
    return {
      note: "Their camera is shared with you, but no clear frame came through this moment. Say nothing about how they look or their setup; if they ask you to look, say you can't quite make them out right now and ask them to hold on a second. Never say their camera isn't shared.",
      offer: null,
    };
  }
  const latest = state?.readings.at(-1);
  const rested =
    state?.lastOfferAt == null || themTurns - state.lastOfferAt >= 2;
  const offer =
    latest === undefined || !rested
      ? null
      : (issuesOf(latest).find(
          (issue) =>
            !(state?.offered.has(issue) ?? false) &&
            (difficulty !== "GENTLE" || GENTLE_REMARKS.has(issue)),
        ) ?? null);
  const already =
    state === undefined || state.offered.size === 0
      ? ""
      : ` Already raised, never again: ${[...state.offered].map((i) => SEEN[i]).join("; ")}.`;
  if (offer === null) {
    return {
      note: `Nothing about their presence to remark on this turn; just talk.${already} ${GUARD}`,
      offer: null,
    };
  }
  return {
    note: `On your last look, ${SEEN[offer]}. If it still shows, you may mention it once, ${HOW[difficulty]}, in a few words, then carry on.${already} ${GUARD}`,
    offer,
  };
}

/** After the turn: keep the reading as text, and mark an offer spent. */
export function recordPresence(
  state: PresenceState,
  reading: PresenceReading | null,
  offer: PresenceIssue | null,
  themTurns: number,
): void {
  if (reading !== null) {
    state.readings.push(reading);
    if (state.readings.length > 120) state.readings.shift();
  }
  if (offer !== null) {
    state.offered.add(offer);
    state.lastOfferAt = themTurns;
  }
}

export type PresenceObservation = {
  readonly observation: string;
  readonly tip: string;
};

const share = (part: number, whole: number) =>
  Math.round((part / Math.max(1, whole)) * 100);

/**
 * The review's Presence section, by code from the readings: two to four
 * observations with tips, or none when too little was clear to say.
 */
export function presenceReview(
  readings: readonly PresenceReading[],
): PresenceObservation[] {
  const clear = readings.filter((r) => r.gaze !== "UNCLEAR");
  if (clear.length < 2) return [];
  const out: PresenceObservation[] = [];
  const atCamera = clear.filter((r) => r.gaze === "AT_CAMERA").length;
  const notes = clear.filter((r) => r.gaze === "READING_OFF_SCREEN").length;
  const away = clear.filter((r) => r.gaze === "LOOKING_AWAY").length;
  const eye = share(atCamera, clear.length);
  out.push(
    eye >= 70
      ? {
          observation: `You looked at the camera in most of what Q saw (${String(eye)}% of clear looks).`,
          tip: "Keep it: eye contact reads as conviction on a call.",
        }
      : {
          observation: `You looked at the camera in ${String(eye)}% of clear looks.`,
          tip: "Put the call window just under your camera and talk to the lens on your key points.",
        },
  );
  if (notes > 0) {
    out.push({
      observation: `You seemed to read from notes or another screen in ${String(share(notes, clear.length))}% of clear looks.`,
      tip: "Know your numbers cold; keep notes to a few prompts placed near the camera.",
    });
  } else if (away > 0) {
    out.push({
      observation: `You looked away from the call in ${String(share(away, clear.length))}% of clear looks.`,
      tip: "Close other windows and silence your phone before the call.",
    });
  }
  const setup: string[] = [];
  if (readings.some((r) => r.lighting === "POOR")) setup.push("lighting");
  if (readings.some((r) => r.framing === "POOR")) setup.push("framing");
  if (readings.some((r) => r.background === "BUSY")) setup.push("background");
  if (setup.length > 0) {
    out.push({
      observation: `Your setup could be better: ${setup.join(", ")}.`,
      tip: "Face a window or lamp, sit so your head and shoulders fill the frame, and pick a plain, quiet spot.",
    });
  } else {
    out.push({
      observation:
        "Your setup looked clean: good light and framing, a calm background.",
      tip: "Use the same spot for the real call.",
    });
  }
  if (
    out.length < 4 &&
    clear.filter((r) => r.confident).length >= clear.length / 2
  ) {
    out.push({
      observation: "You came across as steady and engaged on camera.",
      tip: "Keep the same pace when the questions get harder.",
    });
  }
  return out.slice(0, 4);
}
