import { randomUUID } from "node:crypto";

import type { MeetingNotesComposer } from "@capital-q/communication";
import type { ModelDataPosture } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  MeetingNotesV3ResultSchema,
  renderPrompt,
  type MeetingNotesV3Result,
  type MeetingNotesV3Variables,
} from "@capital-q/q-core";

/**
 * The meeting record (ADR 0027), written through the model gateway by task
 * class like every other model call (MEETING_NOTES v3). The transcript goes
 * to the provider the gateway picks for CONFIDENTIAL work; the meeting
 * assistant service keeps it with the record.
 */
const NOTES_BUDGET = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.08,
  maxOutputTokens: 3_000,
  attemptTimeoutMs: 60_000,
} as const;

export const MEETING_NOTES_COMPOSER_VERSION = "meeting-notes.v3";

export function createMeetingNotesComposer(dependencies: {
  readonly gateway: ModelGateway;
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly logger?: Logger | undefined;
}): MeetingNotesComposer {
  const registry = createDefaultPromptRegistry();
  return {
    compose: async (input) => {
      const rendered = renderPrompt<MeetingNotesV3Variables>(registry, {
        task: "MEETING_NOTES",
        operatingMode: "ASSESSMENT",
        communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
        environmentNotes:
          "You write from the call's captions only; captions can mishear names and numbers.",
        variables: {
          purpose: input.purpose,
          organiserName: input.organiserName,
          transcript: input.transcript,
          callDate: input.callDate,
        },
      });
      const runId = randomUUID();
      try {
        const response =
          await dependencies.gateway.execute<MeetingNotesV3Result>(
            {
              taskClass: "STRUCTURED_EXTRACTION",
              sensitivity: "CONFIDENTIAL",
              ...(dependencies.dataPosture === undefined
                ? {}
                : { dataPosture: dependencies.dataPosture }),
              budget: NOTES_BUDGET,
              messages: [...rendered.messages],
              output: rendered.output,
              attribution: {
                purpose: "MEETING",
                tenantId: input.tenantId,
                userId: input.userId,
                correlationId: `cor_${runId}`,
              },
            },
            { schema: MeetingNotesV3ResultSchema },
          );
        if (response.output.kind !== "STRUCTURED") return null;
        const parsed = MeetingNotesV3ResultSchema.safeParse(
          (response.output as { readonly value: unknown }).value,
        );
        if (!parsed.success) return null;
        return {
          summary: parsed.data.summary,
          flags: parsed.data.flags,
          followUps: parsed.data.followUps,
          attendees: parsed.data.attendees,
          agreements: parsed.data.agreements,
          commitments: parsed.data.commitments,
          nextSteps: parsed.data.nextSteps,
          composerVersion: MEETING_NOTES_COMPOSER_VERSION,
        };
      } catch (error: unknown) {
        dependencies.logger?.warn({ err: error }, "meeting notes not written");
        return null;
      }
    },
  };
}
