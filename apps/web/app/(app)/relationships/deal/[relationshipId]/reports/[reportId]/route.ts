import { networkRelationshipReportPdfPath } from "@capital-q/contracts";

import { passThrough } from "@/features/relationships/deal-download";

/** A relationship report as a PDF (deal close, 2026-10-08). */
export async function GET(
  _request: Request,
  {
    params,
  }: {
    readonly params: Promise<{
      readonly relationshipId: string;
      readonly reportId: string;
    }>;
  },
): Promise<Response> {
  const { relationshipId, reportId } = await params;
  return passThrough(
    ([relationship = "", report = ""]) =>
      networkRelationshipReportPdfPath(relationship, report),
    [relationshipId, reportId],
    "capital-q-report.pdf",
  );
}
