import { networkRelationshipAuditExportPath } from "@capital-q/contracts";

import { passThrough } from "@/features/relationships/deal-download";

/** The relationship's audit trail as CSV, as this side may read it. */
export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ readonly relationshipId: string }> },
): Promise<Response> {
  const { relationshipId } = await params;
  return passThrough(
    ([relationship = ""]) => networkRelationshipAuditExportPath(relationship),
    [relationshipId],
    "capital-q-relationship-audit.csv",
  );
}
