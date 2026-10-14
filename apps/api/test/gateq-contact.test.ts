import { randomUUID } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import {
  ApplicationSchema,
  ApplicationFactSchema,
} from "@capital-q/gateq-intake";
import { AuthenticatedPrincipalSchema } from "@capital-q/security";
import {
  createGateqContactService,
  type ApplicationContactProof,
} from "../src/composition/gateq-contact.js";

const principal = AuthenticatedPrincipalSchema.parse({
  authUserId: randomUUID(),
});
function setup() {
  const application = ApplicationSchema.parse({
    id: randomUUID(),
    tenantId: randomUUID(),
    gatewayId: randomUUID(),
    gatewayVersionId: randomUUID(),
    publicReference: "ga_" + "0".repeat(26),
    status: "IN_PROGRESS",
    declaredName: "Company",
    submittedAt: null,
    createdAt: "2026-10-13T00:00:00Z",
    updatedAt: "2026-10-13T00:00:00Z",
  });
  const facts = [
    ["contact.name", "Founder Name"],
    ["contact.email", "owner@example.test"],
    ["contact.role", "Founder"],
    ["company.name", "Company"],
  ].map(([dimension, text]) =>
    ApplicationFactSchema.parse({
      id: randomUUID(),
      applicationId: application.id,
      dimension,
      value: { kind: "TEXT", text },
      provenance: "APPLICANT_PROVIDED",
      recordedAt: "2026-10-13T00:00:00Z",
      supersededAt: null,
    }),
  );
  const identity = vi.fn(() =>
    Promise.resolve({ userId: randomUUID(), email: "owner@example.test" }),
  );
  const saved: ApplicationContactProof[] = [];
  const confirm = vi.fn((proof: ApplicationContactProof) => {
    saved.push(proof);
    return Promise.resolve(true);
  });
  const service = createGateqContactService({
    intake: {
      authorise: () => Promise.resolve({ application, sessionId: "session" }),
      factsFor: () => Promise.resolve(facts),
    },
    identity,
    store: { read: () => Promise.resolve(null), confirm },
    now: () => new Date("2026-10-13T00:01:00Z"),
  });
  return { service, application, facts, identity, confirm, saved };
}

describe("GateQ verified contact ownership", () => {
  it("confirms the scoped application's contact against a verified identity and stores no raw email", async () => {
    const h = setup();
    expect(await h.service.confirm("owned-session", principal)).toEqual({
      status: "VERIFIED",
      confirmedAt: "2026-10-13T00:01:00.000Z",
    });
    expect(h.saved[0]?.applicationId).toBe(h.application.id);
    expect(h.saved[0]?.tenantId).toBe(h.application.tenantId);
    expect(h.saved[0]?.emailHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(h.saved)).not.toContain("owner@example.test");
  });
  it("requires name, company, role and usable contact before checking paid-interview identity", async () => {
    const h = setup();
    h.facts.splice(2, 1);
    expect(await h.service.confirm("owned-session", principal)).toEqual({
      status: "CONTACT_INCOMPLETE",
    });
    expect(h.identity).not.toHaveBeenCalled();
    expect(h.confirm).not.toHaveBeenCalled();
  });
  it("refuses a different verified mailbox without rebinding the application", async () => {
    const h = setup();
    h.identity.mockResolvedValue({
      userId: randomUUID(),
      email: "other@example.test",
    });
    expect(await h.service.confirm("owned-session", principal)).toEqual({
      status: "EMAIL_MISMATCH",
    });
    expect(h.confirm).not.toHaveBeenCalled();
  });
  it("cannot transfer an already bound contact identity", async () => {
    const h = setup();
    h.confirm.mockResolvedValue(false);
    expect(await h.service.confirm("owned-session", principal)).toEqual({
      status: "OWNER_MISMATCH",
    });
  });
  it("refuses changes after the founder's immutable submission", async () => {
    const h = setup();
    h.application.status = "SUBMITTED";
    await expect(h.service.confirm("owned-session", principal)).rejects.toThrow(
      "ALREADY_SUBMITTED",
    );
    expect(h.confirm).not.toHaveBeenCalled();
  });
});
