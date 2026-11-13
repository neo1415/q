import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createEventRegistry, type CorrelationId } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import {
  interestAnsweredEvent,
  NETWORK_EVENTS,
  relationshipInterestExpressedEvent,
} from "@capital-q/network/events";

import {
  BENCH_ACCOUNT_PATTERN,
  withInterestNotices,
} from "../src/network/interest-notice-handler.js";
import type { QueueMessage } from "../src/queue/pgmq.js";
import type { MessageOutcome } from "../src/queue/runner.js";
import { createRecordingLogger, TENANT_A } from "./support/fakes.js";

/**
 * AUTO (2026-10-02): the receiving side hears about an incoming interest
 * (investor -> company) or connection request (founder -> investor).
 */

const registry = createEventRegistry([...NETWORK_EVENTS]);
const RELATIONSHIP = "88888888-0000-4000-8000-000000000001";
const INTEREST = "77777777-0000-4000-8000-000000000001";
const cor = (): CorrelationId => `cor_${randomUUID()}`;
const envelope = {
  tenantId: TENANT_A,
  organisationId: "d0000000-0000-4000-8000-000000000001",
  actorUserId: "b0000000-0000-4000-8000-000000000001",
  relationshipId: RELATIONSHIP,
  companyId: "a0000000-0000-4000-8000-000000000001",
  investorOrganisationId: "11111111-0000-4000-8000-000000000013",
};
const message = (event: unknown): QueueMessage => ({
  msgId: 1,
  readCount: 1,
  enqueuedAt: new Date().toISOString(),
  message: event,
});
const expressed = () =>
  relationshipInterestExpressedEvent({
    ...envelope,
    correlationId: cor(),
    interestId: INTEREST,
  });

function harness(party: "INVESTOR" | "COMPANY", fail = false) {
  const told: {
    kind: string;
    title: string;
    actingSide: string;
    key: string;
  }[] = [];
  const queries: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push({ text: strings.join("?"), values });
    return fail
      ? Promise.reject(new Error("db down"))
      : Promise.resolve([
          { party, company: "Pay Co", investor: "Ada Capital" },
        ]);
  }) as unknown;
  const passed: unknown[] = [];
  const handle = withInterestNotices(
    (inner): Promise<MessageOutcome> => {
      passed.push(inner.message);
      return Promise.resolve({ kind: "DONE" });
    },
    {
      registry,
      sql: sql as DatabaseExecutor,
      notices: {
        notify: (input) => {
          told.push({
            kind: input.kind,
            title: input.title,
            actingSide: input.actingSide,
            key: input.key,
          });
          return Promise.resolve(1);
        },
      },
      logger: createRecordingLogger(),
    },
  );
  return { handle, told, passed, queries };
}

describe("withInterestNotices", () => {
  it("tells the company about an investor's interest", async () => {
    const h = harness("INVESTOR");
    await h.handle(message(expressed()));
    expect(h.told).toEqual([
      {
        kind: "INTEREST_RECEIVED",
        title: "Ada Capital is interested in Pay Co",
        actingSide: "INVESTOR",
        key: INTEREST,
      },
    ]);
    expect(h.passed).toHaveLength(1);
  });

  it("tells the investor about a founder's connection request", async () => {
    const h = harness("COMPANY");
    await h.handle(message(expressed()));
    expect(h.told[0]).toMatchObject({
      kind: "CONNECTION_REQUESTED",
      title: "Pay Co asked to connect with you",
      actingSide: "COMPANY",
    });
  });

  it("resolves the notice once the interest is answered, accepted or declined (QA run 8a1d57b9)", async () => {
    for (const decision of ["ACCEPTED", "DECLINED"] as const) {
      const h = harness("INVESTOR");
      await h.handle(
        message(
          interestAnsweredEvent({
            ...envelope,
            correlationId: cor(),
            decision,
            interestId: INTEREST,
            matchId:
              decision === "ACCEPTED"
                ? "55555555-0000-4000-8000-000000000001"
                : null,
          }),
        ),
      );
      // A decline tells nobody anything new; an acceptance is D1's notice.
      expect(h.told.map((t) => t.kind)).toEqual(
        decision === "ACCEPTED" ? ["INTEREST_ACCEPTED"] : [],
      );
      expect(h.passed).toHaveLength(1);
      expect(h.queries).toHaveLength(decision === "ACCEPTED" ? 2 : 1);
      expect(h.queries[0]?.text).toContain("set read_at");
      expect(h.queries[0]?.values).toEqual([
        `interest_received:${INTEREST}`,
        `connection_requested:${INTEREST}`,
      ]);
    }
    const failing = harness("INVESTOR", true);
    expect(
      await failing.handle(
        message(
          interestAnsweredEvent({
            ...envelope,
            correlationId: cor(),
            decision: "ACCEPTED",
            interestId: INTEREST,
            matchId: "55555555-0000-4000-8000-000000000001",
          }),
        ),
      ),
    ).toEqual({ kind: "RETRY", errorCode: "INTEREST_NOTICE_FAILED" });
  });

  it("ignores other events and retries when it cannot write", async () => {
    const quiet = harness("INVESTOR");
    await quiet.handle(
      message(
        interestAnsweredEvent({
          ...envelope,
          correlationId: cor(),
          decision: "DECLINED",
          interestId: INTEREST,
          matchId: null,
        }),
      ),
    );
    // An answer tells nobody anything new.
    expect(quiet.told).toEqual([]);
    const failing = harness("INVESTOR", true);
    expect(await failing.handle(message(expressed()))).toEqual({
      kind: "RETRY",
      errorCode: "INTEREST_NOTICE_FAILED",
    });
  });
});

/**
 * Journey audit 2026-11-13 D1: the side that expressed interest hears that
 * it was accepted, once per interest, and only that side.
 */
describe("an accepted interest", () => {
  const MATCH = "55555555-0000-4000-8000-000000000001";
  const accepted = () =>
    interestAnsweredEvent({
      ...envelope,
      correlationId: cor(),
      decision: "ACCEPTED",
      interestId: INTEREST,
      matchId: MATCH,
    });

  it("tells the investor's people when the company accepts their interest", async () => {
    const h = harness("INVESTOR");
    expect(await h.handle(message(accepted()))).toEqual({ kind: "DONE" });
    // The company accepted, so the company is the acting side and the
    // investor organisation's members are the ones told.
    expect(h.told).toEqual([
      {
        kind: "INTEREST_ACCEPTED",
        title: "Pay Co accepted your interest",
        actingSide: "COMPANY",
        key: INTEREST,
      },
    ]);
    // The lookup is bound to this interest on this relationship.
    expect(h.queries[1]?.values).toEqual([INTEREST, RELATIONSHIP]);
    expect(h.passed).toHaveLength(1);
  });

  it("tells the founder's people when the investor accepts their request", async () => {
    const h = harness("COMPANY");
    await h.handle(message(accepted()));
    expect(h.told).toEqual([
      {
        kind: "INTEREST_ACCEPTED",
        title: "Ada Capital accepted your request to connect",
        actingSide: "INVESTOR",
        key: INTEREST,
      },
    ]);
  });

  it("keys every delivery to the interest, so redelivery adds nothing", async () => {
    const h = harness("INVESTOR");
    const event = accepted();
    await h.handle(message(event));
    await h.handle(message(event));
    // Same dedupe key both times; the insert's on-conflict absorbs it.
    expect(h.told.map((t) => t.key)).toEqual([INTEREST, INTEREST]);
  });

  it("tells nobody about a decline or an unknown interest", async () => {
    const declined = harness("INVESTOR");
    await declined.handle(
      message(
        interestAnsweredEvent({
          ...envelope,
          correlationId: cor(),
          decision: "DECLINED",
          interestId: INTEREST,
          matchId: null,
        }),
      ),
    );
    expect(declined.told).toEqual([]);

    const told: string[] = [];
    const empty = withInterestNotices(() => Promise.resolve({ kind: "DONE" }), {
      registry,
      sql: (() => Promise.resolve([])) as unknown as DatabaseExecutor,
      notices: {
        notify: (input) => {
          told.push(input.kind);
          return Promise.resolve(1);
        },
      },
      logger: createRecordingLogger(),
    });
    expect(await empty(message(accepted()))).toEqual({ kind: "DONE" });
    expect(told).toEqual([]);
  });

  it("never wedges the matched event: a missing kind is skipped, a transient failure retried", async () => {
    const run = async (code: string) => {
      const passed: unknown[] = [];
      const handle = withInterestNotices(
        (inner) => {
          passed.push(inner);
          return Promise.resolve({ kind: "DONE" });
        },
        {
          registry,
          sql: (() =>
            Promise.resolve([
              { party: "INVESTOR", company: "Pay Co", investor: "Ada Capital" },
            ])) as unknown as DatabaseExecutor,
          notices: {
            notify: () =>
              Promise.reject(Object.assign(new Error("x"), { code })),
          },
          logger: createRecordingLogger(),
        },
      );
      return { outcome: await handle(message(accepted())), passed };
    };
    const missingKind = await run("23514");
    expect(missingKind.outcome).toEqual({ kind: "DONE" });
    expect(missingKind.passed).toHaveLength(1);
    const transient = await run("08006");
    expect(transient.outcome).toEqual({
      kind: "RETRY",
      errorCode: "INTEREST_NOTICE_FAILED",
    });
    expect(transient.passed).toHaveLength(0);
  });
});

/**
 * voiceq-63: QA bench accounts playing real investors expressed interest in
 * real founders' companies on 2026-10-03 ("Ventures Platform is interested
 * in Nixo"). A bench account's interest never notifies anyone; a lookup
 * that fails never stops a real notice.
 */
describe("a bench account's interest", () => {
  const run = async (bench: boolean | "fails") => {
    const told: string[] = [];
    const sql = ((strings: TemplateStringsArray) => {
      const text = strings.join("?");
      if (text.includes("auth.users")) {
        return bench === "fails"
          ? Promise.reject(new Error("permission denied"))
          : Promise.resolve([{ bench }]);
      }
      return Promise.resolve([
        { party: "INVESTOR", company: "Nixo", investor: "Ventures Platform" },
      ]);
    }) as unknown;
    const handle = withInterestNotices(
      () => Promise.resolve({ kind: "DONE" }),
      {
        registry,
        sql: sql as DatabaseExecutor,
        notices: {
          notify: (input) => {
            told.push(input.title);
            return Promise.resolve(1);
          },
        },
        logger: createRecordingLogger(),
      },
    );
    const outcome = await handle(message(expressed()));
    return { told, outcome };
  };

  it("notifies nobody", async () => {
    const { told, outcome } = await run(true);
    expect(told).toEqual([]);
    expect(outcome).toEqual({ kind: "DONE" });
  });

  it("a real investor's interest is still told, even if the check fails", async () => {
    expect((await run(false)).told).toEqual([
      "Ventures Platform is interested in Nixo",
    ]);
    expect((await run("fails")).told).toEqual([
      "Ventures Platform is interested in Nixo",
    ]);
  });

  it("matches the bench families only, never the fictional seed world", () => {
    const bench = new RegExp(BENCH_ACCOUNT_PATTERN);
    expect(bench.test("bench.soyombo3@fictional.capitalq.local")).toBe(true);
    expect(bench.test("bench.venturesplatform3@fictional.capitalq.local")).toBe(
      true,
    );
    expect(bench.test("investor.savanna@fictional.capitalq.local")).toBe(false);
    expect(bench.test("adedaniel502@gmail.com")).toBe(false);
  });
});
