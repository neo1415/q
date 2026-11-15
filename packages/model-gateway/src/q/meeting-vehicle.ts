/**
 * The meeting vehicle (live 15 Nov 2026, D-Q3; audit
 * docs/ai-handoff/audits/2026-11-15-meetings-through-q-live.md).
 *
 * "Set up a call with Savanna Seed next week" became a chat message that
 * promised an invite, and "Move the call with Savanna to Thursday
 * afternoon" became a profile time-zone card. Like the uncertainty
 * vehicle rule (0c9e627a1), the route is decided from the turn reader's
 * structured output -- the action it read as asked for -- never from the
 * words: a turn that asked to set up a call goes through the meeting
 * tools (which choose the proposal or the errand), and a turn that asked
 * to move one goes through the move tool. A chat message, an email or a
 * profile change the model prepares on such a turn is refused with the
 * vehicle named; a message or profile change asked for keeps its own way.
 */

/** Actions that set up a call: the meeting tools choose the vehicle. */
const SCHEDULE_ACTIONS: ReadonlySet<string> = new Set([
  "propose_meeting",
  "propose_meeting_time",
  "find_meeting_times",
]);

/** The action that moves (or cancels) a booked call. */
const MOVE_ACTIONS: ReadonlySet<string> = new Set(["propose_meeting_change"]);

export type MeetingIntent = {
  readonly kind: "SCHEDULE" | "MOVE";
  /** The tool that carries it. */
  readonly vehicle: string;
};

/** The meeting the turn asked for, from the reader's askedAction only. */
export function meetingIntentOf(
  askedAction: string | null | undefined,
): MeetingIntent | null {
  if (askedAction === null || askedAction === undefined) return null;
  if (SCHEDULE_ACTIONS.has(askedAction)) {
    return { kind: "SCHEDULE", vehicle: "propose_meeting" };
  }
  if (MOVE_ACTIONS.has(askedAction)) {
    return { kind: "MOVE", vehicle: "propose_meeting_change" };
  }
  return null;
}

/** Tools that would carry a meeting the wrong way on a meeting turn. */
const NOT_A_MEETING_VEHICLE: ReadonlySet<string> = new Set([
  "propose_chat_message",
  "propose_email",
  "update_my_profile",
]);

/**
 * Whether a call the model makes on a meeting turn goes ahead. A chat
 * message, email or profile change is refused with the vehicle named; on
 * a move, so is a new call (propose_meeting) in place of moving the one
 * booked. Code's own follow-on calls (`q-` ids) always go.
 */
export function meetingVehicleDecision(
  call: { readonly name: string; readonly callId: string },
  intent: MeetingIntent | null,
):
  | { readonly kind: "CALL" }
  | { readonly kind: "REFUSE"; readonly said: string } {
  if (intent === null || call.callId.startsWith("q-")) return { kind: "CALL" };
  const wrong =
    NOT_A_MEETING_VEHICLE.has(call.name) ||
    (intent.kind === "MOVE" &&
      (call.name === "propose_meeting" ||
        call.name === "propose_meeting_time"));
  if (!wrong) return { kind: "CALL" };
  return {
    kind: "REFUSE",
    said:
      intent.kind === "MOVE"
        ? "They asked to move a booked call. Call propose_meeting_change (RESCHEDULE, naming the call by counterpartName or meetingId, with the new time as they said it); never a chat message, a new call or a profile change for it. If their time zone is not known, ask once which city they are in. Nothing else is prepared or sent."
        : "They asked to set up a call. Call propose_meeting with the time (find_meeting_times first if they named none): it prepares a proposal the other side accepts, or Q's errand, and never promises an invite. Never a chat message or a profile change for it. If their time zone is not known, ask once which city they are in. Nothing else is prepared or sent.",
  };
}
