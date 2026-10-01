import { describe, expect, it, vi } from "vitest";

import {
  ADMIN_PERMISSION_NAMES,
  ADMIN_ROLES,
  checkSenderDomain,
  decodeAuditCursor,
  encodeAuditCursor,
  firewallDecisionRow,
  freshAuthenticationOf,
  permissionNeedsStepUp,
  permissionsOf,
  recordingEmailSender,
  roleHolds,
  senderAddressOf,
} from "../src/index.js";

function token(claims: object): string {
  const part = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256" })}.${part(claims)}.c2ln`;
}

describe("ADMIN_PERMISSIONS v1 (least privilege)", () => {
  it("gives the read-only analyst no write and no personal data", () => {
    const analyst = permissionsOf("analyst");
    expect(analyst.filter((p) => permissionNeedsStepUp(p))).toEqual([]);
    expect(analyst).not.toContain("accounts.read");
    expect(analyst).not.toContain("q.trace.read");
    expect(analyst).toContain("q.monitor.read");
  });

  it("lets support read accounts and verification but decide nothing sensitive", () => {
    expect(roleHolds("support", "accounts.read")).toBe(true);
    expect(roleHolds("support", "verification.decide")).toBe(false);
    expect(roleHolds("support", "accounts.suspend")).toBe(false);
    expect(roleHolds("support", "breakglass.request")).toBe(false);
  });

  it("keeps team management with the platform owner alone", () => {
    for (const role of ADMIN_ROLES) {
      expect(roleHolds(role, "roles.manage")).toBe(role === "platform_owner");
    }
  });

  it("requires a step-up for every write and for no read", () => {
    for (const permission of ADMIN_PERMISSION_NAMES) {
      const write = !permission.endsWith(".read");
      expect(permissionNeedsStepUp(permission)).toBe(write);
    }
  });

  it("gives the owner every permission", () => {
    expect(permissionsOf("platform_owner")).toEqual(ADMIN_PERMISSION_NAMES);
  });
});

describe("freshAuthenticationOf", () => {
  it("reads the newest password/otp/totp authentication", () => {
    const value = token({
      amr: [
        { method: "password", timestamp: 100 },
        { method: "totp", timestamp: 250 },
        { method: "oauth", timestamp: 900 },
      ],
    });
    expect(freshAuthenticationOf(value)).toEqual({ method: "totp", at: 250 });
  });

  it("is null without a qualifying method or a readable payload", () => {
    expect(
      freshAuthenticationOf(
        token({ amr: [{ method: "oauth", timestamp: 1 }] }),
      ),
    ).toBeNull();
    expect(freshAuthenticationOf("not-a-token")).toBeNull();
    expect(freshAuthenticationOf("a.%%%.c")).toBeNull();
  });
});

describe("audit cursor", () => {
  it("round-trips and refuses tampering", () => {
    const cursor = encodeAuditCursor(
      "2026-10-01T10:00:00.123456Z",
      `p${"1".padStart(20, "0")}`,
    );
    expect(decodeAuditCursor(cursor)).toEqual({
      at: "2026-10-01T10:00:00.123456Z",
      key: `p${"1".padStart(20, "0")}`,
    });
    expect(
      decodeAuditCursor(Buffer.from("x|y").toString("base64url")),
    ).toBeNull();
    expect(decodeAuditCursor(undefined)).toBeNull();
  });
});

describe("firewallDecisionRow", () => {
  const request = {
    actor: {
      tenantId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
    },
    runId: "33333333-3333-4333-8333-333333333333",
    correlationId: "cor_x",
    capability: "ANSWER",
  };

  it("keeps codes only: allowed kinds and denied kinds with reasons", () => {
    const row = firewallDecisionRow(request, {
      outcome: "AUTHORISED",
      plan: {
        scopes: [
          { kind: "OWN_COMPANY" },
          { kind: "OWN_COMPANY" },
          { kind: "PUBLIC" },
        ],
        denied: [{ kind: "FOUNDER_PRIVATE", reason: "SCOPE_NOT_PERMITTED" }],
      },
    });
    expect(row.allowed).toEqual(["OWN_COMPANY", "PUBLIC"]);
    expect(row.denied).toEqual([
      { label: "FOUNDER_PRIVATE", reason: "SCOPE_NOT_PERMITTED" },
    ]);
    expect(row.reason).toBeNull();
  });

  it("records a denial's reason and drops malformed ids", () => {
    const row = firewallDecisionRow(
      { ...request, runId: "not-a-uuid" },
      { outcome: "DENIED", reason: "NO_AUTHORISED_CONTEXT", denied: [] },
    );
    expect(row.reason).toBe("NO_AUTHORISED_CONTEXT");
    expect(row.runId).toBeNull();
  });
});

describe("email deliverability", () => {
  it("reads the address from a named sender", () => {
    expect(senderAddressOf("Capital Q <Q@CapitalQ.ai>")).toBe("q@capitalq.ai");
    expect(senderAddressOf("nonsense")).toBeNull();
    expect(senderAddressOf(null)).toBeNull();
  });

  it("checks SPF, DKIM and DMARC from DNS", async () => {
    const records: Record<string, string[][]> = {
      "capitalq.ai": [["v=spf1 include:spf.brevo.com ~all"]],
      "brevo1._domainkey.capitalq.ai": [["k=rsa; p=MIGf"]],
      "_dmarc.capitalq.ai": [["v=DMARC1; p=none"]],
    };
    const resolver = (name: string) => {
      const found = records[name];
      if (found === undefined) {
        return Promise.reject(
          Object.assign(new Error("nx"), { code: "ENOTFOUND" }),
        );
      }
      return Promise.resolve(found);
    };
    const checks = await checkSenderDomain("capitalq.ai", resolver);
    expect(checks.map((c) => [c.name, c.status])).toEqual([
      ["SPF", "PASS"],
      ["DKIM", "PASS"],
      ["DMARC", "WEAK"],
    ]);
  });

  it("logs outcomes without the address and rethrows the send's own error", async () => {
    const inserted: unknown[][] = [];
    const sql = ((_strings: TemplateStringsArray, ...values: unknown[]) => {
      inserted.push(values);
      return Promise.resolve([]);
    }) as never;
    const failure = Object.assign(new Error("refused"), { code: "EAPI" });
    const send = vi
      .fn<(message: { to: string }) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(failure);
    const sender = recordingEmailSender(
      { available: true, send },
      { sql, source: "workers.reminders", provider: "BREVO_API" },
    );
    await sender.send({ to: "Person@Example.com" });
    await expect(sender.send({ to: "x@example.org" })).rejects.toBe(failure);
    expect(inserted[0]?.slice(0, 5)).toEqual([
      "workers.reminders",
      "BREVO_API",
      "SENT",
      null,
      "example.com",
    ]);
    expect(String(inserted[0]?.[5])).toMatch(/^[0-9a-f]{64}$/);
    expect(inserted[1]?.slice(2, 4)).toEqual(["FAILED", "EAPI"]);
    expect(JSON.stringify(inserted)).not.toContain("Person@");
  });
});
