import { randomUUID } from "node:crypto";

import type { MeetingNotesComposer } from "@capital-q/communication";
import type { ModelDataPosture } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  MeetingNotesResultSchema,
  renderPrompt,
  type MeetingNotesResult,
  type MeetingNotesVariables,
} from "@capital-q/q-core";

/**
 * Q's notes on a call it attended, written through the model gateway by
 * task class like every other model call (MEETING_NOTES). The transcript
 * is the organiser's own call and goes to the provider the gateway picks
 * for CONFIDENTIAL work; nothing here stores it.
 */
const NOTES_BUDGET = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.08,
  maxOutputTokens: 2_000,
  attemptTimeoutMs: 60_000,
} as const;

export const MEETING_NOTES_COMPOSER_VERSION = "meeting-notes.v1";

export function createMeetingNotesComposer(dependencies: {
  readonly gateway: ModelGateway;
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly logger?: Logger | undefined;
}): MeetingNotesComposer {
  const registry = createDefaultPromptRegistry();
  return {
    compose: async (input) => {
      const rendered = renderPrompt<MeetingNotesVariables>(registry, {
        task: "MEETING_NOTES",
        operatingMode: "ASSESSMENT",
        communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
        environmentNotes:
          "You write from the call's captions only; captions can mishear names and numbers.",
        variables: {
          purpose: input.purpose,
          organiserName: input.organiserName,
          transcript: input.transcript,
        },
      });
      const runId = randomUUID();
      try {
        const response = await dependencies.gateway.execute<MeetingNotesResult>(
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
              tenantId: input.tenantId,
              userId: input.userId,
              correlationId: `cor_${runId}`,
            },
          },
          { schema: MeetingNotesResultSchema },
        );
        if (response.output.kind !== "STRUCTURED") return null;
        const parsed = MeetingNotesResultSchema.safeParse(
          (response.output as { readonly value: unknown }).value,
        );
        if (!parsed.success) return null;
        return {
          summary: parsed.data.summary,
          flags: parsed.data.flags,
          followUps: parsed.data.followUps,
          composerVersion: MEETING_NOTES_COMPOSER_VERSION,
        };
      } catch (error: unknown) {
        dependencies.logger?.warn({ err: error }, "meeting notes not written");
        return null;
      }
    },
  };
}
