import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";
import type { GateQStatementOpV3 as GateQStatementOp } from "@capital-q/q-core";

import {
  claimsCorrection,
  NOT_CORRECTED_LINE,
  replyHeldToReading,
} from "../src/application/statement-plan.js";
import { projectView, relatable } from "../src/application/statement-view.js";
import { reading, statementWorld } from "./support/statement-world.js";

/**
 * A correction supersedes what it corrects (decision 100; live application
 * 0490be41, docs/ai-handoff/audits/2026-11-16-demo-evidence-relationships.md
 * §7). The founder's turn "Correction to my earlier answer, which got cut
 * at the decimal point..." was read as a CORRECTION, but stored as notes:
 * both halves of the cut note ("...gross margin of 29." and "3%.") stayed
 * current, and Q said "I'll treat this as correcting the two partial
 * notes" with nothing recorded. The turns and readings below are the live
 * ones, in the founder's own words.
 */

const GATEWAY = "gq_23456789abcdefghjkmnpqrs99";

const DECK = "Our pitch deck gives our gross margin as 82%.";
const ACCOUNTS =
  "Our management accounts for the 12 months to October 2026 show a gross margin of 29.3%.";
const CUT_LEFT =
  "Our management accounts for the 12 months to October 2026 show a gross margin of 29.";
const CUT_RIGHT = "3%.";
const CORRECTION =
  "Correction to my earlier answer, which got cut at the decimal point: our management accounts for the 12 months to October 2026 show a gross margin of 29.3%, not 29 and 3% as two notes, because the deployment team sits in cost of sales. The 82.0% in the pitch deck is licence margin.";
/** Q's live reply to the correction (18acc1d3), before the plan's checks. */
const LIVE_REPLY =
  "Understood — 29.3% is one accounts figure, and the 82.0% figure is licence margin. I'll treat this as correcting the two partial notes, while keeping the distinction between the two measures.";

type Op = Partial<GateQStatementOp> &
  Pick<GateQStatementOp, "dimension" | "value" | "words">;
const st = (op: Op): GateQStatementOp => ({
  op: "NEW",
  target: null,
  turn: null,
  quantity: null,
  asOf: null,
  provenance: "APPLICANT_PROVIDED",
  ...op,
});

/** Halyard's record before the correction, as the live readings left it. */
async function halyard() {
  const world = statementWorld();
  const services = world.services();
  const { token } = await services.intake.start({ gatewayPublicId: GATEWAY });
  world.scripts.push(() => reading({ reply: "What are you building?" }));
  await services.conversation.openingFor({
    token,
    correlationId: randomUUID(),
  });
  const say = async (clientTurnId: string, message: string) => {
    world.advance(60_000);
    return services.conversation.turn({
      token,
      message,
      clientTurnId,
      correlationId: randomUUID(),
    });
  };
  world.scripts.push(() =>
    reading({
      reply: "Eighty-two percent gross margin, noted.",
      statements: [
        st({
          dimension: "company.business_model",
          quantity: "gross_margin",
          value: { kind: "PERCENT", percent: "82" },
          words: DECK,
        }),
      ],
    }),
  );
  await say("halyard-t2", DECK);
  // The live record holds the accounts figure cut at its decimal point,
  // as two notes of one turn (the splitter fixed since, 9cf769860).
  world.scripts.push(() =>
    reading({
      reply: "Thanks.",
      statements: [
        st({
          dimension: "application.note",
          value: { kind: "TEXT", text: CUT_LEFT },
          words: CUT_LEFT,
        }),
        st({
          dimension: "application.note",
          value: { kind: "TEXT", text: CUT_RIGHT },
          words: CUT_RIGHT,
        }),
      ],
    }),
  );
  await say("halyard-t4", ACCOUNTS);
  const rows = world.store().statementRows;
  const id = (words: string) => {
    const found = rows.find((s) => s.words === words);
    if (found === undefined) throw new Error(`no statement "${words}"`);
    return found.id;
  };
  return {
    world,
    say,
    deck: id(DECK),
    left: id(CUT_LEFT),
    right: id(CUT_RIGHT),
  };
}

const viewOf = (world: ReturnType<typeof statementWorld>) => {
  const store = world.store();
  return projectView(store.statementRows, store.linkRows, store.eventRows);
};
const current = (world: ReturnType<typeof statementWorld>) =>
  new Set(
    viewOf(world).dimensions.flatMap((d) => d.items.map((i) => i.statementId)),
  );
const lastQ = (world: ReturnType<typeof statementWorld>) =>
  world
    .store()
    .turnRows.filter((t) => t.role === "Q")
    .at(-1)?.text ?? "";

describe("the live correction turn, replayed with its stored reading", () => {
  it("supersedes both halves of the cut note, keeps them as history, and lets Q say so", async () => {
    const { world, say, deck, left, right } = await halyard();
    const before = world.store().statementRows.length;
    // The stored reading: a correction, with nothing filed (the turn's
    // figures were kept as notes in the founder's words).
    world.scripts.push(() =>
      reading({ reply: LIVE_REPLY, intent: "CORRECTION" }),
    );
    await say("halyard-t8", CORRECTION);

    const store = world.store();
    const turn = store.turnRows.find((t) => t.text === CORRECTION);
    const whole = store.statementRows.find(
      (s) => s.sourceTurnId === turn?.id && s.words.includes("29.3%"),
    );
    expect(whole).toBeDefined();
    const corrects = store.linkRows.filter((l) => l.kind === "CORRECTS");
    expect(
      corrects
        .filter((l) => l.fromStatementId === whole?.id)
        .map((l) => l.toStatementId)
        .sort(),
    ).toEqual([left, right].sort());
    for (const l of corrects.filter((c) => c.fromStatementId === whole?.id)) {
      expect(l.origin).toBe("CODE_DETECTED");
      expect(l.sourceTurnId).toBe(turn?.id);
    }
    // History, never deleted.
    expect(store.statementRows.length).toBeGreaterThan(before);
    expect(store.statementRows.map((s) => s.id)).toEqual(
      expect.arrayContaining([left, right, deck]),
    );
    const now = current(world);
    expect(now.has(left)).toBe(false);
    expect(now.has(right)).toBe(false);
    const note = viewOf(world).dimensions.find(
      (d) => d.dimension === "application.note",
    );
    expect(note?.superseded.map((s) => s.item.statementId).sort()).toEqual(
      [left, right].sort(),
    );
    // The deck's figure is not what this correction named as cut: it stays.
    expect(now.has(deck)).toBe(true);
    // Q's claim stands: the record holds the correction.
    expect(lastQ(world)).toContain("treat this as correcting");
    expect(lastQ(world)).not.toContain(NOT_CORRECTED_LINE);
  });

  it("is idempotent: a retry of the same turn writes no second correction", async () => {
    const { world, say } = await halyard();
    world.scripts.push(() =>
      reading({ reply: LIVE_REPLY, intent: "CORRECTION" }),
    );
    await say("halyard-t8", CORRECTION);
    const links = world.store().linkRows.length;
    await say("halyard-t8", CORRECTION);
    expect(world.store().linkRows.length).toBe(links);
  });
});

// Live §8 (production 5d08eaaa0, audit 2026-11-16): the reader named both
// halves, one CORRECTS each, carrying the same correction words; the note
// was stored twice, identically, one copy linked to each half. One
// statement, linked to every statement it supersedes.
describe("one correction of two statements", () => {
  const NOTE =
    "Our management accounts for the 12 months to October 2026 show a gross margin of 29.3%, not 29 and 3% as two notes.";

  it("stores the correction once and links it to each statement it supersedes", async () => {
    const { world, say, left, right } = await halyard();
    world.scripts.push((prompt) =>
      reading({
        reply: "Understood: 29.3% is one figure.",
        intent: "CORRECTION",
        statements: [CUT_LEFT, CUT_RIGHT].map((cut) =>
          st({
            op: "CORRECTS",
            target: prompt.statement(cut),
            dimension: "application.note",
            value: { kind: "TEXT", text: NOTE },
            words: NOTE,
          }),
        ),
      }),
    );
    await say("halyard-t8", CORRECTION);

    const store = world.store();
    const turn = store.turnRows.find((t) => t.text === CORRECTION);
    const stored = store.statementRows.filter(
      (s) => s.sourceTurnId === turn?.id && s.words === NOTE,
    );
    expect(stored).toHaveLength(1);
    const corrects = store.linkRows.filter((l) => l.kind === "CORRECTS");
    expect(
      corrects
        .filter((l) => l.fromStatementId === stored[0]?.id)
        .map((l) => l.toStatementId)
        .sort(),
    ).toEqual([left, right].sort());
    const now = current(world);
    expect(now.has(left)).toBe(false);
    expect(now.has(right)).toBe(false);
    expect([...now].some((id) => id === stored[0]?.id)).toBe(true);
  });

  it("two corrections saying different things are still two statements", async () => {
    const { world, say, left, right } = await halyard();
    const OTHER = "The 82.0% in the pitch deck is licence margin.";
    world.scripts.push((prompt) =>
      reading({
        reply: "Understood.",
        intent: "CORRECTION",
        statements: [
          st({
            op: "CORRECTS",
            target: prompt.statement(CUT_LEFT),
            dimension: "application.note",
            value: { kind: "TEXT", text: NOTE },
            words: NOTE,
          }),
          st({
            op: "CORRECTS",
            target: prompt.statement(CUT_RIGHT),
            dimension: "application.note",
            value: { kind: "TEXT", text: OTHER },
            words: OTHER,
          }),
        ],
      }),
    );
    await say("halyard-t8", CORRECTION);
    const store = world.store();
    const turn = store.turnRows.find((t) => t.text === CORRECTION);
    const fresh = store.statementRows.filter(
      (s) =>
        s.sourceTurnId === turn?.id && (s.words === NOTE || s.words === OTHER),
    );
    expect(fresh).toHaveLength(2);
    const targets = store.linkRows
      .filter(
        (l) =>
          l.kind === "CORRECTS" &&
          fresh.some((f) => f.id === l.fromStatementId),
      )
      .map((l) => l.toStatementId)
      .sort();
    expect(targets).toEqual([left, right].sort());
  });
});

describe("Q's words about a correction are held to the record", () => {
  it("drops the claim and says plainly what it stored when nothing was corrected", async () => {
    const { world, say, left, right } = await halyard();
    // The same words read as an answer, not a correction: nothing is
    // superseded, so Q may not say it corrected anything.
    world.scripts.push(() => reading({ reply: LIVE_REPLY, intent: "ANSWER" }));
    await say("halyard-t8", CORRECTION);
    expect(world.store().linkRows.filter((l) => l.kind === "CORRECTS")).toEqual(
      [],
    );
    const now = current(world);
    expect(now.has(left)).toBe(true);
    expect(now.has(right)).toBe(true);
    const reply = lastQ(world);
    expect(reply).toContain(NOT_CORRECTED_LINE);
    expect(reply).not.toContain("treat this as correcting");
    // What was stored is still said: the figures kept as notes.
    expect(reply).toContain("in your words as a note");
  });

  it("recognises a claim of correction, not thanks for one", () => {
    expect(
      claimsCorrection(
        "I'll treat this as correcting the two partial notes, while keeping the distinction.",
      ),
    ).toBe(true);
    expect(claimsCorrection("I've replaced the 82% with 29.3%.")).toBe(true);
    expect(claimsCorrection("That corrects the earlier figure.")).toBe(true);
    expect(claimsCorrection("The earlier note has been superseded.")).toBe(
      true,
    );
    expect(claimsCorrection("Thanks for the correction.")).toBe(false);
    expect(
      claimsCorrection("Should I treat this as correcting the earlier note?"),
    ).toBe(false);
    expect(replyHeldToReading(LIVE_REPLY, 1, undefined, [], 1)).toBe(
      LIVE_REPLY,
    );
    expect(replyHeldToReading(LIVE_REPLY, 1, undefined, [], 0)).toBe(
      `${NOT_CORRECTED_LINE} Understood — 29.3% is one accounts figure, and the 82.0% figure is licence margin.`,
    );
  });
});

describe("gross margin as a number beside the deck's licence margin", () => {
  it("files 29.3% as gross margin, the deck's 82% as licence margin, and relates neither as one metric", async () => {
    const { world, say, deck, left, right } = await halyard();
    world.scripts.push(() =>
      reading({
        reply: LIVE_REPLY,
        intent: "CORRECTION",
        statements: [
          st({
            dimension: "company.business_model",
            quantity: "gross_margin",
            value: { kind: "PERCENT", percent: "29.3" },
            asOf: "2026-10-31",
            words:
              "our management accounts for the 12 months to October 2026 show a gross margin of 29.3%",
          }),
          // Licence margin is not on the closed metric list: a share of
          // nothing listed, kept in their words, related to nothing.
          st({
            dimension: "company.business_model",
            value: { kind: "PERCENT", percent: "82.0" },
            words: "The 82.0% in the pitch deck is licence margin.",
          }),
        ],
      }),
    );
    await say("halyard-t8", CORRECTION);
    const store = world.store();
    const margin = store.statementRows.find(
      (s) => s.quantity === "gross_margin" && s.asOf === "2026-10-31",
    );
    const licence = store.statementRows.find((s) =>
      s.words.includes("licence margin"),
    );
    expect(margin?.value).toEqual({ kind: "PERCENT", percent: "29.3" });
    expect(licence?.quantity).toBeNull();
    const corrects = store.linkRows.filter((l) => l.kind === "CORRECTS");
    expect(
      corrects
        .filter((l) => l.fromStatementId === margin?.id)
        .map((l) => l.toStatementId)
        .sort(),
    ).toEqual([left, right].sort());
    // The deck figure, recorded as gross margin, is the founder's own
    // statement restated as another measure: it becomes history.
    expect(
      corrects.filter((l) => l.fromStatementId === licence?.id),
    ).toMatchObject([{ toStatementId: deck }]);
    // No disagreement: different measures never relate (gateqRelatable).
    expect(store.linkRows.filter((l) => l.kind === "DISAGREES")).toEqual([]);
    if (margin === undefined || licence === undefined) throw new Error("rows");
    expect(relatable(margin, licence, { explicit: true })).toBe(false);
    const model = viewOf(world).dimensions.find(
      (d) => d.dimension === "company.business_model",
    );
    expect(model?.items.map((i) => i.statementId).sort()).toEqual(
      [margin.id, licence.id].sort(),
    );
    expect(model?.disagreements).toEqual([]);
  });

  it("records a disagreement when both figures are on record as gross margin", async () => {
    const { world, say, deck, left, right } = await halyard();
    // The reader filed the accounts figure but did not restate the deck's:
    // on record both are gross margin, for comparable periods, so the
    // relation rule holds and code links them DISAGREES. The cut note is
    // still corrected; the deck figure, not named as cut, is not.
    world.scripts.push(() =>
      reading({
        reply: "Understood.",
        intent: "CORRECTION",
        statements: [
          st({
            dimension: "company.business_model",
            quantity: "gross_margin",
            value: { kind: "PERCENT", percent: "29.3" },
            asOf: "2026-10-31",
            words:
              "our management accounts for the 12 months to October 2026 show a gross margin of 29.3%",
          }),
        ],
      }),
    );
    await say("halyard-t8", CORRECTION);
    const store = world.store();
    const margin = store.statementRows.find(
      (s) => s.quantity === "gross_margin" && s.asOf === "2026-10-31",
    );
    expect(
      store.linkRows
        .filter((l) => l.kind === "CORRECTS")
        .map((l) => l.toStatementId)
        .sort(),
    ).toEqual([left, right].sort());
    expect(store.linkRows.filter((l) => l.kind === "DISAGREES")).toMatchObject([
      {
        fromStatementId: margin?.id,
        toStatementId: deck,
        origin: "CODE_DETECTED",
      },
    ]);
    expect(current(world).has(deck)).toBe(true);
  });
});

describe("a correction of a metric with no figure on record named", () => {
  it("corrects the earlier figure for the same metric, only when read as a correction", async () => {
    // The label alone never hides a figure (live 78f8d72d5 t16 was labelled
    // a correction): the founder also says the earlier one was wrong.
    for (const intent of ["CORRECTION", "ANSWER"] as const) {
      const { world, say, deck } = await halyard();
      world.scripts.push(() =>
        reading({
          reply: "Thanks.",
          intent,
          statements: [
            st({
              dimension: "company.business_model",
              quantity: "gross_margin",
              value: { kind: "PERCENT", percent: "64" },
              words: "Our gross margin is 64%",
            }),
          ],
        }),
      );
      await say(
        "halyard-t9",
        "Our gross margin is 64%, I got that wrong earlier.",
      );
      const store = world.store();
      const corrects = store.linkRows.filter((l) => l.kind === "CORRECTS");
      if (intent === "CORRECTION") {
        // The deck's 82% is the earlier figure for the same metric; the
        // notes hold no metric and no cut figure of 64: untouched.
        expect(corrects.map((l) => l.toStatementId)).toEqual([deck]);
        expect(store.linkRows.filter((l) => l.kind === "DISAGREES")).toEqual(
          [],
        );
      } else {
        expect(corrects).toEqual([]);
        expect(
          store.linkRows.filter((l) => l.kind === "DISAGREES"),
        ).toHaveLength(1);
      }
    }
  });
});

describe("a second answer the reader labelled a correction", () => {
  it("hides no figure on the label alone", async () => {
    const { world, say, deck } = await halyard();
    world.scripts.push(() =>
      reading({
        reply: "Thanks.",
        intent: "CORRECTION",
        statements: [
          st({
            dimension: "company.business_model",
            quantity: "gross_margin",
            value: { kind: "PERCENT", percent: "64" },
            words: "about 64% gross margin",
          }),
        ],
      }),
    );
    await say("halyard-t9", "Back to margin: about 64% gross margin.");
    const store = world.store();
    expect(store.linkRows.filter((l) => l.kind === "CORRECTS")).toEqual([]);
    expect(store.linkRows.filter((l) => l.kind === "DISAGREES")).toMatchObject([
      { toStatementId: deck },
    ]);
    expect(lastQ(world)).not.toContain(NOT_CORRECTED_LINE);
  });
});
