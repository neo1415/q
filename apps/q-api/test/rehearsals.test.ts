import { describe, expect, it } from "vitest";

import type { DatabaseExecutor } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import {
  createRehearsalService,
  type RehearsalComposer,
  type RehearsalMaterial,
} from "../src/composition/rehearsals.js";

/**
 * The Investor Twin (founder direction 2026-09-30, C12): a founder
 * rehearses with an investor Q plays, and only the founder's own side of
 * the relationship feeds the persona.
 */

const TENANT = "11111111-1111-4111-8111-111111111111";
const FOUNDER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const INVESTOR = "44444444-4444-4444-8444-444444444444";
const HIDDEN = "55555555-5555-4555-8555-555555555555";
const RELATIONSHIP = "66666666-6666-4666-8666-666666666666";

const actor = (userId: string) =>
  ({ tenantId: TENANT, userId, actorType: "HUMAN" }) as unknown as ActorContext;

type Row = Record<string, unknown>;

/** A tiny stand-in for q_runtime.rehearsals, keyed on the service's own queries. */
function fakeSql() {
  const rows: Row[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("insert into q_runtime.rehearsals")) {
      const [id, tenant, user, , investor, name, persona, turns, size] = values;
      const row: Row = {
        id,
        tenant_id: tenant,
        user_id: user,
        investor_organisation_id: investor,
        investor_name: name,
        persona,
        turns,
        asked: 1,
        length: size,
        status: "ACTIVE",
        scorecard: null,
        created_at: new Date("2026-09-30T10:00:00Z"),
      };
      rows.push(row);
      return Promise.resolve([row]);
    }
    if (text.includes("set turns")) {
      const [turns, asked, id, user] = values;
      const row = rows.find(
        (r) => r.id === id && r.user_id === user && r.status === "ACTIVE",
      );
      if (row === undefined) return Promise.resolve([]);
      Object.assign(row, { turns, asked });
      return Promise.resolve([row]);
    }
    if (text.includes("set status = 'FINISHED'")) {
      const [scorecard, id, user] = values;
      const row = rows.find((r) => r.id === id && r.user_id === user);
      if (row === undefined) return Promise.resolve([]);
      Object.assign(row, { status: "FINISHED", scorecard });
      return Promise.resolve([row]);
    }
    if (text.includes("from q_runtime.rehearsals")) {
      const [id, user, tenant] = values;
      return Promise.resolve(
        rows.filter(
          (r) => r.id === id && r.user_id === user && r.tenant_id === tenant,
        ),
      );
    }
    throw new Error(`unexpected query: ${text}`);
  };
  const sql = Object.assign(tag, { json: (value: unknown) => value });
  return { sql: sql as unknown as DatabaseExecutor, rows };
}

const PERSONA = {
  summary: "A sharp, numbers-first investor.",
  style: "Brisk.",
  priorities: ["Unit economics"],
  likelyQuestions: [
    { question: "What is your CAC?", why: "They lead with it." },
    { question: "Who else is in the round?", why: "Signal." },
    { question: "Why now?", why: "Timing." },
  ],
  pushbacks: ["Asks for the number."],
  howToWin: ["Bring cohorts."],
  grounding: "SOME" as const,
};

function setup() {
  const seen: { profile?: string; messages?: string; calls?: string } = {};
  const material: RehearsalMaterial = {
    companyName: (a) =>
      Promise.resolve(a.userId === FOUNDER ? "Yamfield Agro" : null),
    investor: (_a, id) =>
      Promise.resolve(
        id === INVESTOR
          ? {
              name: "Kola Capital",
              profile: "Name: Kola Capital",
              relationshipId: RELATIONSHIP,
            }
          : null,
      ),
    theirMessages: () => Promise.resolve("Kola: send the cohorts please"),
    theirCalls: () => Promise.resolve("Ade: our cheque is 250k"),
  };
  let asked = 0;
  const composer: RehearsalComposer = {
    persona: (_a, variables) => {
      seen.profile = variables.investorProfile;
      seen.messages = variables.theirMessages;
      seen.calls = variables.theirWordsInCalls;
      return Promise.resolve(PERSONA);
    },
    turn: () => {
      asked += 1;
      return Promise.resolve({
        line: `Question ${asked}?`,
        move: "QUESTION" as const,
      });
    },
    score: () =>
      Promise.resolve({
        overall: "Close to ready.",
        dimensions: [
          {
            name: "EVIDENCE" as const,
            rating: "NEEDS_WORK" as const,
            note: "No CAC.",
          },
        ],
        strengths: [],
        fixes: [{ question: "What is your CAC?", better: "Bring the number." }],
      }),
  };
  const db = fakeSql();
  const service = createRehearsalService({ sql: db.sql, material, composer });
  return { service, seen, db };
}

describe("the Investor Twin rehearsal", () => {
  it("builds the persona from the founder's own side and opens with the investor's first question", async () => {
    const { service, seen } = setup();
    const started = await service.start(actor(FOUNDER), INVESTOR);
    expect(started.kind).toBe("OK");
    if (started.kind !== "OK") return;
    expect(started.rehearsal.turns).toEqual([
      expect.objectContaining({ from: "INVESTOR", text: "Question 1?" }),
    ]);
    expect(seen.messages).toContain("send the cohorts");
    expect(seen.calls).toContain("250k");
  });

  it("answers turn by turn, then coaches in words, and a finished rehearsal takes no more turns", async () => {
    const { service } = setup();
    const started = await service.start(actor(FOUNDER), INVESTOR);
    if (started.kind !== "OK") throw new Error("not started");
    const answered = await service.say(
      actor(FOUNDER),
      started.rehearsal.id,
      "Our CAC is falling.",
    );
    expect(answered.kind).toBe("OK");
    if (answered.kind !== "OK") return;
    expect(answered.rehearsal.turns.map((t) => t.from)).toEqual([
      "INVESTOR",
      "FOUNDER",
      "INVESTOR",
    ]);
    const finished = await service.finish(actor(FOUNDER), started.rehearsal.id);
    expect(finished.kind).toBe("OK");
    if (finished.kind !== "OK") return;
    expect(finished.rehearsal.scorecard?.dimensions[0]?.rating).toBe(
      "NEEDS_WORK",
    );
    expect(
      (await service.say(actor(FOUNDER), started.rehearsal.id, "More?")).kind,
    ).toBe("FINISHED");
  });

  it("someone else's rehearsal is not found", async () => {
    const { service } = setup();
    const started = await service.start(actor(FOUNDER), INVESTOR);
    if (started.kind !== "OK") throw new Error("not started");
    expect((await service.get(actor(OTHER), started.rehearsal.id)).kind).toBe(
      "NOT_FOUND",
    );
    expect(
      (await service.say(actor(OTHER), started.rehearsal.id, "hi")).kind,
    ).toBe("NOT_FOUND");
  });

  it("an investor the founder cannot see cannot be rehearsed, and a non-founder cannot rehearse", async () => {
    const { service, db } = setup();
    expect((await service.start(actor(FOUNDER), HIDDEN)).kind).toBe(
      "NOT_FOUND",
    );
    expect((await service.start(actor(OTHER), INVESTOR)).kind).toBe(
      "NOT_A_FOUNDER",
    );
    expect(db.rows).toHaveLength(0);
  });
});
