import { QApprovalIdSchema } from "@capital-q/contracts";
import type { QActionService } from "@capital-q/q-actions";
import type { ArtifactService } from "@capital-q/q-artifacts";
import type { ApprovalInboxPort, OwnDocumentsPort } from "@capital-q/q-tools";

/** Canonical services are resolved at read time because Q composition precedes them. */
export function createOwnApprovalReads(
  service: () => Pick<QActionService, "listPendingApprovals" | "getApproval">,
): ApprovalInboxPort {
  return {
    pending: async (actor) =>
      (await service().listPendingApprovals({ actor, limit: 20 })).map(
        (row) => ({
          approvalId: row.approvalId,
          summary: row.summary,
          requestedAt: row.requestedAt,
          expiresAt: row.expiresAt,
        }),
      ),
    read: (actor, approvalId) =>
      service()
        .getApproval({ actor, approvalId: QApprovalIdSchema.parse(approvalId) })
        .catch(() => null),
  };
}

export function createOwnDocumentReads(
  service: () => Pick<ArtifactService, "list" | "read" | "readVersion">,
): OwnDocumentsPort {
  return {
    list: async (actor, limit) =>
      (await service().list(actor, { limit })).items.map((item) => ({
        artifactId: item.artifactId,
        type: item.type,
        status: item.status,
        title: item.title,
        currentVersion: item.currentVersion,
        updatedAt: item.updatedAt,
      })),
    read: async (actor, artifactId, version) => {
      // A missing immutable version must not silently become the latest one.
      const detail = await (
        version === undefined
          ? service().read(actor, artifactId)
          : service().readVersion(actor, artifactId, version)
      ).catch(() => null);
      const current = detail?.current;
      if (
        detail === null ||
        detail.artifact.status !== "READY" ||
        detail.artifact.artifactId !== artifactId ||
        current === undefined ||
        current.artifactId !== artifactId ||
        current.version !== (version ?? detail.artifact.currentVersion)
      )
        return null;
      return {
        title: current.title,
        type: detail.artifact.type,
        version: current.version,
        sections: current.content.sections.map((section) => ({
          heading: section.heading,
          body: section.body,
        })),
        gaps: current.content.gaps,
        ...(current.instruction === undefined
          ? {}
          : { instruction: current.instruction }),
        history: detail.history.map((entry) => ({
          version: entry.version,
          title: entry.title,
          createdAt: entry.createdAt,
        })),
      };
    },
  };
}
