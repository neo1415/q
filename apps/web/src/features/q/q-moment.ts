/**
 * Where in a pitch the person was when they asked Q (founder priority:
 * Q "watches the video with us").
 *
 * A moment is what is on screen at the instant Q is opened: the company,
 * its pitch and the playback position. Like a subject it is a request and
 * never authority -- the Q API resolves and authorises the company again,
 * and a later backend packet authorises the pitch before reading anything
 * said in it.
 *
 * Today the Q run contract (`CreateQRunRequest`) carries subjects only, so
 * the moment travels to the run as the words of the draft question, and
 * the sheet shows it. The pitch id and the position are held here, typed,
 * for the contract addition that will carry them (see the UX-05 report).
 */
export type QPitchMoment = {
  readonly kind: "PITCH_MOMENT";
  readonly companyId: string;
  readonly companyLabel: string;
  readonly mediaAssetId: string;
  /** Whole seconds into the pitch; never negative. */
  readonly positionSeconds: number;
};

export type QMoment = QPitchMoment;

/** A page's way of saying what is on screen right now, read when Q opens. */
export type QMomentSource = () => QMoment | null;

/** 102 -> "1:42"; 3725 -> "1:02:05". */
export function formatPlaybackPosition(seconds: number): string {
  const whole = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0
    ? `${String(h)}:${String(m).padStart(2, "0")}:${ss}`
    : `${String(m)}:${ss}`;
}

/** The subtle line on the Q surface: "At 1:42 in Kobo Logistics' pitch". */
export function describeMoment(moment: QMoment): string {
  const name = moment.companyLabel;
  const possessive = name.endsWith("s") ? `${name}'` : `${name}'s`;
  return `At ${formatPlaybackPosition(moment.positionSeconds)} in ${possessive} pitch`;
}

/** The start of the draft question, which the person finishes or clears. */
export function momentDraft(moment: QMoment): string {
  return `${describeMoment(moment)}: `;
}
