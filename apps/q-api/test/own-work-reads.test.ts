import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ActorContextSchema } from "@capital-q/security";
import {
  QArtifactDetailSchema,
  QApprovalViewSchema,
} from "@capital-q/contracts";
import {
  createOwnApprovalReads,
  createOwnDocumentReads,
} from "../src/composition/own-work-reads.js";

const actor = ActorContextSchema.parse({
  userId: randomUUID(),
  tenantId: randomUUID(),
  organisationId: randomUUID(),
  membershipId: randomUUID(),
  actorType: "HUMAN",
});
const other = ActorContextSchema.parse({
  ...actor,
  userId: randomUUID(),
  tenantId: randomUUID(),
});
const artifactId = randomUUID();
const at = "2026-10-12T00:00:00Z";
const original = QArtifactDetailSchema.parse({
  artifact: {
    artifactId,
    type: "MEMO",
    status: "READY",
    title: "Investment memo",
    currentVersion: 2,
    createdAt: at,
    updatedAt: at,
  },
  current: {
    artifactId,
    version: 1,
    title: "Investment memo",
    summary: "Initial memo",
    content: {
      sections: [{ heading: "Evidence", body: "An attributed statement." }],
    },
    createdAt: at,
  },
  history: [
    { version: 1, title: "Investment memo", createdAt: at },
    {
      version: 2,
      title: "Revised memo",
      instruction: "Second-specialist review: attribute the claim.",
      createdAt: at,
    },
  ],
});
const current = QArtifactDetailSchema.parse({
  ...original,
  current: {
    ...original.current,
    version: 2,
    instruction: "Second-specialist review: attribute the claim.",
  },
});
const approvalId = randomUUID();
const approval = QApprovalViewSchema.parse({
  contractVersion: 1,
  approvalId,
  runId: randomUUID(),
  status: "PENDING",
  requestedAt: at,
  expiresAt: "2026-10-13T00:00:00Z",
  canDecide: true,
  action: {
    actionId: randomUUID(),
    actionType: "app.diligence.questions.send",
    actionVersion: 1,
    actionClass: "CONFIRM_REQUIRED",
    actionStatus: "AWAITING_APPROVAL",
    targets: [{ kind: "COMPANY", companyId: randomUUID() }],
    summary: "Send questions",
    preview: "1. What is the retention cohort?",
  },
});

function docs() {
  const read = vi.fn((who: typeof actor) =>
    who.userId === actor.userId && who.tenantId === actor.tenantId
      ? Promise.resolve(current)
      : Promise.reject(new Error("NOT_FOUND")),
  );
  const readVersion = vi.fn(
    (who: typeof actor, _id: string, version: number) =>
      who.userId === actor.userId &&
      who.tenantId === actor.tenantId &&
      version === 1
        ? Promise.resolve(original)
        : Promise.reject(new Error("NOT_FOUND")),
  );
  return {
    list: vi.fn(() => Promise.resolve({ items: [], nextCursor: null })),
    read,
    readVersion,
  };
}

describe("native document result reads", () => {
  it("reads the exact immutable version without current-version fallback", async () => {
    const service = docs();
    const port = createOwnDocumentReads(() => service);
    expect(await port.read?.(actor, artifactId, 1)).toMatchObject({
      version: 1,
      history: [{ version: 1 }, { version: 2 }],
    });
    expect(service.readVersion).toHaveBeenCalledWith(actor, artifactId, 1);
    expect(service.read).not.toHaveBeenCalled();
    expect(await port.read?.(actor, artifactId, 3)).toBeNull();
    expect(service.read).not.toHaveBeenCalled();
  });
  it("uses the current canonical read by default and retains the review instruction", async () => {
    const service = docs();
    expect(
      await createOwnDocumentReads(() => service).read?.(actor, artifactId),
    ).toMatchObject({
      version: 2,
      instruction: "Second-specialist review: attribute the claim.",
    });
    expect(service.read).toHaveBeenCalledWith(actor, artifactId);
    expect(service.readVersion).not.toHaveBeenCalled();
  });
  it("keeps owner/refused/revoked reads unavailable", async () => {
    const service = docs();
    const port = createOwnDocumentReads(() => service);
    expect(await port.read?.(other, artifactId, 1)).toBeNull();
    expect(
      await port.read?.({ ...actor, tenantId: other.tenantId }, artifactId, 1),
    ).toBeNull();
    service.read.mockRejectedValueOnce(new Error("REVOKED"));
    expect(await port.read?.(actor, artifactId)).toBeNull();
  });
  it("refuses PREPARING and broken persisted-version bindings", async () => {
    const service = docs();
    const port = createOwnDocumentReads(() => service);
    service.read.mockResolvedValueOnce(
      QArtifactDetailSchema.parse({
        ...current,
        artifact: { ...current.artifact, status: "PREPARING" },
      }),
    );
    expect(await port.read?.(actor, artifactId)).toBeNull();
    service.readVersion.mockResolvedValueOnce(current);
    expect(await port.read?.(actor, artifactId, 1)).toBeNull();
  });
});

describe("native approval preview reads", () => {
  it("re-authorises only the requested card and never approves or executes it", async () => {
    const getApproval = vi.fn(() => Promise.resolve(approval));
    const service = {
      getApproval,
      listPendingApprovals: vi.fn(() => Promise.resolve([])),
    };
    const port = createOwnApprovalReads(() => service);
    expect(await port.read?.(actor, approvalId)).toEqual(approval);
    expect(getApproval).toHaveBeenCalledWith({ actor, approvalId });
    expect(service.listPendingApprovals).not.toHaveBeenCalled();
    expect(approval.status).toBe("PENDING");
    expect(approval.action.executedAt).toBeUndefined();
  });
  it("does not expose another owner or revoked access", async () => {
    const getApproval = vi.fn(() => Promise.reject(new Error("NOT_FOUND")));
    const port = createOwnApprovalReads(() => ({
      getApproval,
      listPendingApprovals: () => Promise.resolve([]),
    }));
    expect(await port.read?.(other, approvalId)).toBeNull();
    expect(getApproval).toHaveBeenCalledWith({ actor: other, approvalId });
  });
});
