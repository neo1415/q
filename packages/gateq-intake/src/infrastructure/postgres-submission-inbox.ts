import type { DatabaseExecutor } from "@capital-q/database";

/**
 * A gateway's submitted applications, for the investor organisation that
 * owns it (founder direction 2026-09-29: GateQ in the wild needs an inbox).
 * Read only after the caller has been authorised for the gateway by GateQ's
 * own policy read; the tenant is the gateway's, never input.
 */
export type SubmittedApplication = {
  readonly applicationId: string;
  readonly submittedAt: string;
  /** The submission's frozen snapshot of the application, as submitted. */
  readonly snapshot: unknown;
  /** The qualification recorded at submission. */
  readonly qualification: unknown;
};

export function createPostgresSubmissionInbox(options: {
  readonly sql: DatabaseExecutor;
}) {
  const { sql } = options;
  return {
    list: async (input: {
      readonly tenantId: string;
      readonly gatewayId: string;
      readonly limit?: number | undefined;
    }): Promise<readonly SubmittedApplication[]> => {
      const rows = await sql<
        {
          application_id: string;
          submitted_at: Date;
          snapshot: unknown;
          qualification: unknown;
        }[]
      >`
        select s.application_id, s.submitted_at, s.snapshot, s.qualification
          from gateq.application_submissions s
          join gateq.applications a on a.id = s.application_id
         where a.gateway_id = ${input.gatewayId}
           and s.tenant_id = ${input.tenantId}
         order by s.submitted_at desc
         limit ${Math.min(input.limit ?? 50, 100)}`;
      return rows.map((row) => ({
        applicationId: row.application_id,
        submittedAt: new Date(row.submitted_at).toISOString(),
        snapshot: row.snapshot,
        qualification: row.qualification,
      }));
    },
  };
}

export type SubmissionInbox = ReturnType<typeof createPostgresSubmissionInbox>;
