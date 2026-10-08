import type { FastifyInstance } from "fastify";

import {
  DealViewDtoSchema,
  NETWORK_RELATIONSHIP_AUDIT_EXPORT_PATH,
  NETWORK_RELATIONSHIP_DEAL_PATH,
  NETWORK_RELATIONSHIP_REPORT_PDF_PATH,
  RelationshipReportDtoSchema,
  UuidSchema,
  type RelationshipReportDto,
} from "@capital-q/contracts";
import { documentToPdf, type ArtifactDocument } from "@capital-q/deck-render";
import { reportDate, type DealCloseService } from "@capital-q/network";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * Deal close reads (2026-10-08): the stage strip and what is next, a
 * report as a PDF, and the relationship's audit trail as CSV. Writes are
 * declared app actions (terms, signed, close, reports, checklist).
 *
 * Ids are input; Network decides whether the caller is a party and which
 * reports their side may read, so anything not theirs is the same 404 as
 * nothing at all. Every answer is no-store: these are private records.
 */

export type DealCloseRoutesDependencies = ActorContextDependencies & {
  readonly deal: Pick<DealCloseService, "view" | "report" | "auditTrail">;
};

const idOf = (params: unknown, key: string): string | null => {
  const value = (params as Record<string, unknown> | undefined)?.[key];
  const parsed = UuidSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

/** A stored report as a printable document: the same sections, in order. */
export function reportDocument(
  report: RelationshipReportDto,
): ArtifactDocument {
  const content = report.content;
  return {
    kind: report.title.split(":")[0] ?? "Report",
    title: content.title,
    summary: content.subtitle,
    dateline: `Version ${String(report.version)} · ${reportDate(report.createdAt)} · sha256 ${report.contentSha256.slice(0, 16)}`,
    sections: content.sections.map((section) => ({
      heading: section.heading,
      body: section.body,
      findings: section.rows.map((row) => ({
        statement: `${row.label}: ${row.value}`,
        provenance: row.source,
      })),
    })),
    gaps: content.gaps,
    notice: content.notice,
  };
}

/** RFC 4180: quote every field, double the quotes; neutralise formulas. */
export function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function registerDealCloseRoutes(
  app: FastifyInstance,
  dependencies: DealCloseRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const { deal } = dependencies;

  app.get(
    NETWORK_RELATIONSHIP_DEAL_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const relationshipId = idOf(request.params, "relationshipId");
      if (relationshipId === null) return reply.callNotFound();
      const view = await deal.view(getActorContext(request), relationshipId);
      if (view === null) return reply.callNotFound();
      void reply.header("Cache-Control", "no-store");
      return DealViewDtoSchema.parse(view);
    },
  );

  app.get(
    NETWORK_RELATIONSHIP_REPORT_PDF_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const relationshipId = idOf(request.params, "relationshipId");
      const reportId = idOf(request.params, "reportId");
      if (relationshipId === null || reportId === null) {
        return reply.callNotFound();
      }
      const report = await deal.report({
        actor: getActorContext(request),
        relationshipId,
        reportId,
      });
      if (report === null) return reply.callNotFound();
      const parsed = RelationshipReportDtoSchema.parse(report);
      const pdf = await documentToPdf(reportDocument(parsed), {
        title: parsed.content.title,
      });
      const name = `capital-q-${parsed.kind.toLowerCase().replaceAll("_", "-")}-v${String(parsed.version)}.pdf`;
      return reply
        .header("Cache-Control", "no-store")
        .header("Content-Disposition", `attachment; filename="${name}"`)
        .type("application/pdf")
        .send(Buffer.from(pdf));
    },
  );

  app.get(
    NETWORK_RELATIONSHIP_AUDIT_EXPORT_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const relationshipId = idOf(request.params, "relationshipId");
      if (relationshipId === null) return reply.callNotFound();
      const rows = await deal.auditTrail({
        actor: getActorContext(request),
        relationshipId,
      });
      if (rows === null) return reply.callNotFound();
      const csv = [
        ["at_utc", "kind", "what", "who", "reference"].map(csvField).join(","),
        ...rows.map((row) =>
          [row.at, row.kind, row.what, row.who ?? "", row.reference]
            .map(csvField)
            .join(","),
        ),
      ].join("\r\n");
      return reply
        .header("Cache-Control", "no-store")
        .header(
          "Content-Disposition",
          `attachment; filename="capital-q-relationship-audit-${relationshipId.slice(0, 8)}.csv"`,
        )
        .type("text/csv; charset=utf-8")
        .send(`${csv}\r\n`);
    },
  );
}
