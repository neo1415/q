import type {
  RelationshipStateV2,
  RelationshipSummaryDto,
} from "@capital-q/contracts";

/**
 * The founder's ONE way forward with an investor on their profile, from
 * the canonical relationship's projected state (live check 2026-10-16:
 * "Request to connect" showed beside a relationship already Connected, and
 * the Connect panel said it a second way). Pure, so the hero and the panel
 * read the same answer.
 *
 *   OPEN     in touch already (Connected onwards): open the CRM record
 *   ANSWER   they expressed interest in the company: answer it there
 *   ENDED    not taken forward / not proceeding: open the record, no new ask
 *   REQUEST  no relationship the company can see: a Connection Request
 *            (the Connect panel still decides pending, closed or declined)
 */
export type ConnectCta =
  | { readonly kind: "OPEN"; readonly state: RelationshipStateV2 }
  | { readonly kind: "ANSWER" }
  | { readonly kind: "ENDED"; readonly state: RelationshipStateV2 }
  | { readonly kind: "REQUEST" };

const IN_TOUCH: ReadonlySet<RelationshipStateV2> = new Set([
  "CONNECTED",
  "MEETING_HELD",
  "IN_DILIGENCE",
  "PAUSED",
  "INVESTED",
]);

export function connectCta(
  record: Pick<RelationshipSummaryDto, "state" | "nextStep"> | undefined,
): ConnectCta {
  if (record === undefined) return { kind: "REQUEST" };
  if (IN_TOUCH.has(record.state)) return { kind: "OPEN", state: record.state };
  if (
    record.state === "INTEREST_EXPRESSED" &&
    record.nextStep === "ANSWER_INTEREST"
  ) {
    return { kind: "ANSWER" };
  }
  if (record.state === "DECLINED" || record.state === "PASSED") {
    return { kind: "ENDED", state: record.state };
  }
  // Interest the company sent and still waiting, or a discovery the
  // company cannot see: the Connect panel says where the request stands.
  return { kind: "REQUEST" };
}

/** The one label everywhere a Connection Request is offered. */
export const REQUEST_WORDS = "Request to connect";
