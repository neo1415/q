import "server-only";

/** Q Pitch is on only when the server says so (CQ_Q_PITCH_TOUR=1). */
export function qPitchEnabled(): boolean {
  return process.env.CQ_Q_PITCH_TOUR === "1";
}
