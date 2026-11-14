import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { ApplicationAnswersRequest } from "@capital-q/contracts";

import type { ApplicationStatementView } from "../src/contracts/statements.js";
import { factsFromAnswers } from "../src/domain/form-answers.js";
import { projectView } from "../src/application/statement-view.js";
import {
  PUBLIC_ID,
  reading,
  statementWorld,
} from "./support/statement-world.js";

/**
 * Live re-certification 14 Nov (d2ce8c91e), defects P1a, P1b, P2a and P2b.
 *
 * - P1a: resuming the gateway page saved the profile-prefilled form with no
 *   founder action, and its stage (series_b) CORRECTED the interview's
 *   Series A / seed statements, erasing a disagreement left open.
 * - P1b: "leave it open for now" became an UNKNOWN weekly-users statement
 *   linked DISAGREES with 600 (600 vs "Not known").
 * - P2a: with the stage disagreement erased, every surface read "Seed /
 *   Meets" while the synthesis said unresolved.
 * - P2b: every form save re-recorded every answer as a correction of the
 *   same value ("Earlier answers, corrected (35)").
 */

type World = ReturnType<typeof statementWorld>;

const viewOf = (world: World): ApplicationStatementView => {
  const { statementRows, linkRows, eventRows } = world.store();
  return projectView(statementRows, linkRows, eventRows);
};
const entry = (view: ApplicationStatementView, dimension: string) => {
  const found = view.dimensions.find((d) => d.dimension === dimension);
  if (found === undefined) throw new Error(`no ${dimension}`);
  return found;
};

const FORM: ApplicationAnswersRequest = {
  companyName: "Coverisk Africa",
  oneLiner: "Embedded insurance for informal retailers",
  stage: "seed",
  sectors: ["Fintech"],
  country: "KE",
  raise: { amount: "350000", currency: "USD" },
  contactName: "Kamau Barasa",
  contactEmail: "kamau@example.com",
};

async function interviewWithStageLeftOpen() {
  const world = statementWorld();
  const { intake, conversation } = world.services();
  const { token } = await intake.start({ gatewayPublicId: PUBLIC_ID });
  await intake.recordFacts({
    token,
    origin: "FORM",
    facts: factsFromAnswers(FORM),
  });
  world.scripts.push(() => reading({ reply: "Hello, I'm Q." }));
  await conversation.openingFor({ token, correlationId: randomUUID() });
  const send = (id: string, message: string) =>
    conversation.turn({
      token,
      message,
      clientTurnId: id,
      correlationId: randomUUID(),
    });
  world.advance(60_000);
  world.scripts.push(() =>
    reading({
      reply: "Thanks. Who leads the round?",
      statements: [
        {
          op: "NEW",
          target: null,
          turn: null,
          dimension: "company.stage",
          quantity: null,
          value: { kind: "CODE", code: "series_a" },
          asOf: null,
          words: "we're raising our Series A",
          provenance: "APPLICANT_PROVIDED",
        },
      ],
    }),
  );
  await send("resume-0001", "We're raising our Series A.");
  expect(entry(viewOf(world), "company.stage").status).toBe(
    "DISAGREEMENT_OPEN",
  );
  world.advance(60_000);
  world.scripts.push((prompt) =>
    reading({
      reply: "I'll leave the stage open for them to judge.",
      disagreementActions: [
        {
          disagreement: prompt.disagreement("company.stage"),
          action: "LEAVE_OPEN",
          keep: null,
        },
      ],
    }),
  );
  await send("resume-0002", "Leave the stage open.");
  expect(entry(viewOf(world), "company.stage").status).toBe(
    "DISAGREEMENT_LEFT_OPEN",
  );
  return { world, token };
}

describe("live 14 Nov P1a/P2a/P2b: a resumed form never rewrites the interview", () => {
  it("restores the stored answers, re-saving them writes nothing, and a changed stage disagrees rather than corrects", async () => {
    const { world, token } = await interviewWithStageLeftOpen();
    // A new browser: fresh services over the same stores.
    const { intake } = world.services();
    const resumed = await intake.coverage(token);
    // (ii) The form shows what the application holds, not a blank form.
    expect(resumed.answers).toMatchObject({
      companyName: "Coverisk Africa",
      stage: "seed",
      country: "KE",
      raise: { amount: "350000", currency: "USD" },
      sectors: ["Fintech"],
      contactEmail: "kamau@example.com",
    });
    const before = {
      statements: world.store().statementRows.length,
      links: world.store().linkRows.length,
      facts: world.store().factRows.length,
    };

    // P2b: saving the restored answers unchanged writes nothing at all.
    world.advance(60_000);
    await intake.recordFacts({
      token,
      origin: "FORM",
      facts: factsFromAnswers(resumed.answers ?? {}),
    });
    expect(world.store().statementRows).toHaveLength(before.statements);
    expect(world.store().linkRows).toHaveLength(before.links);
    expect(world.store().factRows).toHaveLength(before.facts);
    expect(entry(viewOf(world), "company.stage").superseded).toHaveLength(0);

    // P1a (iii): the profile's series_b, saved, corrects only the form's
    // own earlier answer; the interview's Series A stands and disagrees.
    world.advance(60_000);
    await intake.recordFacts({
      token,
      origin: "FORM",
      facts: factsFromAnswers({ ...resumed.answers, stage: "series_b" }),
    });
    const store = world.store();
    const added = store.statementRows.slice(before.statements);
    expect(added.map((s) => [s.dimension, s.origin])).toEqual([
      ["company.stage", "FORM"],
    ]);
    const stage = entry(viewOf(world), "company.stage");
    const seriesA = store.statementRows.find(
      (s) => s.origin === "TURN" && s.dimension === "company.stage",
    );
    expect(stage.items.map((i) => i.statementId)).toContain(seriesA?.id);
    expect(
      stage.superseded.every((s) => s.item.origin === "FORM"),
      "a form save never supersedes an interview statement",
    ).toBe(true);
    const newLinks = store.linkRows.slice(before.links);
    expect(
      newLinks.some(
        (l) => l.kind === "CORRECTS" && l.toStatementId === seriesA?.id,
      ),
    ).toBe(false);
    expect(
      newLinks.some(
        (l) => l.kind === "DISAGREES" && l.toStatementId === seriesA?.id,
      ),
    ).toBe(true);
    expect(stage.status).toBe("DISAGREEMENT_OPEN");

    // P2a: the one projector reads the stage UNRESOLVED for every surface
    // (qualification, coverage, dossier and inbox read this result).
    const qualification = await intake.qualification(token);
    expect(qualification.criteria.find((c) => c.type === "STAGE")?.status).toBe(
      "UNRESOLVED",
    );
    expect(qualification.unresolved?.length).toBe(1);
    const review = await intake.coverage(token);
    expect(review.coverage.unresolved ?? []).toHaveLength(1);
  });

  it("a stale form re-sending what it last said never undoes an interview correction", async () => {
    const world = statementWorld();
    const { intake, conversation } = world.services();
    const { token } = await intake.start({ gatewayPublicId: PUBLIC_ID });
    await intake.recordFacts({
      token,
      origin: "FORM",
      facts: factsFromAnswers(FORM),
    });
    world.scripts.push(() => reading({ reply: "Hello, I'm Q." }));
    await conversation.openingFor({ token, correlationId: randomUUID() });
    world.advance(60_000);
    world.scripts.push((prompt) =>
      reading({
        reply: "Thanks. What will the money go on?",
        statements: [
          {
            op: "CORRECTS",
            target: prompt.statement("350000"),
            turn: null,
            dimension: "raise.amount",
            quantity: "raise_amount",
            value: { kind: "MONEY", amount: "400000", currency: "USD" },
            asOf: null,
            words: "we're now raising 400,000 dollars",
            provenance: "APPLICANT_PROVIDED",
          },
        ],
      }),
    );
    await conversation.turn({
      token,
      message: "Actually we're now raising 400,000 dollars.",
      clientTurnId: "resume-0101",
      correlationId: randomUUID(),
    });
    const raise = () => entry(viewOf(world), "raise.amount");
    expect(raise().items.map((i) => i.value)).toEqual([
      { kind: "MONEY", amount: "400000", currency: "USD" },
    ]);
    expect((await intake.coverage(token)).answers?.raise).toEqual({
      amount: "400000",
      currency: "USD",
    });
    const count = world.store().statementRows.length;
    // The old tab's form still holds 350,000 and is saved again.
    world.advance(60_000);
    await intake.recordFacts({
      token,
      origin: "FORM",
      facts: factsFromAnswers(FORM),
    });
    expect(world.store().statementRows).toHaveLength(count);
    expect(raise().items.map((i) => i.value)).toEqual([
      { kind: "MONEY", amount: "400000", currency: "USD" },
    ]);
  });
});

describe("live 14 Nov P1b: a leave-open reply is never an unknown that disagrees", () => {
  it("DISAGREES S<n> with an UNKNOWN value leaves the existing disagreement open and records no statement", async () => {
    const world = statementWorld();
    const { intake, conversation } = world.services();
    const { token } = await intake.start({ gatewayPublicId: PUBLIC_ID });
    world.scripts.push(() => reading({ reply: "Hello, I'm Q." }));
    await conversation.openingFor({ token, correlationId: randomUUID() });
    const send = (id: string, message: string) =>
      conversation.turn({
        token,
        message,
        clientTurnId: id,
        correlationId: randomUUID(),
      });
    const weekly = (count: string, words: string) => ({
      op: "NEW" as const,
      target: null,
      turn: null,
      dimension: "claims.traction",
      quantity: "weekly_active_users" as const,
      value: { kind: "COUNT" as const, count },
      asOf: null,
      words,
      provenance: "APPLICANT_PROVIDED" as const,
    });
    world.advance(60_000);
    world.scripts.push(() =>
      reading({
        reply: "Thanks.",
        statements: [weekly("600", "about 600 weekly active")],
      }),
    );
    await send("open-0001", "About 600 weekly active.");
    world.advance(60_000);
    world.scripts.push(() =>
      reading({
        reply: "Thanks.",
        statements: [weekly("1500", "about 1,500 weekly active now")],
      }),
    );
    await send("open-0002", "About 1,500 weekly active now.");
    const link = world.store().linkRows.find((l) => l.kind === "DISAGREES");
    expect(link).toBeDefined();
    const statements = world.store().statementRows.length;
    const links = world.store().linkRows.length;

    // The live reading: an UNKNOWN that DISAGREES with the 600.
    world.advance(60_000);
    world.scripts.push((prompt) =>
      reading({
        reply: "I'll leave the two dashboard figures unresolved.",
        intent: "UNKNOWN_OR_SKIP",
        statements: [
          {
            ...weekly("1", "leave it open for now"),
            op: "DISAGREES",
            target: prompt.statement("about 600 weekly active"),
            value: { kind: "UNKNOWN", declined: false },
            provenance: "UNKNOWN",
          },
        ],
      }),
    );
    await send("open-0003", "Leave it open for now.");
    const store = world.store();
    expect(store.statementRows).toHaveLength(statements);
    expect(store.linkRows).toHaveLength(links);
    expect(store.eventRows.map((e) => [e.linkId, e.state])).toEqual([
      [link?.id, "LEFT_OPEN"],
    ]);
    const traction = entry(viewOf(world), "claims.traction");
    expect(traction.status).toBe("DISAGREEMENT_LEFT_OPEN");
    expect(traction.disagreements.filter((d) => d.active)).toHaveLength(1);
    const q = store.turnRows.find(
      (t) => t.clientTurnId === "open-0003" && t.role === "Q",
    );
    expect(q?.text).toContain("unresolved");
  });

  it("the projector never treats a stored link to an UNKNOWN as a disagreement (rows already written live)", () => {
    const applicationId = randomUUID();
    const at = (n: number) =>
      new Date(Date.UTC(2026, 10, 14, 16, n)).toISOString();
    const statement = (id: string, n: number, value: unknown) => ({
      id,
      applicationId,
      dimension: "claims.traction",
      quantity: "weekly_active_users",
      value,
      asOf: null,
      words: "w",
      provenance: "APPLICANT_PROVIDED",
      origin: "TURN",
      sourceTurnId: null,
      backfillKey: null,
      statedAt: at(n),
      recordedAt: at(n),
    });
    const known = randomUUID();
    const unknown = randomUUID();
    const view = projectView(
      [
        statement(known, 1, { kind: "COUNT", count: "600" }),
        {
          ...statement(unknown, 2, { kind: "UNKNOWN" }),
          provenance: "UNKNOWN",
        },
      ] as never,
      [
        {
          id: randomUUID(),
          applicationId,
          kind: "DISAGREES",
          fromStatementId: unknown,
          toStatementId: known,
          origin: "MODEL_READING",
          sourceTurnId: null,
          createdAt: at(2),
        },
      ] as never,
      [],
    );
    const traction = entry(view, "claims.traction");
    expect(traction.disagreements.map((d) => d.active)).toEqual([false]);
    expect(traction.status).toBe("SETTLED");
  });
});
