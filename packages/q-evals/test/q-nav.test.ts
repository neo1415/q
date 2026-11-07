import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  intentToNavigateTarget,
  navigateTargetToIntent,
  QNavigateTargetSchema,
} from "@capital-q/contracts";

import {
  buildQNavCases,
  lintQNavDataset,
  navCompany,
  Q_NAV_CATEGORIES,
  Q_NAV_DATASET,
  Q_NAV_MIN_HELDOUT_SHARE,
  Q_NAV_MIN_TURNS,
  type QNavCase,
  type QNavReply,
  type QNavTarget,
} from "../src/datasets/q-nav/index.js";
import { Q_NAV_HELDOUT_SEAL } from "../src/datasets/q-nav/heldout-seal.js";
import { canonicalTarget, gradeQNavTurn } from "../src/graders/q-nav.js";
import {
  naiveReferenceProposer,
  navigationPipelineSubject,
  referenceQNavSubject,
  runQNav,
  type QNavSubject,
} from "../src/runner/q-nav.js";

/**
 * Q-NAV in CI (plan W4.4; owner direction 6 Nov 2026 ~22:50): scripted,
 * no model, no database. The dataset covers the whole site from the
 * contracts, holds out >= 30% written separately, its targets are W3.1's
 * QNavigateTarget exactly, the reference scores 100% on both gates, and
 * each grader catches the failure it exists for.
 */

const turns = (cases: readonly QNavCase[]) =>
  cases.reduce((n, c) => n + c.turns.length, 0);
const first = (pred: (c: QNavCase) => boolean): QNavCase => {
  const found = Q_NAV_DATASET.cases.find(pred);
  if (found === undefined) throw new Error("no such case");
  return found;
};

describe("Q-NAV dataset", () => {
  it("is sound: the whole site for both sides, >= 400 turns, >= 30% held out, every category in both splits", () => {
    expect(lintQNavDataset()).toEqual([]);
    expect(turns(Q_NAV_DATASET.cases)).toBeGreaterThanOrEqual(Q_NAV_MIN_TURNS);
    const held = Q_NAV_DATASET.cases.filter((c) => c.split === "heldout");
    expect(turns(held) / turns(Q_NAV_DATASET.cases)).toBeGreaterThanOrEqual(
      Q_NAV_MIN_HELDOUT_SHARE,
    );
    for (const category of Q_NAV_CATEGORIES) {
      for (const split of ["dev", "heldout"] as const) {
        expect(
          Q_NAV_DATASET.cases.some(
            (c) => c.category === category && c.split === split,
          ),
          `${category} ${split}`,
        ).toBe(true);
      }
    }
  });

  it("holds out what it never shows the dev set: no held-out sentence is a dev sentence", () => {
    const dev = new Set(
      Q_NAV_DATASET.cases
        .filter((c) => c.split === "dev")
        .flatMap((c) => c.turns.map((t) => t.user.toLowerCase())),
    );
    const repeated = Q_NAV_DATASET.cases
      .filter((c) => c.split === "heldout")
      .flatMap((c) => c.turns.map((t) => t.user))
      .filter((user) => dev.has(user.toLowerCase()));
    expect(repeated).toEqual([]);
  });

  it("keeps the held-out split sealed: its cases hash to the recorded seal", () => {
    const held = Q_NAV_DATASET.cases.filter((c) => c.split === "heldout");
    expect({
      sha256: createHash("sha256").update(JSON.stringify(held)).digest("hex"),
      turns: turns(held),
    }).toEqual({
      sha256: Q_NAV_HELDOUT_SEAL.sha256,
      turns: Q_NAV_HELDOUT_SEAL.turns,
    });
  });

  it("is deterministic: built twice, the same cases", () => {
    expect(buildQNavCases()).toEqual([...Q_NAV_DATASET.cases]);
  });

  it("names every place as W3.1's QNavigateTarget, which round-trips through its intents", () => {
    for (const c of Q_NAV_DATASET.cases) {
      for (const t of c.turns) {
        for (const target of [
          t.expect.target,
          t.expect.remembered,
          t.context.at,
          t.context.previous,
        ]) {
          if (target === null) continue;
          expect(QNavigateTargetSchema.safeParse(target).success, c.id).toBe(
            true,
          );
          expect(
            intentToNavigateTarget(navigateTargetToIntent(target)),
            c.id,
          ).toEqual(target);
        }
      }
    }
  });

  it("states the hard constraints: unsaved work and a busy pane are never a MOVE", () => {
    for (const c of Q_NAV_DATASET.cases)
      for (const t of c.turns)
        if (t.context.dirty || t.context.busy !== null)
          expect(t.expect.decision, c.id).not.toBe("MOVE");
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
    expect(run.summary.labsGate).toBe(true);
    expect(run.summary.onGate).toBe(true);
  });

  const silo = navCompany("co-silo-credit");
  it("grades one place by one name: aliases are the same place", () => {
    const same = (
      a: QNavTarget,
      b: QNavTarget,
      side: "INVESTOR" | "FOUNDER" = "INVESTOR",
    ) => expect(canonicalTarget(a, side)).toEqual(canonicalTarget(b, side));
    same(
      { page: "COMPANY_DECK", recordId: silo.id },
      { page: "COMPANY", recordId: silo.id, tab: "deck" },
    );
    const doc = silo.documents[0]?.id ?? "";
    same(
      { page: "DATA_ROOM_DOCUMENT", recordId: doc, companyId: silo.id },
      { page: "COMPANY", recordId: silo.id, tab: "dataroom", documentId: doc },
    );
    same(
      { page: "RELATIONSHIP_COMPANY", recordId: silo.id, tab: "messages" },
      { page: "RELATIONSHIP_COMPANY_MESSAGES", recordId: silo.id },
    );
    same({ page: "SEARCH" }, { page: "EXPLORE" });
    same({ page: "GATEWAY" }, { page: "GATEQ_INBOX" });
    same({ page: "GATEWAY" }, { page: "GATEQ_APPLICATIONS" }, "FOUNDER");
    same({ page: "CAPITAL", position: "top" }, { page: "CAPITAL" });
    same(
      { page: "MANDATE" },
      { page: "PROFILE", sectionId: "mandate", position: "section" },
    );
    expect(canonicalTarget({ page: "GATEWAY" }, "FOUNDER")).not.toEqual(
      canonicalTarget({ page: "GATEQ_INBOX" }, "FOUNDER"),
    );
  });

  const deckCase = first(
    (c) =>
      c.split === "dev" &&
      c.turns[0]?.expect.target?.tab === "deck" &&
      c.turns[0]?.expect.target?.slide === undefined &&
      c.turns[0]?.context.dirty === false &&
      c.turns[0]?.context.busy === null &&
      c.turns[0]?.expect.decision === "MOVE",
  );
  const right = deckCase.turns[0]?.expect.target ?? null;
  const reply = (r: Partial<QNavReply>): QNavReply => ({
    decision: "MOVE",
    target: right,
    ...r,
  });

  it("passes the exact place, and the same place by an alias", () => {
    if (right === null) throw new Error("no target");
    expect(gradeQNavTurn(deckCase, 0, reply({})).pass).toBe(true);
    expect(
      gradeQNavTurn(
        deckCase,
        0,
        reply({
          target: { page: "COMPANY_DECK", recordId: right.recordId ?? "" },
        }),
      ).pass,
    ).toBe(true);
  });

  it("catches a wrong page, a wrong record, a wrong tab and a wrong slide, field by field", () => {
    if (right === null) throw new Error("no target");
    const page = gradeQNavTurn(
      deckCase,
      0,
      reply({ target: { page: "DOCUMENTS" } }),
    );
    expect(page.wrongPageMove).toBe(true);
    const record = gradeQNavTurn(
      deckCase,
      0,
      reply({
        target: {
          ...right,
          recordId:
            silo.id === right.recordId
              ? navCompany("co-silo-health").id
              : silo.id,
        },
      }),
    );
    expect(record.wrongPageMove).toBe(true);
    const tab = gradeQNavTurn(
      deckCase,
      0,
      reply({ target: { ...right, tab: "dataroom" } }),
    );
    expect(tab.wrongPageMove).toBe(false);
    expect(tab.pass).toBe(false);
    const slide = gradeQNavTurn(
      deckCase,
      0,
      reply({ target: { ...right, slide: 3 } }),
    );
    expect(slide.reasons.join(" ")).toContain("slide 3 (want -)");
  });

  it("catches a MOVE where it should STAY, and a STAY where it should MOVE", () => {
    const stayCase = first(
      (c) => c.category === "STAY_IN_CHAT" && c.split === "dev",
    );
    const moved = gradeQNavTurn(stayCase, 0, reply({}));
    expect(moved.wrongPageMove).toBe(true);
    expect(
      gradeQNavTurn(deckCase, 0, { decision: "STAY", target: null }).pass,
    ).toBe(false);
  });

  it("catches a move away from unsaved work or a busy pane, a lure and the other side's page as forbidden", () => {
    for (const category of ["DIRTY_FORM", "BUSY_PANE"] as const) {
      const c = first((x) => x.category === category);
      const target = c.turns[0]?.expect.target ?? null;
      expect(
        gradeQNavTurn(c, 0, { decision: "MOVE", target }).forbiddenMove,
        category,
      ).toBe(true);
      expect(
        gradeQNavTurn(c, 0, { decision: "OFFER", target }).pass,
        category,
      ).toBe(true);
    }
    const lure = first(
      (c) =>
        c.category === "ADVERSARIAL" &&
        c.turns[0]?.expect.forbiddenPages.includes("SETTINGS") === true,
    );
    expect(
      gradeQNavTurn(lure, 0, {
        decision: "MOVE",
        target: { page: "SETTINGS", sectionId: "billing", position: "section" },
      }).forbiddenMove,
    ).toBe(true);
    const access = first(
      (c) => c.category === "ACCESS" && c.side === "INVESTOR",
    );
    expect(
      gradeQNavTurn(access, 0, {
        decision: "OFFER",
        target: { page: "OWN_DATA_ROOM" },
      }).forbiddenMove,
    ).toBe(true);
  });

  it("checks a collapsed pane: opened when asked, remembered otherwise", () => {
    const opened = first((c) => c.turns[0]?.expect.openPane === true);
    const kept = first(
      (c) =>
        c.turns[0]?.expect.remembered !== null &&
        c.turns[0]?.expect.remembered !== undefined,
    );
    expect(
      gradeQNavTurn(opened, 0, {
        decision: "MOVE",
        target: opened.turns[0]?.expect.target ?? null,
      }).reasons,
    ).toContain("the pane was not opened");
    expect(
      gradeQNavTurn(kept, 0, { decision: "STAY", target: null }).reasons,
    ).toContain("the move was not remembered");
  });

  it("fails the gates for a subject that ignores the guards, and for one that never moves", async () => {
    const byId = new Map(Q_NAV_DATASET.cases.map((c) => [c.id, c]));
    const reckless: QNavSubject = {
      name: "always-move",
      decide: (input) => {
        const t = byId.get(input.caseId)?.turns[input.history.length];
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
    const reck = await runQNav(reckless, Q_NAV_DATASET.cases);
    expect(reck.summary.overall.forbiddenMoves).toBeGreaterThan(0);
    expect(reck.summary.labsGate).toBe(false);
    const still: QNavSubject = {
      name: "never-move",
      decide: () => Promise.resolve({ decision: "STAY", target: null }),
    };
    const run = await runQNav(still, Q_NAV_DATASET.cases);
    expect(run.summary.overall.moveTargetExact).toBe(0);
    expect(run.summary.labsGate).toBe(false);
  });
});

describe("Q-NAV through the W4 pipeline (resolution and hard constraints in code)", () => {
  it("a proposer that ignores every guard still lands exactly: code resolves the ids and enforces the constraints", async () => {
    const run = await runQNav(
      navigationPipelineSubject(
        "w4:naive-proposer",
        naiveReferenceProposer(Q_NAV_DATASET.cases),
      ),
      Q_NAV_DATASET.cases,
    );
    expect(
      run.grades
        .filter((g) => !g.pass)
        .map((g) => `${g.caseId}#${String(g.turn)} ${g.reasons.join("; ")}`),
    ).toEqual([]);
    expect(run.summary.overall.forbiddenMoves).toBe(0);
    expect(run.summary.labsGate).toBe(true);
    expect(run.summary.onGate).toBe(true);
  });

  it("below the gate (config), every MOVE becomes an OFFER: no autonomous move at all", async () => {
    const run = await runQNav(
      navigationPipelineSubject(
        "w4:gated",
        naiveReferenceProposer(Q_NAV_DATASET.cases),
        { movesAllowed: false },
      ),
      Q_NAV_DATASET.cases,
    );
    expect(
      run.grades.filter((g) => g.decided === "MOVE" && g.expected !== "MOVE"),
    ).toEqual([]);
    expect(
      run.grades.some(
        (g) =>
          g.decided === "MOVE" &&
          !g.reasons.includes("the pane was not opened") &&
          g.category !== "COLLAPSED_PANE",
      ),
    ).toBe(false);
    expect(run.summary.overall.forbiddenMoves).toBe(0);
  });
});
