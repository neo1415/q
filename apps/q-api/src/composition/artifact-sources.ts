import type { DataRoomView } from "@capital-q/contracts";
import type { ArtifactSourceRef } from "@capital-q/q-artifacts";
import type { ActorContext } from "@capital-q/security";

/**
 * SEC-01: may this person still open every document an artifact was
 * composed from? Asked by the artifact service on every read of an
 * artifact with recorded sources (read, version, summary, list, export,
 * revise, edit).
 *
 * No new permission model. A source is a company's Evidence document; the
 * answer is the data room's own view, read AS the person — exactly the
 * check Q's document reads (material-documents.ts) make before handing a
 * document's text on: OPEN to them (a listed level, or an unrevoked,
 * unexpired grant to their relationship), or the company's own team. A
 * revoked grant, an expired one, a lost connection, an archived document
 * or a room that cannot be read all answer false. Nothing here is cached
 * across calls: revocation takes effect on the next read.
 *
 * Every document is resolved to its company through Evidence's own active
 * document lookup; a document that is gone, or belongs to no company,
 * closes the artifact.
 */
export function createArtifactSourceEntitlement(dependencies: {
  /** Evidence: one ACTIVE document's owning company, or null. */
  readonly documentCompany: (
    documentId: string,
  ) => Promise<{ readonly companyId: string | null } | null>;
  /** The data room's own view as this person, or null (not theirs to see). */
  readonly dataRoomView: (
    actor: ActorContext,
    companyId: string,
  ) => Promise<DataRoomView | null>;
}): (
  actor: ActorContext,
  sources: readonly ArtifactSourceRef[],
) => Promise<boolean> {
  return async (actor, sources) => {
    const ids = [...new Set(sources.map((source) => source.id.toLowerCase()))];
    if (ids.length === 0) return true;
    // Which company holds each document: every one must resolve.
    const byCompany = new Map<string, string[]>();
    for (const id of ids) {
      const document = await dependencies.documentCompany(id);
      if (document === null || document.companyId === null) return false;
      const companyId = document.companyId.toLowerCase();
      byCompany.set(companyId, [...(byCompany.get(companyId) ?? []), id]);
    }
    for (const [companyId, documentIds] of byCompany) {
      const room = await dependencies.dataRoomView(actor, companyId);
      if (room === null) return false;
      const open = new Set(
        room.viewer === "OWNER"
          ? room.documents.map((d) => d.documentId.toLowerCase())
          : room.documents
              .filter((d) => d.access === "OPEN")
              .map((d) => d.documentId.toLowerCase()),
      );
      if (!documentIds.every((id) => open.has(id))) return false;
    }
    return true;
  };
}
