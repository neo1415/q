import type { QSessionValue } from "@/features/q/q-session";
import { liveAvailabilityFor } from "@/features/voice/live/availability";
import { isLineLive } from "@/features/voice/session";

import { abortableWait } from "./narrator";

/**
 * Opening Q's own voice for a Q Pitch tour (owner 15 Oct: the narration is
 * spoken in Q's live voice, the same voice session as the rest of Q).
 *
 * When GPT-Live is offered to this person, the tour opens the person's
 * ordinary Q voice line (`session.talk`, the existing gateway, caps and
 * metering) and briefs it as presenter. Otherwise no line is opened and the
 * narrator uses Q's standard TTS voice. A line the person already had open
 * is used as it is.
 */
export const TOUR_GREETING =
  "This person has just started a guided tour of Capital Q. In one short sentence, tell them you will walk them through it now. Nothing more: the tour's own words follow.";

export const TOUR_BRIEF =
  "For the rest of this call you are presenting a guided Q Pitch tour of Capital Q. The app moves the screen and hands you each line to say; say those lines exactly as given. Do not describe the screen on your own, and do not start any analysis or open anything yourself. When the person says pause, resume, continue, skip, next, go back, stop, or asks to see a part of the product, reply with at most three words, such as 'Of course.', and nothing else: the app does it. If they ask a real question, answer it briefly and honestly.";

const POLL_MS = 150;

export type TourVoice = "LIVE" | "STANDARD";

export async function openTourVoice(
  current: () => QSessionValue | null,
): Promise<TourVoice> {
  const never = new AbortController().signal;
  const liveNow = () => {
    const voice = current()?.voice;
    return (
      voice !== undefined &&
      voice.active &&
      isLineLive(voice.client) &&
      voice.client.narrate !== undefined
    );
  };
  const session = current();
  if (session === null) return "STANDARD";
  if (!liveNow()) {
    // Another kind of line already open: leave it; the narrator reads in
    // the standard voice beside it.
    if (session.voice.active) return "STANDARD";
    // A cold answer can take a few seconds; the person has just pressed
    // Start and sees "Opening Q's voice…" meanwhile.
    if ((await liveAvailabilityFor(5_000)) !== true) return "STANDARD";
    void session.talk({ greeting: TOUR_GREETING }).catch(() => undefined);
    const opened = performance.now();
    // Opening a line is a server action, and those run one at a time per
    // tab (production 15 Oct: queued behind page reads). If it is not up
    // in time the tour starts in the standard voice, and the line takes
    // over the narration whenever it comes up (the narrator briefs it).
    while (!liveNow() && performance.now() - opened < 20_000) {
      await abortableWait(POLL_MS, never);
    }
    if (!liveNow()) return "STANDARD";
    // Let the one-sentence greeting play out before the first line.
    const from = performance.now();
    let heard = false;
    let lastSound = from;
    while (performance.now() - from < 15_000) {
      const speaking = current()?.voice.client.state === "Q_SPEAKING";
      if (speaking) {
        heard = true;
        lastSound = performance.now();
      } else if (heard && performance.now() - lastSound > 900) break;
      else if (!heard && performance.now() - from > 8_000) break;
      await abortableWait(POLL_MS, never);
    }
  }
  return "LIVE";
}
