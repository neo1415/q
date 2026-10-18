import type { AuthorisedFact } from "@capital-q/q-core";

/**
 * Where the person is in the pitch they are watching, and what is said
 * there, as one authorised fact (R18: "Q watches the video with us").
 *
 * Read through the same get_pitch_moment tool the model could call, under
 * the same plan, so it exists only when the Q API authorised the viewed
 * pitch for this person. It tells the model "now = 1:42 in this pitch" and
 * what the machine-generated transcript says around that moment -- labelled
 * as what the founder says in the video, never as evidence it is true.
 * With no transcript, the fact says so: Q can't hear the pitch yet, which
 * is never "nothing was said".
 */

type MomentRead = {
  readonly atSeconds?: unknown;
  readonly transcript?: unknown;
  readonly segments?: readonly {
    readonly fromSeconds?: unknown;
    readonly toSeconds?: unknown;
    readonly text?: unknown;
  }[];
};

/** 102 -> "1:42"; 3725 -> "1:02:05". */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, "0");
  return h > 0
    ? `${String(h)}:${String(m).padStart(2, "0")}:${s}`
    : `${String(m)}:${s}`;
}

export function pitchMomentFact(
  data: unknown,
  companyName: string | null,
): AuthorisedFact | null {
  const read = data as MomentRead;
  if (typeof read.atSeconds !== "number") return null;
  const whose =
    companyName === null
      ? "a company's pitch video"
      : `${companyName}'s pitch video`;
  const now = `The person is watching ${whose}, currently at ${clock(read.atSeconds)}.`;
  let said: string;
  if (read.transcript === "AVAILABLE") {
    const lines = (read.segments ?? [])
      .map((segment) =>
        typeof segment.fromSeconds === "number" &&
        typeof segment.toSeconds === "number" &&
        typeof segment.text === "string"
          ? `[${clock(segment.fromSeconds)}-${clock(segment.toSeconds)}] "${segment.text}"`
          : null,
      )
      .filter((line): line is string => line !== null);
    said =
      lines.length === 0
        ? "Nobody is speaking in the video around this moment."
        : `Around this moment the founder says (machine-generated transcript, their own words, not verified): ${lines.join(" ")}`;
  } else if (read.transcript === "PENDING") {
    said =
      "The transcript of this pitch is still being prepared, so what is said in it can't be read yet -- say so rather than guess.";
  } else {
    said =
      "There is no transcript of this pitch, so what is said in it is unknown -- say you can't hear the pitch yet, never that nothing was said.";
  }
  return {
    scope: "COMPANY_PROFILE",
    statement: `${now} ${said}`.slice(0, 2_000),
    truthClass: "USER_CLAIM",
    evidenceStatus: "SELF_REPORTED",
    source: "The pitch video's machine-generated transcript",
  };
}
