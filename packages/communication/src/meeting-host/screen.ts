/**
 * P5: which shared-screen frames from a call Q looks at (pure; no I/O).
 *
 * Recall streams each participant's video as 360p PNG frames, two a
 * second, labelled "webcam" or "screenshare". Q looks only at screen
 * shares -- never webcams (no faces, appearance or identity) -- and only on
 * a budget: when the screen changed, no more often than once every
 * `minGapMs`, and at most `maxLooks` times a call. What Q writes about a
 * look goes to the owner's PRIVATE notes, never to the transcript, the
 * recap or the other side. Frames are never kept beyond the look.
 */

export type ScreenFrame = {
  readonly participantId: string;
  readonly participantName: string;
  readonly type: "webcam" | "screenshare";
  /** Base64 PNG, as Recall sends it. */
  readonly pngBase64: string;
  readonly at: number;
};

export type ScreenLook = {
  readonly participantName: string;
  readonly pngBase64: string;
  readonly at: number;
};

export type ScreenWatchLimits = {
  readonly minGapMs: number;
  readonly maxLooks: number;
  /** A frame larger than this is not looked at (360p PNG is far smaller). */
  readonly maxBase64Chars: number;
};

export const DEFAULT_SCREEN_WATCH_LIMITS: ScreenWatchLimits = {
  minGapMs: 15_000,
  maxLooks: 40,
  maxBase64Chars: 1_500_000,
};

/**
 * A cheap fingerprint of a frame: its length and a strided sample of its
 * bytes. PNG encoding is deterministic, so an unchanged slide gives the
 * same fingerprint; any visible change almost always alters it.
 */
export function frameFingerprint(base64: string): string {
  const stride = Math.max(1, Math.floor(base64.length / 512));
  let sample = "";
  for (let i = 0; i < base64.length; i += stride) sample += base64[i] ?? "";
  return `${String(base64.length)}:${sample}`;
}

export type ScreenWatch = {
  /** A look Q should take now, or null (webcam, unchanged, too soon, spent). */
  readonly offer: (frame: ScreenFrame) => ScreenLook | null;
  readonly looks: () => number;
};

export function createScreenWatch(
  limits: ScreenWatchLimits = DEFAULT_SCREEN_WATCH_LIMITS,
): ScreenWatch {
  let looks = 0;
  let lastLookAt = Number.NEGATIVE_INFINITY;
  let lastSeen: string | null = null;
  return {
    offer: (frame) => {
      if (frame.type !== "screenshare") return null;
      if (looks >= limits.maxLooks) return null;
      if (
        frame.pngBase64.length === 0 ||
        frame.pngBase64.length > limits.maxBase64Chars
      ) {
        return null;
      }
      if (frame.at - lastLookAt < limits.minGapMs) return null;
      const print = frameFingerprint(frame.pngBase64);
      if (print === lastSeen) return null;
      lastSeen = print;
      lastLookAt = frame.at;
      looks += 1;
      return {
        participantName: frame.participantName.slice(0, 200),
        pngBase64: frame.pngBase64,
        at: frame.at,
      };
    },
    looks: () => looks,
  };
}

/**
 * 2026-10-08 (founder: "can Q see the camera too"): which webcam frames Q
 * looks at, when camera vision is on. A camera always changes, so the
 * budget is time alone: one look per call every `minGapMs`, the same
 * person no more than once every `perPersonGapMs` (so a gallery is seen in
 * turn), and at most `maxLooks` a call. What Q writes is behaviour, setup
 * and objects only -- never appearance or identity -- and private.
 */
export type CameraWatchLimits = {
  readonly minGapMs: number;
  readonly perPersonGapMs: number;
  readonly maxLooks: number;
  readonly maxBase64Chars: number;
};

export const DEFAULT_CAMERA_WATCH_LIMITS: CameraWatchLimits = {
  minGapMs: 30_000,
  perPersonGapMs: 120_000,
  maxLooks: 20,
  maxBase64Chars: 1_500_000,
};

export type CameraWatch = {
  readonly offer: (frame: ScreenFrame) => ScreenLook | null;
  readonly looks: () => number;
};

export function createCameraWatch(
  limits: CameraWatchLimits = DEFAULT_CAMERA_WATCH_LIMITS,
): CameraWatch {
  let looks = 0;
  let lastLookAt = Number.NEGATIVE_INFINITY;
  const lastByPerson = new Map<string, number>();
  return {
    offer: (frame) => {
      if (frame.type !== "webcam") return null;
      if (looks >= limits.maxLooks) return null;
      if (
        frame.pngBase64.length === 0 ||
        frame.pngBase64.length > limits.maxBase64Chars
      ) {
        return null;
      }
      if (frame.at - lastLookAt < limits.minGapMs) return null;
      const last = lastByPerson.get(frame.participantId);
      if (last !== undefined && frame.at - last < limits.perPersonGapMs) {
        return null;
      }
      lastLookAt = frame.at;
      lastByPerson.set(frame.participantId, frame.at);
      looks += 1;
      return {
        participantName: frame.participantName.slice(0, 200),
        pngBase64: frame.pngBase64,
        at: frame.at,
      };
    },
    looks: () => looks,
  };
}
