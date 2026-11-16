import type { CallPrepWriter } from "@capital-q/model-gateway/q";
import type { Logger } from "@capital-q/observability";
import { orEmptyCase, PROMPT_EMPTY_CASES } from "@capital-q/q-core";
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
  > &
    Partial<Pick<RehearsalMaterial, "relationships">>;
  /** One record they may see, by the name they said; null when none or several. */
  readonly findByName: (
    actor: ActorContext,
    kind: "COMPANY" | "INVESTOR_ORGANISATION",
    name: string,
  ) => Promise<string | null>;
  /** What already waits for their approval (the Approval Engine's list). */
  readonly waiting?:
    ((actor: ActorContext) => Promise<readonly WaitingItem[]>) | undefined;
  /**
   * Live recheck 651a3bd50 T5: every meeting on record with one
   * relationship, with its status (the meetings read model, scoped to
   * relationships their organisation is a party to). Absent: only the
   * upcoming scheduled meetings are known.
   */
  readonly meetingsOnRecord?:
    | ((
        actor: ActorContext,
        relationshipId: string,
      ) => Promise<
        readonly { readonly startsAt: string; readonly status: string }[]
      >)
    | undefined;
  readonly write: CallPrepWriter;
  readonly logger?: Logger | undefined;
};

/**
 * RC4 (voice audit 15 Nov 2026, F7-04): words that name a role, not a
 * record. "If you were preparing me for an investor meeting" came back from
 * the reader as the counterpart "investor", and the name search matched
 * QInvest. The reader's slot is checked here: a counterpart made only of
 * these words is resolved among the person's own meetings and
 * relationships, never by a name search.
 */
const ROLE_ONLY = new Set([
  "a",
  "an",
  "the",
  "my",
  "our",
  "this",
  "that",
  "some",
  "any",
  "one",
  "new",
  "next",
  "first",
  "potential",
  "prospective",
  "possible",
  "lead",
  "seed",
  "institutional",
  "investor",
  "investors",
  "vc",
  "vcs",
  "fund",
  "funds",
  "angel",
  "angels",
  "backer",
  "backers",
  "firm",
  "firms",
  "partner",
  "partners",
  "founder",
  "founders",
  "company",
  "companies",
  "startup",
  "startups",
  "meeting",
  "meetings",
  "call",
  "calls",
  "pitch",
  "with",
]);

/** Lower-cased words of a name, without notes such as "(fictional)". */
function wordsOf(text: string): string[] {
  return text
    .replace(/\([^)]*\)/gu, " ")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);
}

export function namesOnlyARole(counterpart: string): boolean {
  const words = wordsOf(counterpart);
  return words.length > 0 && words.every((word) => ROLE_ONLY.has(word));
}

/**
 * A record found by name is the one they named only when a distinctive
 * word of its name is a word they said (or the whole name is): "Savanna"
 * is Savanna Seed Partners; "investor" is not QInvest.
 */
export function nameIsSaid(recordName: string, said: string): boolean {
  const spoken = new Set(wordsOf(said));
  const name = wordsOf(recordName);
  if (name.length === 0) return false;
  return name.some(
    (word) => word.length >= 3 && !ROLE_ONLY.has(word) && spoken.has(word),
  );
}

/** Stages where a meeting with them is the next or a recent step. */
const MEETING_STAGES = new Set(["CONNECTED", "MEETING_HELD", "IN_DILIGENCE"]);

/** A cancelled meeting is said while it is recent or still ahead. */
const CANCELLED_LOOKBACK_MS = 7 * 86_400_000;

export function createCallPrepPort(
  dependencies: CallPrepSources,
): QCallPrepPort {
  /** Start times of the relationship's cancelled meetings, recent or ahead. */
  const cancelledMeetings = async (
    actor: ActorContext,
    relationshipId: string,
  ): Promise<string[]> => {
    if (dependencies.meetingsOnRecord === undefined) return [];
    const all = await dependencies
      .meetingsOnRecord(actor, relationshipId)
      .catch(() => []);
    const from = Date.now() - CANCELLED_LOOKBACK_MS;
    return all
      .filter(
        (meeting) =>
          meeting.status === "CANCELLED" &&
          Date.parse(meeting.startsAt) >= from,
      )
      .map((meeting) => meeting.startsAt)
      .sort();
  };
  return {
    bookedWith: async (request, counterpart) => {
      const material = dependencies.material();
      if (material.relationships === undefined) return null;
      const viewer = await material.viewer(request.actor);
      if (viewer === null) return null;
      const kind =
        viewer.role === "FOUNDER" ? "INVESTOR_ORGANISATION" : "COMPANY";
      const [own, upcoming] = await Promise.all([
        material.relationships(request.actor),
        material.upcomingMeetings(request.actor),
      ]);
      const role = namesOnlyARole(counterpart);
      const theirs = own.filter(
        (row) =>
          row.kind === kind && (role || nameIsSaid(row.name, counterpart)),
      );
      return theirs.some((row) =>
        upcoming.some(
          (meeting) => meeting.relationshipId === row.relationshipId,
        ),
      );
    },
    prepare: async (request, input) => {
      const actor = request.actor;
      // Why a prep was not given, for the turn's log (live 2026-10-23).
      const skipped = (reason: "NO_SIDE" | "NOT_WRITTEN") =>
        dependencies.logger?.info(
          { qRunId: request.runId, reason },
          "call prep not given",
        );
      try {
        const material = dependencies.material();
        const viewer = await material.viewer(actor);
        if (viewer === null) {
          skipped("NO_SIDE");
          return null;
        }
        const kind =
          viewer.role === "FOUNDER" ? "INVESTOR_ORGANISATION" : "COMPANY";
        let counterpartSaid = input.counterpart;
        let id: string | null = null;
        if (namesOnlyARole(input.counterpart)) {
          // RC4: a role, not a name: their own meetings first, then the
          // relationships where a meeting is the step.
          const [own, upcoming] = await Promise.all([
            material.relationships === undefined
              ? []
              : material.relationships(actor).catch(() => []),
            material.upcomingMeetings(actor).catch(() => []),
          ]);
          const sameSide = own.filter((row) => row.kind === kind);
          const booked = sameSide.filter((row) =>
            upcoming.some(
              (meeting) => meeting.relationshipId === row.relationshipId,
            ),
          );
          const candidates =
            booked.length > 0
              ? booked
              : sameSide.filter((row) =>
                  MEETING_STAGES.has(row.state.toUpperCase()),
                );
          const [only] = candidates;
          if (candidates.length === 0 || only === undefined) {
            dependencies.logger?.info(
              { qRunId: request.runId, reason: "NONE_ON_RECORD" },
              "call prep not given",
            );
            return {
              kind: "NONE",
              role: kind === "COMPANY" ? "FOUNDER" : "INVESTOR",
            };
          }
          if (candidates.length > 1) {
            return {
              kind: "WHICH",
              options: [...new Set(candidates.map((row) => row.name))],
            };
          }
          id = only.id;
          counterpartSaid = only.name;
        } else {
          const found = await dependencies.findByName(
            actor,
            kind,
            input.counterpart,
          );
          id = found;
        }
        let them =
          id === null ? null : await material.counterpart(actor, kind, id);
        // RC4: a record whose name they did not say is not the one they
        // meant (a search can match a word inside another name).
        if (them !== null && !nameIsSaid(them.name, counterpartSaid)) {
          dependencies.logger?.info(
            { qRunId: request.runId },
            "call prep: the record found is not the one they named; prepared from the name",
          );
          them = null;
          id = null;
        }
        // Live 2026-10-23: a counterpart they cannot open by name (none, or
        // several as close) is still prepared, from their own record and
        // the name they said only: nothing of anyone else's is read.
        if (them === null) {
          dependencies.logger?.info(
            { qRunId: request.runId, resolved: id !== null },
            "call prep: counterpart not on their records; prepared from the name",
          );
        }
        const relationshipId = them?.relationshipId ?? null;
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
            them === null || id === null
              ? { text: "", sources: [] }
              : material
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
        // Live recheck 651a3bd50 T5: every Savanna–Watchly meeting was
        // CANCELLED, yet the brief, drawn from the correspondence, said a
        // call "was booked for Tuesday 17 November". Meeting facts come from
        // the meetings read model with their status.
        const cancelled =
          relationshipId === null || booked.length > 0
            ? []
            : await cancelledMeetings(actor, relationshipId);
        const soFar = [
          them === null
            ? "Nothing about them is on record that they can see."
            : relationshipId === null
              ? "No relationship on record yet: this would be the first contact."
              : null,
          booked.length === 0
            ? relationshipId === null
              ? null
              : [
                  "MEETINGS: none is booked with them.",
                  ...(cancelled.length === 0
                    ? []
                    : [`CANCELLED (not happening): ${cancelled.join(", ")}.`]),
                  "A time named or proposed in the messages is not a booking: never say a meeting is booked, scheduled, confirmed or pending.",
                ].join("\n")
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
        const name = them?.name ?? input.counterpart.trim().slice(0, 200);
        const prep = await dependencies.write(request, {
          viewerRole: viewer.role,
          counterpartName: name,
          counterpartProfile: [them?.profile ?? "", theirs.text]
            .filter((part) => part.trim().length > 0)
            .join("\n\n"),
          // "If nothing is given, say this is the first contact": an empty
          // history says it is empty in those words (PROMPT_EMPTY_CASES).
          soFar: orEmptyCase(soFar, PROMPT_EMPTY_CASES.CALL_PREP.soFar),
          ownRecord: own.text,
          said: input.said,
        });
        if (prep === null) {
          skipped("NOT_WRITTEN");
          return null;
        }
        const subjects =
          them === null || id === null
            ? []
            : [
                kind === "COMPANY"
                  ? { kind: "COMPANY" as const, companyId: id }
                  : {
                      kind: "INVESTOR_ORGANISATION" as const,
                      investorOrganisationId: id,
                    },
              ];
        const related = relatedWaiting(input.said, waitingNow, subjects);
        return {
          viewerRole: viewer.role,
          counterpartName: name,
          ...prep,
          waiting: related.about === "SAME_PEOPLE" ? related.waiting : [],
          ...(relationshipId === null
            ? {}
            : {
                meetings: {
                  booked: booked.map((meeting) => meeting.startsAt),
                  cancelled,
                },
              }),
          // Only a record they could open: the rehearsal lobby for it.
          counterpart: them === null || id === null ? null : { kind, id },
        };
      } catch (error: unknown) {
        if (request.signal?.aborted === true) throw error;
        dependencies.logger?.warn(
          { err: error, qRunId: request.runId },
          "call prep failed; the turn is answered the usual way",
        );
        return null;
      }
    },
  };
}
