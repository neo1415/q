import { describe, expect, it } from "vitest";

import {
  MaterialActionAuditInputSchema,
  type MaterialActionAuditInput,
} from "@capital-q/audit";
import type { TransactionContext } from "@capital-q/database";
import {
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@capital-q/security";

import { createChatSafetyAudit } from "../src/chat-safety-audit.js";

/** Block, unblock and report are audited as material actions (AUDIT). */
describe("chat safety audit", () => {
  it("records a valid material action, in the caller's transaction, without words", async () => {
    const recorded: { tx: TransactionContext; input: MaterialActionAuditInput }[] = [];
    const tx = { sql: undefined as never } satisfies TransactionContext;
    const audit = createChatSafetyAudit({
      record: (t, input) => {
        recorded.push({ tx: t, input: MaterialActionAuditInputSchema.parse(input) });
        return Promise.resolve(input.auditEventId);
      },
    });
    await audit(tx, {
      actor: {
        userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000001"),
        tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001"),
        organisationId: OrganisationIdSchema.parse("d0000000-0000-4000-8000-000000000001"),
        membershipId: MembershipIdSchema.parse("e0000000-0000-4000-8000-000000000001"),
        actorType: "HUMAN",
      },
      actionType: "chat.reported",
      resourceType: "chat_report",
      resourceId: "00000000-0000-4000-8000-00000000e001",
      relationshipId: "00000000-0000-4000-8000-00000000c001",
      metadata: { side: "COMPANY", reasonCode: "SPAM", namesMessage: false },
    });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.tx).toBe(tx);
    expect(recorded[0]?.input).toMatchObject({
      actorType: "HUMAN",
      actorId: "b0000000-0000-4000-8000-000000000001",
      organisationId: "d0000000-0000-4000-8000-000000000001",
      actionType: "chat.reported",
      resourceType: "chat_report",
      relationshipId: "00000000-0000-4000-8000-00000000c001",
      outcome: "SUCCEEDED",
      metadata: { side: "COMPANY", reasonCode: "SPAM", namesMessage: false },
    });
  });
});
