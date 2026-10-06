import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { CorrelationId } from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  createCompanyClaims,
  createPlatformCompanyPublishing,
} from "../src/index.js";

/**
 * P14: a work-email claim gets a one-time code (only its hash kept, tries
 * bounded), and a platform admin can make only an UNCLAIMED company's
 * profile public_external, audited and published as the same visibility
 * event a founder's change is. The SQL is scripted: each awaited query
 * takes the next answer; fragments that are never awaited take none.
 */

function scriptedSql(answers: unknown[][]) {
  const queries: string[] = [];
  const sql = (strings: TemplateStringsArray, ..._values: unknown[]) => {
    const text = strings.join("?");
    return {
      then: (resolve: (rows: unknown[]) => unknown) => {
        queries.push(text);
        return Promise.resolve(resolve(answers.shift() ?? []));
      },
    };
  };
  return { sql, queries };
}

const hash = (code: string) =>
  createHash("sha256").update(`claim-code:${code}`, "utf8").digest("hex");

describe("a work-email claim code (P14)", () => {
  it("emails a code on request and keeps only its hash", async () => {
    const { sql, queries } = scriptedSql([
      // visible(): the company
      [
        {
          id: "c1",
          tenant_id: "t1",
          organisation_id: "o1",
          canonical_name: "Claim Co",
          website_url: "https://claimco.example",
          headquarters_city: null,
          headquarters_country: null,
          members: 0,
          yours: false,
          requested: false,
        },
      ],
      [{ id: "r1" }], // insert
      [], // store the code hash
    ]);
    const mailed: unknown[] = [];
    const claims = createCompanyClaims({
      sql: sql as never,
      newCode: () => "123456",
      codeMailer: (input) => {
        mailed.push(input);
        return Promise.resolve(true);
      },
    });
    const out = await claims.request(
      { userId: "u1", tenantId: "t9", organisationId: "o9" } as ActorContext,
      "c1",
      {
        method: "WORK_EMAIL",
        workEmail: "amara@claimco.example",
        clientRequestId: "claim-00000001",
      },
    );
    expect(out).toEqual({ status: "REQUESTED", codeSent: true });
    expect(mailed).toEqual([
      {
        to: "amara@claimco.example",
        companyName: "Claim Co",
        code: "123456",
        expiresInMinutes: 30,
      },
    ]);
    expect(queries[2]).toContain("set code_hash");
  });

  it("confirms the right code, counts a wrong one, and refuses after expiry", async () => {
    const wrong = scriptedSql([
      [{ id: "r1", code_hash: hash("123456"), expired: false, attempts: 0 }],
      [],
    ]);
    expect(
      await createCompanyClaims({ sql: wrong.sql as never }).confirmCode(
        { userId: "u1" },
        "c1",
        "000000",
      ),
    ).toEqual({ status: "WRONG_CODE" });
    expect(wrong.queries[1]).toContain("code_attempts = code_attempts + 1");

    const right = scriptedSql([
      [{ id: "r1", code_hash: hash("123456"), expired: false, attempts: 2 }],
      [],
    ]);
    expect(
      await createCompanyClaims({ sql: right.sql as never }).confirmCode(
        { userId: "u1" },
        "c1",
        "123456",
      ),
    ).toEqual({ status: "CONFIRMED" });
    expect(right.queries[1]).toContain("email_confirmed_at = now()");

    const expired = scriptedSql([
      [{ id: "r1", code_hash: hash("123456"), expired: true, attempts: 0 }],
    ]);
    expect(
      await createCompanyClaims({ sql: expired.sql as never }).confirmCode(
        { userId: "u1" },
        "c1",
        "123456",
      ),
    ).toEqual({ status: "EXPIRED" });
  });
});

describe("publishing an unclaimed company (P14 item 7)", () => {
  const actor = {
    userId: "00000000-0000-4000-8000-0000000000b1",
    tenantId: "00000000-0000-4000-8000-0000000000a1",
    organisationId: "00000000-0000-4000-8000-0000000000a2",
    actorType: "HUMAN",
  } as ActorContext;
  const correlationId =
    "cor_00000000-0000-4000-8000-00000000c0de" as CorrelationId;
  const company = {
    id: "00000000-0000-4000-8000-0000000000c1",
    tenant_id: "00000000-0000-4000-8000-0000000000a9",
    organisation_id: "00000000-0000-4000-8000-0000000000a8",
    marketplace_visibility: "network_visible",
    version: 4,
  };

  function publisher(answers: unknown[][]) {
    const { sql, queries } = scriptedSql(answers);
    const audits: unknown[] = [];
    const events: { type: string; data: unknown }[] = [];
    const publish = createPlatformCompanyPublishing({
      transactions: { run: (work) => work({ sql } as never) },
      audit: {
        record: (_tx: unknown, record: unknown) => {
          audits.push(record);
          return Promise.resolve();
        },
      } as never,
      outbox: {
        enqueue: (_tx: unknown, event: { type: string; data: unknown }) => {
          events.push(event);
          return Promise.resolve();
        },
      } as never,
    });
    return { publish, queries, audits, events };
  }

  it("never overrides a company someone holds", async () => {
    const { publish, queries, events } = publisher([
      [{ ...company, claimed: true }],
    ]);
    expect(
      await publish({
        actor,
        companyId: company.id,
        publicExternal: true,
        reason: "Public profile",
        correlationId,
      }),
    ).toBe("CLAIMED");
    expect(queries).toHaveLength(1);
    expect(events).toEqual([]);
  });

  it("makes an unclaimed company public_external, audited, with the visibility event", async () => {
    const { publish, audits, events } = publisher([
      [{ ...company, claimed: false }],
      [{ version: 5 }],
    ]);
    expect(
      await publish({
        actor,
        companyId: company.id,
        publicExternal: true,
        reason: "Public profile",
        correlationId,
      }),
    ).toBe("CHANGED");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      metadata: {
        previousVisibility: "network_visible",
        visibility: "public_external",
        via: "PLATFORM_ADMIN",
      },
    });
    expect(events[0]?.data).toMatchObject({
      companyId: company.id,
      visibility: "public_external",
      version: 5,
    });
  });
});
