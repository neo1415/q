import type { CallPrepWriter } from "@capital-q/model-gateway/q";
import type { QCallPrepPort } from "@capital-q/q-specialists";
import type { ActorContext } from "@capital-q/security";

import type { RehearsalMaterial } from "./rehearsals.js";
import { relatedWaiting, type WaitingItem } from "./workforce/job-actions.js";

/**
 * Owner 2026-10-23: a call with one named counterpart, prepared in the
 * answer. Context Firewall before the model: the counterpart is resolved
 * only among records this person may already see (the same rule open_page
 * uses), and everything given to the writer is the rehearsal's own
 * material, read as them -- the counterpart's declared, network-visible
 * profile, the relationship from their side, and their own record. An
 * investor's mandate is investor_private and is never read here.
 */
export type CallPrepSources = {
  /** Read when a call is prepared: composed after the answer in main. */
  readonly material: () => Pick<
    RehearsalMaterial,
    | "viewer"
    | "counterpart"
    | "theirMessages"
    | "theirCalls"
    | "counterpartMaterial"
    | "ownMaterial"
    | "upcomingMeetings"
  >;
  /** One record they may see, by the name they said; null when none or several. */
  readonly findByName: (
    actor: ActorContext,
    kind: "COMPANY" | "INVESTOR_ORGANISATION",
    name: string,
  ) => Promise<string | null>;
  /** What already waits for their approval (the Approval Engine's list). */
  readonly waiting?:
    ((actor: ActorContext) => Promise<readonly WaitingItem[]>) | undefined;
  readonly write: CallPrepWriter;
};

export function createCallPrepPort(
  dependencies: CallPrepSources,
): QCallPrepPort {
  return {
    prepare: async (request, input) => {
      const actor = request.actor;
      try {
        const material = dependencies.material();
        const viewer = await material.viewer(actor);
        if (viewer === null) return null;
        const kind =
          viewer.role === "FOUNDER" ? "INVESTOR_ORGANISATION" : "COMPANY";
        const id = await dependencies.findByName(
          actor,
          kind,
          input.counterpart,
        );
        if (id === null) return null;
        const them = await material.counterpart(actor, kind, id);
        if (them === null) return null;
        const relationshipId = them.relationshipId;
        const [messages, calls, meetings, theirs, own, waitingNow] =
          await Promise.all([
            relationshipId === null
              ? ""
              : material.theirMessages(actor, relationshipId).catch(() => ""),
            relationshipId === null
              ? ""
              : material.theirCalls(actor, relationshipId).catch(() => ""),
            relationshipId === null
              ? []
              : material.upcomingMeetings(actor).catch(() => []),
            material
              .counterpartMaterial(actor, kind, id)
              .catch(() => ({ text: "", sources: [] })),
            material
              .ownMaterial(actor)
              .catch(() => ({ text: "", sources: [] })),
            dependencies.waiting === undefined
              ? []
              : dependencies.waiting(actor).catch(() => []),
          ]);
        const booked = meetings.filter(
          (meeting) => meeting.relationshipId === relationshipId,
        );
        const soFar = [
          relationshipId === null
            ? "No relationship on record yet: this would be the first contact."
            : null,
          booked.length === 0
            ? null
            : `MEETINGS BOOKED:\n${booked
                .map((meeting) => `- ${meeting.startsAt}: ${meeting.purpose}`)
                .join("\n")}`,
          messages.length === 0
            ? null
            : `WHAT THEY WROTE TO YOU:\n${messages.slice(-3_000)}`,
          calls.length === 0
            ? null
            : `EARLIER CALLS WITH THEM:\n${calls.slice(-3_000)}`,
        ]
          .filter((part): part is string => part !== null)
          .join("\n\n");
        const prep = await dependencies.write(request, {
          viewerRole: viewer.role,
          counterpartName: them.name,
          counterpartProfile: [them.profile, theirs.text]
            .filter((part) => part.trim().length > 0)
            .join("\n\n"),
          soFar,
          ownRecord: own.text,
          said: input.said,
        });
        if (prep === null) return null;
        const subject =
          kind === "COMPANY"
            ? { kind: "COMPANY" as const, companyId: id }
            : {
                kind: "INVESTOR_ORGANISATION" as const,
                investorOrganisationId: id,
              };
        const related = relatedWaiting(input.said, waitingNow, [subject]);
        return {
          counterpartName: them.name,
          ...prep,
          waiting: related.about === "SAME_PEOPLE" ? related.waiting : [],
        };
      } catch (error: unknown) {
        if (request.signal?.aborted === true) throw error;
        return null;
      }
    },
  };
}
