import { z } from "zod";
import {
  UuidSchema,
  type QMeetingAssistantDto,
  type QTaskClass,
} from "@capital-q/contracts";
import { capability, type ActorContext } from "@capital-q/security";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { boundScopeFor } from "../plan.js";
import type { RelationshipIntelligencePort } from "../ports.js";

/**
 * W5.3 (Q Workspace plan §5): what was said in a recorded call, for Q to
 * answer from and to propose the follow-ups -- a Safe Read, participants
 * only.
 *
 * Three gates, in order:
 *   1. the relationship is one the firewall bound for this run (the actor
 *      is a party to it);
 *   2. the meeting is one of that relationship's own calls, from its
 *      Relationship Brief, read as the actor;
 *   3. the meeting record is read through the meeting assistant as the
 *      actor, which answers only for the organiser or a participant
 *      (communication.meeting_participants). Anyone else gets nothing.
 * Q's own analysis of the call (summary, flags, follow-ups) is the
 * analysing side's only (spec 6.9.6); the other side reads what was said.
 *
 * Money mentioned is a SIGNAL, never committed capital (§6.6.14). Q may
 * propose recording it; that is an APPROVAL action on the relationship's
 * page, run only on the person's approval of its exact payload. A hard or
 * "invested" commitment is only ever the person's own statement that the
 * money moved -- never Q's inference from a call.
 */

export const READ_MEETING_RECORD = "meeting.record.read" as const;

const PURPOSES: readonly QTaskClass[] = [
  "RELATIONSHIP_QUESTION",
  "COUNTERPARTY_COMPANY_QUESTION",
  "INVESTOR_QUESTION",
  "ACTION_PREPARATION",
  "GENERAL_QUESTION",
];

/**
 * How much of a call's transcript is handed to Q: a long call is held in
 * full up to this many characters, from its start, and said to be cut
 * where it is. Notes, agreements and money mentioned are always whole.
 */
export const MEETING_TRANSCRIPT_CHARS_MAX = 60_000;

export type MeetingRecordPort = {
  /**
   * The meeting's record as this actor may read it; null when the actor
   * is not its organiser or a participant, or there is no such meeting.
   */
  readonly read: (
    actor: ActorContext,
    meetingId: string,
  ) => Promise<QMeetingAssistantDto | null>;
};

export const ReadMeetingRecordInputSchema = z
  .object({
    relationshipId: UuidSchema.describe(
      "The relationship the call belongs to, as given in the conversation context.",
    ),
    meetingId: UuidSchema.optional().describe(
      "A specific call of that relationship; omit for its most recent past call.",
    ),
  })
  .strict();
export type ReadMeetingRecordInput = z.infer<
  typeof ReadMeetingRecordInputSchema
>;

export const ReadMeetingRecordOutputSchema = z
  .object({
    meetingId: UuidSchema,
    startsAt: z.string(),
    /** READY: the record below. Otherwise: no record to read (say so). */
    record: z.enum(["READY", "PENDING", "NONE", "FAILED", "DECLINED"]),
    attendees: z.array(
      z
        .object({
          name: z.string(),
          side: z.enum(["FOUNDER", "INVESTOR"]).nullable(),
        })
        .strict(),
    ),
    agreements: z.array(z.string()),
    /** Money mentioned: signals, never committed capital. */
    moneyMentioned: z.array(
      z
        .object({
          party: z.string(),
          amount: z.string(),
          firmness: z.enum(["EXPLORATORY", "SOFT", "FIRM"]),
          quote: z.string(),
        })
        .strict(),
    ),
    /** Q's own notes: only for the side whose Q analysed the call. */
    summary: z.string().nullable(),
    followUps: z.array(
      z.object({ text: z.string(), owner: z.string().nullable() }).strict(),
    ),
    transcript: z.array(
      z.object({ speaker: z.string().nullable(), text: z.string() }).strict(),
    ),
    /** The transcript was longer than Q is handed; it stops here. */
    transcriptCut: z.boolean(),
    /**
     * What Q may do next, in its own terms: propose, never record. The
     * person approves the exact payload on the relationship's page.
     */
    proposals: z.array(z.string()),
    source: z.literal("Q's record of the call (machine transcript)"),
    truthClass: z.literal("USER_CLAIM"),
  })
  .strict();
export type ReadMeetingRecordOutput = z.infer<
  typeof ReadMeetingRecordOutputSchema
>;

/** The transcript from its start, whole lines, within the bound. */
export function boundedTranscript(
  lines: QMeetingAssistantDto["transcript"],
  maxChars: number = MEETING_TRANSCRIPT_CHARS_MAX,
): {
  readonly lines: QMeetingAssistantDto["transcript"];
  readonly cut: boolean;
} {
  const kept: QMeetingAssistantDto["transcript"][number][] = [];
  let used = 0;
  for (const line of lines) {
    const size = line.text.length + (line.speaker?.length ?? 0);
    if (used + size > maxChars) return { lines: kept, cut: true };
    used += size;
    kept.push(line);
  }
  return { lines: kept, cut: false };
}

/**
 * What Q may propose from the call, deterministically from its record:
 * money mentioned becomes "propose recording it" (APPROVAL, the person's
 * approval of the exact amount); never a hard commitment, which is the
 * person's own statement that the money moved.
 */
export function meetingProposals(
  record: Pick<QMeetingAssistantDto, "commitments" | "followUps">,
): string[] {
  const proposals: string[] = [];
  for (const signal of record.commitments) {
    proposals.push(
      `${signal.party} mentioned ${signal.amount} (${signal.firmness.toLowerCase()}). You may offer to record it as a soft commitment for them to confirm; it is recorded only when the person approves the exact amount (the relationship page's "commitment" action). Never call it committed, firm or invested: that is the person's own statement that the money moved.`,
    );
  }
  for (const followUp of record.followUps) {
    proposals.push(
      `Follow-up from the call: ${followUp.text}${followUp.owner === null ? "" : ` (${followUp.owner})`}. You may offer to prepare it; anything sent needs the person's approval.`,
    );
  }
  return proposals;
}

export function createReadMeetingRecordTool(
  meetings: MeetingRecordPort,
  relationships: Pick<RelationshipIntelligencePort, "brief">,
): AnyQToolDefinition {
  return defineQTool<
    ReadMeetingRecordInput,
    ReadMeetingRecordOutput,
    ReadMeetingRecordOutput
  >({
    id: READ_MEETING_RECORD,
    version: 1,
    status: "ACTIVE",
    providerName: "read_meeting",
    description:
      "What was said in a recorded call with a counterparty: attendees, agreements, money mentioned, the transcript, and (for the side whose Q took notes) the summary and follow-ups. Pass the relationshipId; omit meetingId for its most recent past call. Call it whenever the person asks what was said, agreed or promised in a call, or what to do after one. Money mentioned is a signal, never committed capital: offer to record it as a soft commitment for the person to approve, never record it yourself, and never call it firm or invested -- only the person can say the money moved. A record other than READY means there is nothing to read yet: say so plainly.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    requiredCapabilities: [
      capability("investor.view"),
      capability("company.interest.view"),
    ],
    supportedPurposes: [...PURPOSES],
    requiredScopeKinds: ["RELATIONSHIP_CONTEXT"],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: "REVIEWING_RELATIONSHIP",
    input: ReadMeetingRecordInputSchema,
    output: ReadMeetingRecordOutputSchema,
    authorize: async (input, { actor, plan }) => {
      const id = input.relationshipId;
      // 1. A relationship the firewall bound for this run.
      if (
        boundScopeFor(
          plan,
          "RELATIONSHIP_CONTEXT",
          (filter) => filter.relationshipIds?.includes(id) === true,
        ) === undefined
      ) {
        return deny("NOT_AVAILABLE");
      }
      const readBrief = relationships.brief;
      if (readBrief === undefined) return deny("NOT_AVAILABLE");
      try {
        // 2. One of that relationship's own calls, as the actor sees them.
        const brief = await readBrief(actor, id);
        if (brief === null || brief.meetings.status !== "OK") {
          return deny("NOT_AVAILABLE");
        }
        const past = brief.meetings.items.filter(
          (meeting) => meeting.timing === "PAST",
        );
        const meeting =
          input.meetingId === undefined
            ? past.at(-1)
            : brief.meetings.items.find((one) => one.id === input.meetingId);
        if (meeting === undefined) return deny("NOT_AVAILABLE");
        // 3. The record, read as the actor: participants only.
        const record = await meetings.read(actor, meeting.id);
        if (record === null) return deny("NOT_AVAILABLE");
        // DONE: the call's record is written and readable.
        const ready = record.status === "DONE";
        const transcript = boundedTranscript(ready ? record.transcript : []);
        return allow("CONFIDENTIAL", {
          meetingId: meeting.id,
          startsAt: meeting.startsAt,
          record: ready
            ? "READY"
            : record.status === "FAILED" || record.status === "DECLINED"
              ? record.status
              : record.status === "NONE" || record.status === "CANCELLED"
                ? "NONE"
                : "PENDING",
          attendees: ready ? [...record.attendees] : [],
          agreements: ready ? [...record.agreements] : [],
          moneyMentioned: ready
            ? record.commitments.map((one) => ({ ...one }))
            : [],
          summary: ready ? record.summary : null,
          followUps: ready ? record.followUps.map((one) => ({ ...one })) : [],
          transcript: transcript.lines.map((line) => ({ ...line })),
          transcriptCut: transcript.cut,
          proposals: ready ? meetingProposals(record) : [],
          source: "Q's record of the call (machine transcript)",
          truthClass: "USER_CLAIM",
        });
      } catch {
        return deny("NOT_AVAILABLE");
      }
    },
    execute: (_input, _context, grant) => Promise.resolve(grant),
  });
}
