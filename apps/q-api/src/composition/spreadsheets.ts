import type { QMessage, QSubjectRef } from "@capital-q/contracts";
import type { ArtifactService } from "@capital-q/q-artifacts";
import {
  SPREADSHEET_ARTIFACT_TYPE,
  type ShownAnswer,
  type SpreadsheetPort,
} from "@capital-q/q-tools";
import type { ActorContext } from "@capital-q/security";

/**
 * XLSX-001: make_spreadsheet's port, composed.
 *
 * Reads Q's earlier answers in the run's own conversation as the run's
 * owner (a run or conversation that is not theirs is not found), names a
 * comparison's subjects the way an approval card names its target, and
 * files the built workbook through the artifact service's own
 * `fileOwnAnswer`: their organisation's private document, created by
 * them, on this run. Nothing here writes a cell; the builder did.
 */
export function createSpreadsheetPort(dependencies: {
  /** The run as its owner: its conversation id, or null when it has none. */
  readonly conversationOf: (
    actor: ActorContext,
    runId: string,
  ) => Promise<string | null>;
  /** The conversation's messages as its owner, oldest first. */
  readonly conversationMessages: (
    actor: ActorContext,
    conversationId: string,
  ) => Promise<readonly QMessage[]>;
  readonly nameOf?:
    | ((actor: ActorContext, subject: QSubjectRef) => Promise<string | null>)
    | undefined;
  readonly artifacts: Pick<ArtifactService, "fileOwnAnswer">;
}): SpreadsheetPort {
  return {
    shownAnswers: async (actor, runId) => {
      const conversationId = await dependencies.conversationOf(actor, runId);
      if (conversationId === null) return [];
      const messages = await dependencies.conversationMessages(
        actor,
        conversationId,
      );
      return messages
        .flatMap((message): ShownAnswer[] =>
          message.role === "Q" && (message.blocks?.length ?? 0) > 0
            ? [{ messageId: message.messageId, blocks: message.blocks ?? [] }]
            : [],
        )
        .reverse();
    },
    ...(dependencies.nameOf === undefined
      ? {}
      : {
          subjectNames: async (
            actor: ActorContext,
            subjects: readonly QSubjectRef[],
          ) => {
            const nameOf = dependencies.nameOf;
            const names = new Map<string, string>();
            if (nameOf === undefined) return names;
            for (const subject of subjects) {
              const id =
                subject.kind === "COMPANY"
                  ? subject.companyId
                  : subject.kind === "INVESTOR_ORGANISATION"
                    ? subject.investorOrganisationId
                    : null;
              if (id === null) continue;
              const name = await nameOf(actor, subject).catch(() => null);
              if (name !== null) names.set(id, name);
            }
            return names;
          },
        }),
    file: async (input) => {
      const detail = await dependencies.artifacts.fileOwnAnswer({
        actorContext: input.actor,
        qRunId: input.runId,
        artifactType: SPREADSHEET_ARTIFACT_TYPE,
        content: {
          title: input.title,
          summary: input.summary,
          content: input.content,
        },
      });
      return {
        artifactId: detail.artifact.artifactId,
        type: detail.artifact.type,
        status: detail.artifact.status,
        title: detail.artifact.title,
        currentVersion: detail.artifact.currentVersion,
      };
    },
  };
}
