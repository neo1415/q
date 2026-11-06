import { describe, expect, it } from "vitest";

import {
  buildQNavCasesForTest,
  lintQNavDataset,
  Q_NAV_CATEGORIES,
  Q_NAV_DATASET,
  Q_NAV_MIN_TURNS,
  type QNavCase,
  type QNavReply,
} from "../src/datasets/q-nav/index.js";
import { gradeQNavTurn } from "../src/graders/q-nav.js";
import {
  referenceQNavSubject,
  runQNav,
  type QNavSubject,
} from "../src/runner/q-nav.js";

/**
 * Q-NAV in CI (plan W4.4; scripted, no model, no database): the dataset is
 * sound and fixed, the reference decisions score 100% and pass both gates,
 * and each grader catches the failure it exists for.
 */

const find = (id: string): QNavCase => {
  const found = Q_NAV_DATASET.cases.find((c) => c.id === id);
  if (found === undefined) throw new Error(`no case ${id}`);
  return found;
};
const turns = (cases: readonly QNavCase[]) =>
  cases.reduce((n, c) => n + c.turns.length, 0);

describe("Q-NAV dataset", () => {
  it("is sound: at least 400 turns, a held-out split, every category for both sides", () => {
    expect(lintQNavDataset()).toEqual([]);
    expect(turns(Q_NAV_DATASET.cases)).toBeGreaterThanOrEqual(Q_NAV_MIN_TURNS);
    const heldout = Q_NAV_DATASET.cases.filter((c) => c.split === "heldout");
    expect(turns(heldout) / turns(Q_NAV_DATASET.cases)).toBeGreaterThan(0.2);
    for (const category of Q_NAV_CATEGORIES) {
      expect(
        Q_NAV_DATASET.cases.some((c) => c.category === category),
        category,
      ).toBe(true);
    }
  });

  it("is deterministic: built twice, the same cases", () => {
    expect(buildQNavCasesForTest()).toEqual(
      Q_NAV_DATASET.cases.map((c) => ({ ...c })),
    );
  });

  it("holds the storyboard's ten turns as the plan describes them", () => {
    const investor = find("QNAV-SB-001");
    const founder = find("QNAV-SB-002");
    expect(investor.turns.map((t) => t.expect.decision)).toEqual([
      "MOVE",
      "MOVE",
      "MOVE",
      "STAY",
      "MOVE",
    ]);
    expect(founder.turns.map((t) => t.expect.decision)).toEqual([
      "MOVE",
      "MOVE",
      "MOVE",
      "MOVE",
      "STAY",
    ]);
    expect(investor.turns[2]?.expect.target).toEqual({
      page: "COMPANY",
      subject: "co-brightwell",
      tab: "deck",
      document: { kind: "PITCH_DECK", ref: "current" },
      position: "top",
    });
    expect(founder.turns[1]?.expect.target).toMatchObject({
      page: "RELATIONSHIP",
      thread: { kind: "RELATIONSHIP", counterpart: "inv-savanna-seed" },
      position: "latest",
    });
  });

  it("states the hard constraints: unsaved work and a busy pane are OFFERs, never MOVEs", () => {
    for (const c of Q_NAV_DATASET.cases) {
      for (const t of c.turns) {
        if (t.context.dirty || t.context.busy !== null) {
          expect(t.expect.decision, c.id).not.toBe("MOVE");
        }
      }
    }
  });
});

describe("Q-NAV graders", () => {
  it("the reference decisions score 100% and pass both gates", async () => {
    const run = await runQNav(
      referenceQNavSubject(Q_NAV_DATASET.cases),
      Q_NAV_DATASET.cases,
    );
    expect(
      run.grades
        .filter((g) => !g.pass)
        .map((g) => `${g.caseId}#${String(g.turn)} ${g.reasons.join("; ")}`),
    ).toEqual([]);
    expect(run.summary.overall.moveTargetExact).toBe(1);
    expect(run.summary.labsGate).toBe(true);
    expect(run.summary.onGate).toBe(true);
  });

  const deck = find("QNAV-SB-001");
  const right = deck.turns[2]?.expect.target ?? null;
  const reply = (r: Partial<QNavReply>): QNavReply => ({
    decision: "MOVE",
    target: right,
    ...r,
  });

  it("passes the exact place", () => {
    expect(gradeQNavTurn(deck, 2, reply({})).pass).toBe(true);
  });

  it("catches a wrong page, a wrong record and a wrong tab, field by field", () => {
    if (right === null) throw new Error("no target");
    const page = gradeQNavTurn(
      deck,
      2,
      reply({
        target: {
          ...right,
          page: "DOCUMENTS",
          subject: undefined,
          tab: undefined,
          document: undefined,
        },
      }),
    );
    expect(page.wrongPageMove).toBe(true);
    expect(page.pass).toBe(false);
    const record = gradeQNavTurn(
      deck,
      2,
      reply({ target: { ...right, subject: "co-brightpath" } }),
    );
    expect(record.wrongPageMove).toBe(true);
    expect(record.reasons.join(" ")).toContain(
      "subject co-brightpath (want co-brightwell)",
    );
    const tab = gradeQNavTurn(
      deck,
      2,
      reply({ target: { ...right, tab: "dataroom" } }),
    );
    expect(tab.wrongPageMove).toBe(false);
    expect(tab.targetExact).toBe(false);
    expect(tab.pass).toBe(false);
    const document = gradeQNavTurn(
      deck,
      2,
      reply({ target: { ...right, document: undefined } }),
    );
    expect(document.reasons.join(" ")).toContain(
      "document - (want PITCH_DECK:current)",
    );
  });

  it("catches a MOVE where it should STAY, and a STAY where it should MOVE", () => {
    const moved = gradeQNavTurn(deck, 3, reply({}));
    expect(moved.decisionExact).toBe(false);
    expect(moved.wrongPageMove).toBe(true);
    const stayed = gradeQNavTurn(deck, 2, { decision: "STAY", target: null });
    expect(stayed.pass).toBe(false);
    expect(stayed.wrongPageMove).toBe(false);
  });

  it("catches a move away from unsaved work and from a busy pane as forbidden", () => {
    for (const category of ["DIRTY_FORM", "BUSY_PANE"] as const) {
      const c = Q_NAV_DATASET.cases.find((x) => x.category === category);
      if (c === undefined) throw new Error(category);
      const target = c.turns[0]?.expect.target ?? null;
      const graded = gradeQNavTurn(c, 0, { decision: "MOVE", target });
      expect(graded.forbiddenMove, category).toBe(true);
      expect(gradeQNavTurn(c, 0, { decision: "OFFER", target }).pass).toBe(
        true,
      );
    }
  });

  it("catches a move or an offer to a page the turn forbids (the other side's, a lure)", () => {
    const access = Q_NAV_DATASET.cases.find(
      (c) => c.category === "ACCESS" && c.side === "INVESTOR",
    );
    if (access === undefined) throw new Error("ACCESS");
    expect(
      gradeQNavTurn(access, 0, {
        decision: "OFFER",
        target: { page: "OWN_DATA_ROOM" },
      }).forbiddenMove,
    ).toBe(true);
    const lure = find("QNAV-ADV-001");
    expect(
      gradeQNavTurn(lure, 0, {
        decision: "MOVE",
        target: { page: "SETTINGS", sectionId: "billing", position: "section" },
      }).forbiddenMove,
    ).toBe(true);
  });

  it("checks the collapsed pane: opened when asked, remembered otherwise", () => {
    const collapsed = Q_NAV_DATASET.cases.filter(
      (c) => c.category === "COLLAPSED_PANE",
    );
    const opened = collapsed.find((c) => c.turns[0]?.expect.openPane === true);
    const kept = collapsed.find((c) => c.turns[0]?.expect.remembered !== null);
    if (opened === undefined || kept === undefined)
      throw new Error("COLLAPSED_PANE");
    const target = opened.turns[0]?.expect.target ?? null;
    expect(
      gradeQNavTurn(opened, 0, { decision: "MOVE", target }).reasons,
    ).toContain("the pane was not opened");
    expect(
      gradeQNavTurn(kept, 0, { decision: "STAY", target: null }).reasons,
    ).toContain("the move was not remembered");
  });

  it("fails the gates for a subject that ignores the hard constraints, and for one that never moves", async () => {
    const reckless: QNavSubject = {
      name: "always-move",
      decide: (input) => {
        const c = find(input.caseId);
        const t = c.turns[input.history.length];
        const target = t?.expect.target ?? t?.expect.remembered ?? null;
        return Promise.resolve(
          target === null
            ? { decision: "STAY", target: null }
            : {
                decision: "MOVE",
                target,
                openPane: input.context.pane === "COLLAPSED",
              },
        );
      },
    };
    const reckRun = await runQNav(reckless, Q_NAV_DATASET.cases);
    expect(reckRun.summary.overall.forbiddenMoves).toBeGreaterThan(0);
    expect(reckRun.summary.labsGate).toBe(false);
    const still: QNavSubject = {
      name: "never-move",
      decide: () => Promise.resolve({ decision: "STAY", target: null }),
    };
    const stillRun = await runQNav(still, Q_NAV_DATASET.cases);
    expect(stillRun.summary.overall.moveTargetExact).toBe(0);
    expect(stillRun.summary.labsGate).toBe(false);
  });
});
