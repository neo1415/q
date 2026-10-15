import type { VideoAllowanceDto } from "@capital-q/contracts";

/**
 * What a person is told about their shared weekly video allowance (GateQ
 * video interviews and video Rehearsals together). The server enforces it;
 * this is wording only, and typing or the voice room is always offered.
 */
export function videoAllowanceLine(
  allowance: VideoAllowanceDto | null | undefined,
): string | null {
  if (allowance === null || allowance === undefined) return null;
  if (allowance.remaining === 0) return videoAllowanceUsedUp(allowance);
  return `${String(allowance.remaining)} of ${String(allowance.weeklySessions)} video sessions left this week.`;
}

export function videoAllowanceUsedUp(allowance: VideoAllowanceDto): string {
  const day = new Date(allowance.resetsAt).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  return `You’ve used this week’s ${String(allowance.weeklySessions)} video sessions. They start again on ${day}.`;
}
