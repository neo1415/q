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
  /**
   * 2026-10-20: the frame as a small grey thumbnail, decoded only when the
   * watch asks (lazy); null when it cannot be read. Absent: the byte
   * fingerprint decides, as before.
   */
  readonly thumb?: (() => Uint8Array | null) | undefined;
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
  /**
   * 2026-10-20: how different (mean grey difference, 0-255) a screen must
   * look from the last one Q looked at to count as changed.
   */
  readonly minChange?: number;
  /** After an unchanged frame, the next one is compared no sooner than this. */
  readonly recheckMs?: number;
};

export const DEFAULT_SCREEN_WATCH_LIMITS: ScreenWatchLimits = {
  minGapMs: 15_000,
  maxLooks: 40,
  maxBase64Chars: 1_500_000,
  minChange: 6,
  recheckMs: 1_000,
};

/**
 * 2026-10-20: how different two thumbnails look: the mean absolute grey
 * difference per cell (0 = the same picture, 255 = black to white).
 */
export function thumbDifference(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length || a.length === 0) return 255;
  let total = 0;
  for (let i = 0; i < a.length; i += 1) {
    total += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  }
  return total / a.length;
}

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
  let lastThumb: Uint8Array | null = null;
  let checkedAt = Number.NEGATIVE_INFINITY;
  const minChange =
    limits.minChange ?? DEFAULT_SCREEN_WATCH_LIMITS.minChange ?? 6;
  const recheckMs =
    limits.recheckMs ?? DEFAULT_SCREEN_WATCH_LIMITS.recheckMs ?? 1_000;
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
      // 2026-10-20: changed as people would see it, not byte for byte (a
      // moving cursor re-encodes the frame). Compared at most once a
      // second while the screen stays the same.
      if (frame.thumb !== undefined) {
        if (frame.at - checkedAt < recheckMs) return null;
        checkedAt = frame.at;
        const thumb = frame.thumb();
        if (thumb !== null) {
          if (
            lastThumb !== null &&
            thumbDifference(thumb, lastThumb) < minChange
          ) {
            return null;
          }
          lastThumb = thumb;
        }
      }
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
 * looks at, when camera vision is on: one look per call every `minGapMs`,
 * the same person no more than once every `perPersonGapMs` (so a gallery
 * is seen in turn), and at most `maxLooks` a call. 2026-10-20: within those
 * gaps a camera is looked at only when its picture changed visibly since
 * Q last looked at it (`minChange` on the frame's thumbnail), not on a
 * timer. What Q writes is behaviour, setup and objects only -- never
 * appearance or identity -- and private.
 */
export type CameraWatchLimits = {
  readonly minGapMs: number;
  readonly perPersonGapMs: number;
  readonly maxLooks: number;
  readonly maxBase64Chars: number;
  /**
   * 2026-10-20: a camera is looked at again only when its picture changed
   * this much (mean grey difference, 0-255) since Q last looked at it --
   * someone holds something up, the setup changes -- never on a timer.
   */
  readonly minChange?: number;
  /** A person's camera is compared no more often than this. */
  readonly recheckMs?: number;
};

export const DEFAULT_CAMERA_WATCH_LIMITS: CameraWatchLimits = {
  minGapMs: 30_000,
  perPersonGapMs: 120_000,
  maxLooks: 20,
  maxBase64Chars: 1_500_000,
  minChange: 16,
  recheckMs: 2_000,
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
  const thumbByPerson = new Map<string, Uint8Array>();
  const checkedByPerson = new Map<string, number>();
  const minChange =
    limits.minChange ?? DEFAULT_CAMERA_WATCH_LIMITS.minChange ?? 16;
  const recheckMs =
    limits.recheckMs ?? DEFAULT_CAMERA_WATCH_LIMITS.recheckMs ?? 2_000;
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
      // 2026-10-20: a camera Q has seen is looked at again only when its
      // picture changed visibly; a new camera is looked at once.
      if (frame.thumb !== undefined) {
        const checked = checkedByPerson.get(frame.participantId);
        if (checked !== undefined && frame.at - checked < recheckMs) {
          return null;
        }
        checkedByPerson.set(frame.participantId, frame.at);
        const thumb = frame.thumb();
        const before = thumbByPerson.get(frame.participantId);
        if (thumb !== null) {
          if (
            before !== undefined &&
            thumbDifference(thumb, before) < minChange
          ) {
            return null;
          }
          thumbByPerson.set(frame.participantId, thumb);
          if (thumbByPerson.size > 24) {
            const oldest = thumbByPerson.keys().next().value;
            if (oldest !== undefined) thumbByPerson.delete(oldest);
          }
        }
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
