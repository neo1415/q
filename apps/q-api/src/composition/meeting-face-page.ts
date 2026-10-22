import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * One Q in the call (owner decision 2026-10-21). The Recall note-taker shows
 * a Capital Q page as its camera: the page joins Q's private Tavus room and
 * shows the face, and it plays Q's own voice whenever the face is not
 * there. Recall cannot play output audio while it shows a page, so the
 * page is Q's only way to be heard in this mode.
 *
 * The page is opened by Recall's browser, not by a person. It is
 * authorised by a key derived from the meeting id with a server secret
 * (CQ_MEETING_FACE_PAGE_SECRET): no cookie, no user token, nothing stored.
 * It learns only the room's link and join token while the face is live,
 * and the audio of lines Q has already decided to say aloud in that call.
 * Off unless the mode and the secret are both configured.
 */

export type MeetingFacePageVoice =
  | { readonly kind: "AUDIO"; readonly mp3Base64: string }
  | { readonly kind: "STOP" };

export type MeetingFacePageHub = {
  /** The page's address for a meeting, key included. */
  readonly pageUrl: (meetingId: string) => string;
  readonly verify: (meetingId: string, key: string) => boolean;
  /** A line Q decided to say, for the page to play; false: no page open. */
  readonly speak: (meetingId: string, voice: MeetingFacePageVoice) => boolean;
  /** The page listens; returns how to stop listening. */
  readonly listen: (
    meetingId: string,
    listener: (voice: MeetingFacePageVoice) => void,
  ) => () => void;
};

/** A line said while the page was reconnecting is kept this long. */
const VOICE_FRESH_MS = 8_000;

export const meetingFacePageKey = (secret: string, meetingId: string) =>
  createHmac("sha256", secret)
    .update(`capital-q/meeting-face-page/v1:${meetingId}`)
    .digest("base64url");

export function createMeetingFacePageHub(options: {
  readonly secret: string;
  /** e.g. https://q-api.example: Q API's public origin. */
  readonly publicBaseUrl: string;
  readonly pagePath: (meetingId: string) => string;
  readonly now?: () => number;
}): MeetingFacePageHub {
  const now = options.now ?? (() => Date.now());
  const base = options.publicBaseUrl.replace(/\/+$/u, "");
  const listeners = new Map<
    string,
    Set<(voice: MeetingFacePageVoice) => void>
  >();
  const held = new Map<string, { voice: MeetingFacePageVoice; at: number }[]>();

  return {
    pageUrl: (meetingId) =>
      `${base}${options.pagePath(meetingId)}?k=${meetingFacePageKey(options.secret, meetingId)}`,
    verify: (meetingId, key) => {
      const expected = Buffer.from(
        meetingFacePageKey(options.secret, meetingId),
      );
      const presented = Buffer.from(key);
      return (
        presented.length === expected.length &&
        timingSafeEqual(presented, expected)
      );
    },
    speak: (meetingId, voice) => {
      const open = listeners.get(meetingId);
      if (open !== undefined && open.size > 0) {
        for (const listener of open) listener(voice);
        return true;
      }
      // The page is reconnecting: keep the line briefly, never a backlog.
      if (voice.kind === "STOP") {
        held.delete(meetingId);
        return false;
      }
      const lines = (held.get(meetingId) ?? []).filter(
        (line) => now() - line.at <= VOICE_FRESH_MS,
      );
      lines.push({ voice, at: now() });
      held.set(meetingId, lines.slice(-2));
      if (held.size > 200) {
        const oldest = held.keys().next().value;
        if (oldest !== undefined) held.delete(oldest);
      }
      return false;
    },
    listen: (meetingId, listener) => {
      const open = listeners.get(meetingId) ?? new Set();
      open.add(listener);
      listeners.set(meetingId, open);
      const waiting = held.get(meetingId) ?? [];
      held.delete(meetingId);
      for (const line of waiting) {
        if (now() - line.at <= VOICE_FRESH_MS) listener(line.voice);
      }
      return () => {
        open.delete(listener);
        if (open.size === 0) listeners.delete(meetingId);
      };
    },
  };
}
