import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type {
  ApplicationStatementView,
  DimensionStatus,
} from "../src/contracts/statements.js";
import { InterviewUnavailableError } from "../src/application/interviewer.js";
import {
  claimsRecording,
  NOT_RECORDED_LINE,
} from "../src/application/statement-plan.js";
import {
  NEVER_ASKED_AGAIN,
  dimensionView,
  projectView,
} from "../src/application/statement-view.js";
import { JOURNEY, type JourneyTurn } from "./fixtures/long-journey.js";
import { reading, statementWorld } from "./support/statement-world.js";

/**
 * The long-journey regression (design 2026-11-14 §7, slice 2): thirty-four
 * founder turns through the real conversation, intake and interviewer
 * services, with the owner's invariants 1-7 asserted after every turn
 * (invariant 8, the readers agreeing, is slice 3). The model is scripted;
 * everything after it is the production write path.
 */

type World = ReturnType<typeof statementWorld>;

function viewOf(world: World): ApplicationStatementView {
  const { statementRows, linkRows, eventRows } = world.store();
  return projectView(statementRows, linkRows, eventRows);
}

const statusOf = (view: ApplicationStatementView, dimension: string) =>
  view.dimensions.find((d) => d.dimension === dimension)?.status;

const ASKED_AS_MISSING = new Set([
  "required_by_gateway",
  "preferred_by_gateway",
  "investor_emphasis",
  "understanding",
]);

function personTurnId(world: World, clientTurnId: string): string {
  const row = world
    .store()
    .turnRows.find((t) => t.clientTurnId === clientTurnId && t.role === "PERSON");
  if (row === undefined) throw new Error(`no PERSON turn ${clientTurnId}`);
  return row.id;
}

/** Invariants 1-7, after one completed turn. */
function assertInvariants(input: {
  readonly world: World;
  readonly turn: JourneyTurn;
  readonly before: ApplicationStatementView;
  readonly beforeIds: ReadonlySet<string>;
  readonly beforeLinks: number;
  readonly beforeEvents: number;
  readonly prompted: boolean;
  readonly applicationId: string;
}): ApplicationStatementView {
  const { world, turn, before } = input;
  const store = world.store();
  const after = viewOf(world);
  const newLinks = store.linkRows.slice(input.beforeLinks);
  const newEvents = store.eventRows.slice(input.beforeEvents);

  // 1. Every statement is recoverable, with provenance and history: none
  //    is ever lost, each is current or superseded on its own dimension,
  //    and each one this turn should record names the turn that said it
  //    and is in that turn's reading.
  for (const id of input.beforeIds)
    expect(store.statementRows.some((s) => s.id === id), `lost ${id}`).toBe(true);
  for (const statement of store.statementRows) {
    // A journey begun on statements carries nothing in from legacy facts:
    // every statement is one the founder said in a turn.
    expect(statement.origin, `${statement.words} said in a turn`).toBe("TURN");
    const entry = dimensionView(after, statement.dimension);
    const held =
      entry.items.some((i) => i.statementId === statement.id) ||
      entry.superseded.some((s) => s.item.statementId === statement.id);
    expect(held, `${statement.words} is recoverable`).toBe(true);
  }
  for (const expected of turn.records ?? []) {
    const source = personTurnId(world, expected.saidIn ?? turn.id);
    const found = store.statementRows.find(
      (s) => s.words.includes(expected.words) && s.dimension === expected.dimension,
    );
    expect(found, `recorded: ${expected.words}`).toBeDefined();
    expect(found?.sourceTurnId).toBe(source);
    expect(found?.origin).toBe("TURN");
    const turnReading = store.readingRows.find((r) => r.turnId === source);
    expect(turnReading?.recordedStatementIds).toContain(found?.id);
  }

  // 2. A correction affects only its target: nothing that was current
  //    stops being current without a CORRECTS link or a resolution written
  //    this turn naming it.
  for (const entry of before.dimensions)
    for (const item of entry.items) {
      const stillCurrent = dimensionView(after, entry.dimension).items.some(
        (i) => i.statementId === item.statementId,
      );
      if (stillCurrent) continue;
      const corrected = newLinks.some(
        (l) => l.kind === "CORRECTS" && l.toStatementId === item.statementId,
      );
      const resolved = newEvents.some((e) => {
        const link = store.linkRows.find((l) => l.id === e.linkId);
        return (
          e.state === "RESOLVED" &&
          link !== undefined &&
          [link.fromStatementId, link.toStatementId].includes(item.statementId)
        );
      });
      expect(corrected || resolved, `${item.words} hidden only by its own correction`).toBe(true);
    }

  // 3. A contradiction stays visible until it is explicitly settled.
  for (const entry of before.dimensions)
    for (const d of entry.disagreements) {
      if (!d.active) continue;
      const settled =
        newLinks.some(
          (l) =>
            l.kind === "CORRECTS" &&
            [d.olderStatementId, d.newerStatementId].includes(l.toStatementId),
        ) ||
        newEvents.some((e) => e.linkId === d.linkId && e.state === "RESOLVED");
      if (settled) continue;
      const now = after.dimensions
        .flatMap((x) => x.disagreements)
        .find(
          (x) =>
            x.olderStatementId === d.olderStatementId &&
            x.newerStatementId === d.newerStatementId,
        );
      expect(now?.active, "an unsettled disagreement stays").toBe(true);
      expect(now?.state).not.toBe("RESOLVED");
    }

  // 4 and 5. What Q was told to ask, from the view before the turn: never
  //    a settled, zero, declined or left-open dimension, and an unresolved
  //    one is never treated as unanswered.
  if (input.prompted) {
    const prompt = world.prompts.at(-1);
    if (prompt === undefined) throw new Error("no prompt");
    for (const need of prompt.needs()) {
      const status = statusOf(before, need.dimension) as DimensionStatus | undefined;
      if (status === undefined) continue;
      const followUp = status === "SETTLED" && need.reason === "needs_specifics";
      expect(
        NEVER_ASKED_AGAIN.has(status) && !followUp,
        `${need.dimension} (${status}) is not asked again`,
      ).toBe(false);
      if (status !== "UNANSWERED")
        expect(ASKED_AS_MISSING.has(need.reason), `${need.dimension} is not unanswered`).toBe(false);
    }
    for (const entry of before.dimensions)
      if (entry.status === "DISAGREEMENT_LEFT_OPEN")
        expect(
          prompt.contradictions().some(
            (line) => line.includes(` ${entry.dimension}:`) && line.endsWith("(left open by them)"),
          ),
        ).toBe(true);
  }
  for (const entry of after.dimensions) {
    if (entry.items.length === 0) continue;
    expect(entry.status).not.toBe("UNANSWERED");
    // The legacy readers still see the dimension.
    expect(
      store.factRows.some(
        (f) => f.dimension === entry.dimension && f.supersededAt === null,
      ),
      `${entry.dimension} has a legacy fact`,
    ).toBe(true);
  }

  // 6. Nothing is left holding the interview.
  const q = store.turnRows.find((t) => t.clientTurnId === turn.id && t.role === "Q");
  expect(q, "Q answered").toBeDefined();

  // 7. Q claims something was recorded only when the reading says so.
  for (const qTurn of store.turnRows.filter((t) => t.role === "Q")) {
    if (!claimsRecording(qTurn.text)) continue;
    const person = store.turnRows.find(
      (t) => t.role === "PERSON" && t.clientTurnId === qTurn.clientTurnId,
    );
    const turnReading = store.readingRows.find((r) => r.turnId === person?.id);
    expect(
      (turnReading?.recordedStatementIds.length ?? 0) > 0,
      `"${qTurn.text}" is backed by a reading`,
    ).toBe(true);
  }
  // Every PERSON turn Q answered has exactly one reading.
  for (const person of store.turnRows.filter((t) => t.role === "PERSON")) {
    const answered = store.turnRows.some(
      (t) => t.role === "Q" && t.clientTurnId === person.clientTurnId,
    );
    const readings = store.readingRows.filter((r) => r.turnId === person.id);
    expect(readings.length).toBeLessThanOrEqual(1);
    if (answered) expect(readings.length, `${person.clientTurnId} read`).toBe(1);
  }
  return after;
}

describe("the long journey: 34 turns, invariants 1-7 after every turn", () => {
  it("keeps every statement, its history and its disagreements, and never claims what was not recorded", async () => {
    const world = statementWorld();
    let { intake, conversation } = world.services();
    const started = await intake.start({ gatewayPublicId: "gq_23456789abcdefghjkmnpqrs99" });
    const token = started.token;
    const applicationId = (await intake.authorise(token)).application.id;

    world.scripts.push(() => reading({ reply: "Hello, I'm Q. What are you building?" }));
    await conversation.openingFor({ token, correlationId: randomUUID() });

    const send = (turn: JourneyTurn) =>
      conversation.turn({
        token,
        message: turn.say,
        clientTurnId: turn.id,
        correlationId: randomUUID(),
      });

    let before = viewOf(world);
    for (const turn of JOURNEY) {
      world.advance(60_000);
      if (turn.resumeBefore === true) ({ intake, conversation } = world.services());
      const store = world.store();
      const snapshot = {
        beforeIds: new Set(store.statementRows.map((s) => s.id)),
        beforeLinks: store.linkRows.length,
        beforeEvents: store.eventRows.length,
      };
      const calls = world.prompts.length;

      if (turn.script === "FAIL") {
        world.scripts.push(() => "FAIL");
        const failure = await send(turn).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(InterviewUnavailableError);
        // 6. A failed reply holds nothing: no claim, nothing written, and
        //    the founder's words are kept.
        expect(await world.turns.pendingFor(applicationId as never)).toBe(false);
        expect(world.store().statementRows.length).toBe(snapshot.beforeIds.size);
        expect(
          world.store().turnRows.some((t) => t.clientTurnId === turn.id && t.role === "PERSON"),
        ).toBe(true);
        if (turn.retryWith === undefined) continue;
        world.scripts.push(turn.retryWith);
        world.advance(5_000);
      } else world.scripts.push(turn.script);

      await send(turn);
      expect(await world.turns.pendingFor(applicationId as never)).toBe(false);
      before = assertInvariants({
        world,
        turn,
        before,
        ...snapshot,
        prompted: world.prompts.length > calls,
        applicationId,
      });
      await checksAfter(turn.id, { world, intake, token, view: before });
    }

    // Retried turn 21 is one PERSON row and one Q row.
    const t21 = world.store().turnRows.filter((t) => t.clientTurnId === "turn-0021");
    expect(t21.map((t) => t.role).sort()).toEqual(["PERSON", "Q"]);
    // Every PERSON turn now has a reading: the orphan was recovered.
    const store = world.store();
    for (const person of store.turnRows.filter((t) => t.role === "PERSON"))
      expect(store.readingRows.some((r) => r.turnId === person.id), person.clientTurnId).toBe(true);
    // Final state, as the legacy readers see it.
    const traction = store.factRows.find(
      (f) => f.dimension === "claims.traction" && f.supersededAt === null,
    );
    expect(traction?.value.kind).toBe("TEXT");
    if (traction?.value.kind === "TEXT") {
      expect(traction.value.text).toContain("6 to 18 operators");
      expect(traction.value.text).toContain("1,500 weekly active");
      expect(traction.value.text).toContain("signed a pilot");
      expect(traction.value.text).not.toContain("About 600");
      expect(traction.value.unreconciled?.length).toBe(1);
    }
    const qualification = await intake.qualification(token);
    expect(qualification.outcome).toBe("QUALIFIED");
  });
});

/** Turn-specific evidence, beyond the invariants. */
async function checksAfter(
  id: string,
  context: {
    readonly world: World;
    readonly intake: ReturnType<World["services"]>["intake"];
    readonly token: string;
    readonly view: ApplicationStatementView;
  },
): Promise<void> {
  const { world, intake, token, view } = context;
  const store = world.store();
  const readingOf = (clientTurnId: string) =>
    store.readingRows.find((r) => r.turnId === personTurnId(world, clientTurnId));
  const traction = dimensionView(view, "claims.traction");
  switch (id) {
    case "turn-0005":
      expect(statusOf(view, "claims.revenue")).toBe("ZERO");
      break;
    case "turn-0008": {
      // Only the 600 gave way, to this correction; the operators line stays.
      expect(traction.superseded.map((s) => [s.item.words, s.via])).toEqual([
        ["About 600 weekly active retailers as of 1 November", "CORRECTION"],
      ]);
      expect(traction.items.map((i) => i.words)).toContain(
        "We went from 6 to 18 operators this quarter",
      );
      break;
    }
    case "turn-0009":
      expect(readingOf("turn-0009")?.outcome).toBe("NO_STATEMENTS");
      expect(store.statementRows.some((s) => s.words === "busy day")).toBe(false);
      break;
    case "turn-0012":
      expect(statusOf(view, "company.market")).toBe("UNKNOWN");
      break;
    case "turn-0013": {
      const link = store.linkRows.at(-1);
      expect(link?.origin).toBe("CODE_DETECTED");
      expect(link?.kind).toBe("DISAGREES");
      expect(traction.status).toBe("DISAGREEMENT_OPEN");
      break;
    }
    case "turn-0014":
      expect(traction.status).toBe("DISAGREEMENT_LEFT_OPEN");
      // "I'm not sure which is right" never hid a figure.
      expect(traction.items.map((i) => i.words)).toEqual(
        expect.arrayContaining([
          "about 1,500 weekly active as of 1 November",
          "1,450 weekly active as of 1 November",
        ]),
      );
      expect(store.eventRows.at(-1)?.state).toBe("LEFT_OPEN");
      break;
    case "turn-0017": {
      const q = store.turnRows.find((t) => t.clientTurnId === id && t.role === "Q");
      expect(q?.text.startsWith(NOT_RECORDED_LINE)).toBe(true);
      expect(q?.text).not.toContain("Noted");
      expect(readingOf(id)?.outcome).toBe("NO_STATEMENTS");
      break;
    }
    case "turn-0019": {
      // S99 was never issued: kept as a new statement, linked to nothing.
      const reading19 = readingOf(id);
      expect(reading19?.outcome).toBe("READ");
      expect(reading19?.notRecorded.map((n) => n.reason)).toEqual(["UNKNOWN_HANDLE"]);
      const four = store.statementRows.find((s) => s.words.includes("four engineers"));
      expect(store.linkRows.some((l) => l.fromStatementId === four?.id)).toBe(false);
      expect(dimensionView(view, "company.team").items).toHaveLength(2);
      break;
    }
    case "turn-0020": {
      // Decision 91: the raise in genuine disagreement is UNRESOLVED.
      expect(statusOf(view, "raise.amount")).toBe("DISAGREEMENT_OPEN");
      const qualification = await intake.qualification(token);
      expect(qualification.outcome).toBe("UNRESOLVED");
      expect(qualification.access).toBe("MAY_APPLY");
      expect(qualification.unresolved?.length).toBe(1);
      break;
    }
    case "turn-0021":
      expect(statusOf(view, "company.market")).toBe("SETTLED");
      // The earlier "I don't know" is kept as said.
      expect(dimensionView(view, "company.market").items).toHaveLength(2);
      break;
    case "turn-0022": {
      // The correction settles it; the 1.5 million stays as history.
      expect(statusOf(view, "raise.amount")).toBe("SETTLED");
      const qualification = await intake.qualification(token);
      expect(qualification.outcome).toBe("QUALIFIED");
      const raise = store.factRows.find(
        (f) => f.dimension === "raise.amount" && f.supersededAt === null,
      );
      expect(raise?.value).toEqual({ kind: "AMOUNT", amount: "2000000", currency: "USD" });
      expect(dimensionView(view, "raise.amount").superseded).toHaveLength(1);
      break;
    }
    case "turn-0023":
      expect(readingOf(id)?.outcome).toBe("NO_STATEMENTS");
      break;
    case "turn-0026":
      // Wallets never contradict weekly active users (D10).
      expect(traction.disagreements.filter((d) => d.active)).toHaveLength(1);
      break;
    case "turn-0028": {
      // The orphan was read with its own turn id.
      expect(readingOf("turn-0027")?.outcome).toBe("READ");
      break;
    }
    case "turn-0031":
      expect(dimensionView(view, "claims.revenue").items).toHaveLength(1);
      expect(statusOf(view, "claims.revenue")).toBe("ZERO");
      expect(readingOf(id)?.outcome).toBe("NO_STATEMENTS");
      break;
    case "turn-0032":
      expect(dimensionView(view, "company.country").items).toHaveLength(1);
      break;
    case "turn-0033": {
      const phrases = store.factRows.find(
        (f) => f.dimension === "company.sector_phrases" && f.supersededAt === null,
      );
      expect(phrases?.value).toEqual({
        kind: "PHRASES",
        phrases: ["fintech", "payments infrastructure"],
      });
      break;
    }
    default:
      break;
  }
}

describe("a failure between the statements and Q's reply", () => {
  it("leaves no row behind, and the retry writes the checkpointed rows once without asking the model again", async () => {
    const world = statementWorld();
    const { intake, conversation } = world.services();
    const { token } = await intake.start({ gatewayPublicId: "gq_23456789abcdefghjkmnpqrs99" });
    world.scripts.push(() => reading({ reply: "Hello. What are you building?" }));
    await conversation.openingFor({ token, correlationId: randomUUID() });
    const first = JOURNEY[0];
    if (first === undefined || first.script === "FAIL") throw new Error("fixture");

    world.scripts.push(first.script);
    world.faults.push({ at: "BEFORE_Q_TURN", remaining: 1 });
    const message = { token, message: first.say, clientTurnId: first.id, correlationId: randomUUID() };
    await expect(conversation.turn(message)).rejects.toThrow("injected");
    const failed = world.store();
    expect(failed.statementRows).toHaveLength(0);
    expect(failed.readingRows).toHaveLength(0);
    expect(failed.factRows).toHaveLength(0);
    expect(failed.turnRows.filter((t) => t.role === "Q")).toHaveLength(1); // the opening

    const calls = world.prompts.length;
    await conversation.turn(message);
    expect(world.prompts.length).toBe(calls);
    const done = world.store();
    expect(done.statementRows).toHaveLength(3);
    expect(done.readingRows).toHaveLength(1);
    expect(done.readingRows[0]?.recordedStatementIds).toHaveLength(3);
    expect(done.factRows.filter((f) => f.supersededAt === null).map((f) => f.dimension).sort()).toEqual([
      "company.country",
      "company.description",
      "company.name",
    ]);
  });
});
