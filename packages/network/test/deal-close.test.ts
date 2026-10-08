import { describe, expect, it } from "vitest";

import type { MaterialActionAuditWriter } from "@capital-q/audit";
import type {
  DatabaseExecutor,
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import type { ActorContext } from "@capital-q/security";

import {
  createDealCloseService,
  type RelationshipEventAppender,
  type RelationshipPartyView,
} from "../src/index.js";

/**
 * Deal close service (2026-10-08): the order of the steps (invalid moves
 * refused), approval binding to the exact terms version, idempotency,
 * history + audit + outbox in one transaction, and report visibility
 * decided before compilation. RLS and append-only are pgTAP 890.
 */

const RELATIONSHIP = "00000000-0000-4000-8000-000000000201";
const COMPANY = "00000000-0000-4000-8000-0000000002c1";
const INVESTOR_ORG = "00000000-0000-4000-8000-0000000002e1";
const COMMITMENT = "00000000-0000-4000-8000-0000000002d1";
const DOC = "00000000-0000-4000-8000-0000000002f1";
const OTHER_DOC = "00000000-0000-4000-8000-0000000002f2";

const actor = (userId: string, tenant: string): ActorContext => ({
  userId: userId as ActorContext["userId"],
  tenantId: tenant as ActorContext["tenantId"],
  organisationId: tenant as ActorContext["organisationId"],
  actorType: "HUMAN",
});
const investor = actor(
  "00000000-0000-4000-8000-0000000002b1",
  "00000000-0000-4000-8000-0000000002b0",
);
const founder = actor(
  "00000000-0000-4000-8000-0000000002a1",
  "00000000-0000-4000-8000-0000000002a0",
);
const stranger = actor(
  "00000000-0000-4000-8000-0000000002c9",
  "00000000-0000-4000-8000-0000000002c0",
);

type Ev = {
  sequence: number;
  event_type: string;
  occurred_at: Date;
  visibility_scope: string;
  payload: Record<string, unknown>;
  actor_id: string;
  actor_name: string | null;
};

function world() {
  let clock = Date.parse("2026-10-01T09:00:00.000Z");
  const tick = () => new Date((clock += 60_000));
  const events: Ev[] = [];
  const terms: Record<string, unknown>[] = [];
  const closes: Record<string, unknown>[] = [];
  const reports: Record<string, unknown>[] = [];
  const audits: unknown[] = [];
  const announced: { outcome: string }[] = [];
  let ids = 0;
  const id = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;

  const add = (
    eventType: string,
    payload: Record<string, unknown>,
    scope = "relationship_shared",
    name: string | null = "Ada Obi",
  ) =>
    events.push({
      sequence: events.length + 1,
      event_type: eventType,
      occurred_at: tick(),
      visibility_scope: scope,
      payload,
      actor_id: investor.userId,
      actor_name: name,
    });

  const fake = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    const result = (rows: unknown[]) => Promise.resolve(rows);
    if (text.includes("for update")) return result([]);
    if (text.includes("from network.relationship_events e"))
      return result([...events]);
    if (
      text.includes("select id from network.deal_terms") &&
      text.includes("recorded_by_user_id")
    ) {
      return result(
        terms.filter(
          (t) =>
            t["recorded_by_user_id"] === values[0] &&
            t["idempotency_key"] === values[1],
        ),
      );
    }
    if (text.includes("from network.deal_terms t")) {
      return result(
        [...terms]
          .reverse()
          .map((t) => ({
            ...t,
            recorded_by: "Ada Obi",
            signed_by: t["signed_at"] === null ? null : "Femi Ade",
          })),
      );
    }
    if (text.includes("select id, version from network.deal_terms"))
      return result([...terms].reverse());
    if (text.includes("set status = 'SUPERSEDED'")) {
      for (const t of terms)
        if (t["status"] === "RECORDED") t["status"] = "SUPERSEDED";
      return result([]);
    }
    if (text.includes("insert into network.deal_terms")) {
      const row = {
        id: id(),
        version: values[2],
        instrument: values[3],
        amount: values[4],
        currency_code: values[5],
        valuation_cap: values[6],
        valuation_basis: values[7],
        pre_money_valuation: values[8],
        discount_percent: values[9],
        pro_rata: values[10],
        other_terms: values[11],
        terms_document_id: values[12],
        recorded_by_side: values[13],
        recorded_by_user_id: values[14],
        idempotency_key: values[15],
        status: "RECORDED",
        created_at: tick(),
        signed_document_id: null,
        signed_at: null,
      };
      terms.push(row);
      return result([{ id: row.id }]);
    }
    if (
      text.includes(
        "select id, status, signed_document_id from network.deal_terms",
      )
    ) {
      return result(terms.filter((t) => t["status"] !== "SUPERSEDED"));
    }
    if (text.includes("set status = 'SIGNED'")) {
      const row = terms.find((t) => t["id"] === values[2]);
      if (row !== undefined)
        Object.assign(row, {
          status: "SIGNED",
          signed_document_id: values[0],
          signed_at: tick(),
        });
      return result([]);
    }
    if (text.includes("select id from network.deal_closes"))
      return result(closes);
    if (text.includes("insert into network.deal_closes")) {
      const row = {
        id: id(),
        closed_on: "2026-10-09",
        closed_by_side: values[4],
        note: values[7],
      };
      closes.push(row);
      return result([{ id: row.id }]);
    }
    if (text.includes("from network.deal_closes d"))
      return result(closes.map((c) => ({ ...c, closed_by: "Femi Ade" })));
    if (text.includes("from network.deal_close_checklist")) return result([]);
    if (text.includes("insert into network.deal_close_checklist"))
      return result([{ item_code: values[3] }]);
    if (text.includes("from network.relationship_reports p")) {
      // The SQL's own visibility filter, as Postgres would apply it.
      const [, , ownPrivate, side] = values;
      return result(
        reports
          .filter(
            (r) =>
              r["visibility_scope"] === "relationship_shared" ||
              (r["visibility_scope"] === ownPrivate &&
                r["owner_side"] === side),
          )
          .map((r) => ({ ...r, generated_by: "Ada Obi" })),
      );
    }
    if (text.includes("select id from network.relationship_reports")) {
      return result(
        reports.filter(
          (r) =>
            r["generated_by_user_id"] === values[0] &&
            r["idempotency_key"] === values[1],
        ),
      );
    }
    if (text.includes("select version from network.relationship_reports")) {
      return result(
        reports
          .filter(
            (r) => r["kind"] === values[1] && r["owner_side"] === values[2],
          )
          .reverse(),
      );
    }
    if (text.includes("insert into network.relationship_reports")) {
      const row = {
        id: id(),
        tenant_id: values[0],
        kind: values[2],
        owner_side: values[3],
        visibility_scope: values[4],
        version: values[5],
        title: values[6],
        content: JSON.parse(String(values[7])),
        content_sha256: values[8],
        generated_by_user_id: values[11],
        idempotency_key: values[12],
        created_at: tick(),
      };
      reports.push(row);
      return result([{ id: row.id }]);
    }
    if (text.includes("select content from network.relationship_reports")) {
      return result(reports.filter((r) => r["id"] === values[0]));
    }
    if (
      text.includes("from network.diligence_requests") ||
      text.includes("from network.diligence_questions")
    )
      return result([]);
    if (text.includes("from network.commitments c")) return result([]);
    if (text.includes("from audit.material_actions")) return result([]);
    return Promise.reject(new Error(`unexpected query: ${text}`));
  };
  Object.assign(fake, { unsafe: (fragment: string) => fragment });
  const sql = fake as unknown as DatabaseExecutor;
  let queue: Promise<unknown> = Promise.resolve();
  const transactions: TransactionManager = {
    run: (work) => {
      const next = queue.then(() =>
        work({ sql: fake as unknown as TransactionContext["sql"] }),
      );
      queue = next.catch(() => undefined);
      return next;
    },
  };
  const appender: RelationshipEventAppender = {
    append: (_tx, input) => {
      add(
        input.eventType,
        input.payload as Record<string, unknown>,
        input.visibilityScope,
      );
      return Promise.resolve(
        {} as Awaited<ReturnType<RelationshipEventAppender["append"]>>,
      );
    },
  };
  const outbox: OutboxWriter = {
    enqueue: (_tx, event) => {
      announced.push(event.data as { outcome: string });
      return Promise.resolve({ status: "ENQUEUED" as const });
    },
  } as OutboxWriter;
  const audit: MaterialActionAuditWriter = {
    record: (_tx, input) => {
      audits.push(input);
      return Promise.resolve(input.auditEventId);
    },
  };
  const view = (side: "INVESTOR" | "COMPANY"): RelationshipPartyView =>
    ({
      side,
      counterpart:
        side === "INVESTOR"
          ? { kind: "COMPANY", id: COMPANY }
          : { kind: "INVESTOR_ORGANISATION", id: INVESTOR_ORG },
      status: {
        relationship: {
          id: RELATIONSHIP,
          tenantId: founder.tenantId,
          companyId: COMPANY,
          investorOrganisationId: INVESTOR_ORG,
        },
        projection: { state: "MEETING_HELD" },
      },
    }) as unknown as RelationshipPartyView;
  const service = createDealCloseService({
    sql,
    transactions,
    interests: {
      relationshipById: ({ actor: who }) =>
        Promise.resolve(
          who === investor
            ? view("INVESTOR")
            : who === founder
              ? view("COMPANY")
              : null,
        ),
    },
    appender,
    outbox,
    audit,
    names: () =>
      Promise.resolve({
        company: "Tensorgate",
        investor: "Northwind Ventures",
      }),
    newCorrelationId: () => "cor_00000000-0000-4000-8000-000000000001" as never,
    now: () => new Date("2026-10-10T12:00:00.000Z"),
  });
  return { service, events, terms, closes, reports, audits, announced, add };
}

const SAFE = {
  instrument: "SAFE",
  amount: "250000",
  currencyCode: "USD",
  valuationCap: "8000000",
  valuationBasis: "POST_MONEY",
} as const;

function afterSoftCommit() {
  const w = world();
  w.add("meeting_held", {});
  w.add("document_shared", { documentId: DOC, disclosurePolicyId: DOC });
  w.add("commitment_confirmed", { commitmentId: COMMITMENT, level: "SOFT" });
  return w;
}

describe("deal close: steps in order", () => {
  it("refuses terms before a soft commit", async () => {
    const w = world();
    w.add("meeting_held", {});
    const out = await w.service.recordTerms({
      actor: investor,
      relationshipId: RELATIONSHIP,
      terms: SAFE,
      idempotencyKey: "terms-key-0001",
    });
    expect(out).toEqual({ outcome: "REFUSED", code: "NOT_IN_STAGE" });
    expect(w.events.map((e) => e.event_type)).toEqual(["meeting_held"]);
    expect(w.audits).toHaveLength(0);
  });

  it("records terms as one unit: row, shared event, audit and outbox; a replay records nothing", async () => {
    const w = afterSoftCommit();
    const first = await w.service.recordTerms({
      actor: investor,
      relationshipId: RELATIONSHIP,
      terms: SAFE,
      idempotencyKey: "terms-key-0001",
    });
    expect(first).toEqual({
      outcome: "OK",
      relationshipId: RELATIONSHIP,
      deduplicated: false,
    });
    const replay = await w.service.recordTerms({
      actor: investor,
      relationshipId: RELATIONSHIP,
      terms: SAFE,
      idempotencyKey: "terms-key-0001",
    });
    expect(replay).toEqual({
      outcome: "OK",
      relationshipId: RELATIONSHIP,
      deduplicated: true,
    });
    expect(w.terms).toHaveLength(1);
    const recorded = w.events.filter(
      (e) => e.event_type === "deal_terms_recorded",
    );
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.visibility_scope).toBe("relationship_shared");
    expect(recorded[0]?.payload).toEqual({
      termsId: w.terms[0]?.["id"],
      version: 1,
      side: "INVESTOR",
    });
    expect(w.audits).toHaveLength(1);
    expect(w.audits[0]).toMatchObject({
      actionType: "relationship.deal_terms_recorded",
      relationshipId: RELATIONSHIP,
      actorId: investor.userId,
    });
    expect(w.announced.map((a) => a.outcome)).toEqual(["TERMS_RECORDED"]);
    // Money is exact: the decimal string reaches the database as written.
    expect(w.terms[0]?.["amount"]).toBe("250000");
  });

  it("a revision supersedes the previous version instead of editing it", async () => {
    const w = afterSoftCommit();
    await w.service.recordTerms({
      actor: investor,
      relationshipId: RELATIONSHIP,
      terms: SAFE,
      idempotencyKey: "terms-key-0001",
    });
    await w.service.recordTerms({
      actor: founder,
      relationshipId: RELATIONSHIP,
      terms: { ...SAFE, valuationCap: "9000000" },
      idempotencyKey: "terms-key-0002",
    });
    expect(w.terms.map((t) => [t["version"], t["status"]])).toEqual([
      [1, "SUPERSEDED"],
      [2, "RECORDED"],
    ]);
  });

  it("refuses a terms document that was never shared with this relationship", async () => {
    const w = afterSoftCommit();
    const out = await w.service.recordTerms({
      actor: investor,
      relationshipId: RELATIONSHIP,
      terms: { ...SAFE, termsDocumentId: OTHER_DOC },
      idempotencyKey: "terms-key-0003",
    });
    expect(out).toEqual({ outcome: "REFUSED", code: "DOCUMENT_NOT_SHARED" });
  });

  it("binds a signature to the exact terms version approved: a revision since refuses it", async () => {
    const w = afterSoftCommit();
    await w.service.recordTerms({
      actor: investor,
      relationshipId: RELATIONSHIP,
      terms: SAFE,
      idempotencyKey: "terms-key-0001",
    });
    const approved = String(w.terms[0]?.["id"]);
    await w.service.recordTerms({
      actor: founder,
      relationshipId: RELATIONSHIP,
      terms: { ...SAFE, amount: "300000" },
      idempotencyKey: "terms-key-0002",
    });
    const stale = await w.service.markSigned({
      actor: founder,
      relationshipId: RELATIONSHIP,
      termsId: approved,
      signedDocumentId: DOC,
      idempotencyKey: "sign-key-0001",
    });
    expect(stale).toEqual({ outcome: "REFUSED", code: "TERMS_CHANGED" });
    const current = String(w.terms[1]?.["id"]);
    const signed = await w.service.markSigned({
      actor: founder,
      relationshipId: RELATIONSHIP,
      termsId: current,
      signedDocumentId: DOC,
      idempotencyKey: "sign-key-0002",
    });
    expect(signed.outcome).toBe("OK");
    const again = await w.service.markSigned({
      actor: founder,
      relationshipId: RELATIONSHIP,
      termsId: current,
      signedDocumentId: DOC,
      idempotencyKey: "sign-key-0003",
    });
    expect(again).toEqual({
      outcome: "OK",
      relationshipId: RELATIONSHIP,
      deduplicated: true,
    });
    expect(
      w.events.filter((e) => e.event_type === "deal_terms_signed"),
    ).toHaveLength(1);
  });

  it("closes only with signed terms and received money, once", async () => {
    const w = afterSoftCommit();
    await w.service.recordTerms({
      actor: investor,
      relationshipId: RELATIONSHIP,
      terms: SAFE,
      idempotencyKey: "terms-key-0001",
    });
    await w.service.markSigned({
      actor: founder,
      relationshipId: RELATIONSHIP,
      termsId: String(w.terms[0]?.["id"]),
      signedDocumentId: DOC,
      idempotencyKey: "sign-key-0001",
    });
    expect(
      await w.service.close({
        actor: founder,
        relationshipId: RELATIONSHIP,
        idempotencyKey: "close-key-0001",
      }),
    ).toEqual({ outcome: "REFUSED", code: "NOT_IN_STAGE" });
    w.add("commitment_received", { commitmentId: COMMITMENT });
    expect(
      await w.service.close({
        actor: founder,
        relationshipId: RELATIONSHIP,
        idempotencyKey: "close-key-0002",
      }),
    ).toEqual({
      outcome: "OK",
      relationshipId: RELATIONSHIP,
      deduplicated: false,
    });
    expect(
      await w.service.close({
        actor: investor,
        relationshipId: RELATIONSHIP,
        idempotencyKey: "close-key-0003",
      }),
    ).toEqual({
      outcome: "OK",
      relationshipId: RELATIONSHIP,
      deduplicated: true,
    });
    expect(w.closes).toHaveLength(1);
    expect(w.announced.map((a) => a.outcome)).toEqual([
      "TERMS_RECORDED",
      "TERMS_SIGNED",
      "CLOSED",
    ]);
    // The audit chain: who acted, in order.
    expect(
      w.audits.map((a) => (a as { actionType: string }).actionType),
    ).toEqual([
      "relationship.deal_terms_recorded",
      "relationship.deal_terms_signed",
      "relationship.deal_closed",
    ]);
    const view = await w.service.view(founder, RELATIONSHIP);
    expect(view?.end?.kind).toBe("CLOSED");
    expect(view?.nextSteps).toEqual([]);
    expect(
      view?.checklist
        .filter((item) => item.fromRecord)
        .map((item) => item.code),
    ).toEqual(["SIGNED_DOCS_FILED", "FUNDS_COUNTED"]);
    expect(view?.updateCadence).toMatch(/Monthly/);
  });

  it("is the same not-found for a stranger, and writes nothing", async () => {
    const w = afterSoftCommit();
    expect(
      await w.service.recordTerms({
        actor: stranger,
        relationshipId: RELATIONSHIP,
        terms: SAFE,
        idempotencyKey: "terms-key-0009",
      }),
    ).toEqual({ outcome: "REFUSED", code: "NOT_FOUND" });
    expect(await w.service.view(stranger, RELATIONSHIP)).toBeNull();
    expect(w.terms).toHaveLength(0);
  });
});

describe("deal close: reports and visibility", () => {
  it("only the investor generates the memo; it is investor-private, in the investor's tenant, and the founder never lists it", async () => {
    const w = afterSoftCommit();
    expect(
      await w.service.generateReport({
        actor: founder,
        relationshipId: RELATIONSHIP,
        kind: "INVESTMENT_MEMO",
        idempotencyKey: "report-key-01",
      }),
    ).toEqual({ outcome: "REFUSED", code: "NOT_ALLOWED" });
    const memo = await w.service.generateReport({
      actor: investor,
      relationshipId: RELATIONSHIP,
      kind: "INVESTMENT_MEMO",
      idempotencyKey: "report-key-02",
    });
    expect(memo.outcome).toBe("OK");
    expect(w.reports[0]).toMatchObject({
      visibility_scope: "investor_private",
      owner_side: "INVESTOR",
      tenant_id: investor.tenantId,
      version: 1,
    });
    expect((await w.service.view(founder, RELATIONSHIP))?.reports).toEqual([]);
    expect(
      (await w.service.view(investor, RELATIONSHIP))?.reports.map(
        (r) => r.kind,
      ),
    ).toEqual(["INVESTMENT_MEMO"]);
    const reportId = memo.outcome === "OK" ? memo.report.reportId : "";
    expect(
      await w.service.report({
        actor: founder,
        relationshipId: RELATIONSHIP,
        reportId,
      }),
    ).toBeNull();
  });

  it("a shared report is compiled only from history both sides may read", async () => {
    const w = afterSoftCommit();
    w.add("discovered", {}, "investor_private", "SECRET-SCOUT");
    const shared = await w.service.generateReport({
      actor: investor,
      relationshipId: RELATIONSHIP,
      kind: "MEETING_SUMMARY",
      idempotencyKey: "report-key-03",
    });
    expect(shared.outcome).toBe("OK");
    const text = JSON.stringify(w.reports[0]?.["content"]);
    expect(text).not.toContain("SECRET-SCOUT");
    expect(w.reports[0]).toMatchObject({
      visibility_scope: "relationship_shared",
      tenant_id: founder.tenantId,
    });
    expect(
      (await w.service.view(founder, RELATIONSHIP))?.reports.map((r) => r.kind),
    ).toEqual(["MEETING_SUMMARY"]);
  });

  it("versions are append-only, a key replays its own report, and the closing/pass reports wait for their end", async () => {
    const w = afterSoftCommit();
    expect(
      await w.service.generateReport({
        actor: investor,
        relationshipId: RELATIONSHIP,
        kind: "CLOSING",
        idempotencyKey: "report-key-04",
      }),
    ).toEqual({ outcome: "REFUSED", code: "NOT_IN_STAGE" });
    expect(
      await w.service.generateReport({
        actor: investor,
        relationshipId: RELATIONSHIP,
        kind: "PASS",
        idempotencyKey: "report-key-05",
      }),
    ).toEqual({ outcome: "REFUSED", code: "NOT_IN_STAGE" });
    await w.service.generateReport({
      actor: investor,
      relationshipId: RELATIONSHIP,
      kind: "DILIGENCE",
      idempotencyKey: "report-key-06",
    });
    const replay = await w.service.generateReport({
      actor: investor,
      relationshipId: RELATIONSHIP,
      kind: "DILIGENCE",
      idempotencyKey: "report-key-06",
    });
    expect(replay.outcome === "OK" && replay.deduplicated).toBe(true);
    await w.service.generateReport({
      actor: founder,
      relationshipId: RELATIONSHIP,
      kind: "DILIGENCE",
      idempotencyKey: "report-key-07",
    });
    await w.service.generateReport({
      actor: investor,
      relationshipId: RELATIONSHIP,
      kind: "DILIGENCE",
      idempotencyKey: "report-key-08",
    });
    expect(w.reports.map((r) => [r["owner_side"], r["version"]])).toEqual([
      ["INVESTOR", 1],
      ["COMPANY", 1],
      ["INVESTOR", 2],
    ]);
    expect(
      w.audits.filter(
        (a) =>
          (a as { actionType: string }).actionType ===
          "relationship.report_generated",
      ),
    ).toHaveLength(3);
  });
});
