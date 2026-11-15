import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";
import {
  GateqDossierSchema,
  gateqDossierAsReadNow,
  gateqStandingDisagreements,
  gateqStatementIdentities,
  gateqStatementsInWords,
} from "@capital-q/contracts";
import {
  createPromptRegistry,
  PROMPT_DEFINITIONS,
  type GateQStatementOpV3 as GateQStatementOp,
} from "@capital-q/q-core";

import type {
  ApplicationStatement,
  ApplicationStatementView,
  StatementLink,
} from "../src/contracts/statements.js";
import {
  claimsLeftOpen,
  claimsRecording,
  claimsUpdate,
  figuresIn,
  metricOfUnit,
  NOT_LEFT_OPEN_LINE,
  unfiledFigureLine,
  unitFits,
} from "../src/application/statement-plan.js";
import {
  coverageFromView,
  statementViewDto,
} from "../src/application/statement-words.js";
import {
  answerKey,
  NEVER_ASKED_AGAIN,
  dimensionView,
  projectView,
  relatable,
} from "../src/application/statement-view.js";
import {
  reading,
  statementWorld,
  type PromptSeen,
  type Script,
} from "./support/statement-world.js";
import { factsFromAnswers } from "../src/domain/form-answers.js";

/**
 * The live relation replay (root cause 2026-11-14,
 * docs/ai-handoff/audits/2026-11-14-gateq-root-cause.md).
 *
 * Every failing founder turn of the three live GateQ runs (1f9e33016,
 * d2ce8c91e, 06910b145), in the founders' own words from the audit, with
 * the reading the live model actually gave (its misreadings included: a
 * range split in two, "nobody pays" read only as paying customers, CAC
 * as an unknown with no metric, a share read as users, a repeated "leave
 * it open" read as a note). Through the real conversation, intake and
 * interviewer services. After every turn the eight invariants hold, and
 * the relation rule holds for every disagreement any reader would show.
 */

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

type Turn = {
  readonly id: string;
  /** Which live run the turn and its reading come from. */
  readonly run:
    | "1f9e33016"
    | "d2ce8c91e"
    | "06910b145"
    | "78f8d72d5"
    | "30c99ccc5"
    | "318577a8e"
    | "5757518c7"
    | "64637e8c9"
    | "84ac9afa7";
  readonly say: string;
  readonly script: Script;
  readonly resumeBefore?: true;
};

const TURNS: readonly Turn[] = [
  {
    id: "r-01",
    run: "06910b145",
    say: "We're Quilla, exam prep for Kenyan secondary schools, based in Nairobi, Kenya.",
    script: () =>
      reading({
        reply: "Quilla, got it. What stage are you at?",
        asking: "company.stage",
        statements: [
          st({
            dimension: "company.name",
            value: { kind: "TEXT", text: "Quilla" },
            words: "We're Quilla",
          }),
          st({
            dimension: "company.country",
            value: { kind: "CODE", code: "KE" },
            words: "based in Nairobi, Kenya",
          }),
        ],
      }),
  },
  {
    id: "r-02",
    run: "06910b145",
    say: "We're at seed.",
    script: () =>
      reading({
        reply: "Seed. How many students use it?",
        asking: "claims.traction",
        statements: [
          st({
            dimension: "company.stage",
            value: { kind: "CODE", code: "seed" },
            words: "We're at seed",
          }),
        ],
      }),
  },
  {
    id: "r-02a",
    run: "1f9e33016",
    say: "We're raising USD 350,000.",
    script: () =>
      reading({
        reply: "USD 350,000. How many students use it?",
        statements: [
          st({
            dimension: "raise.amount",
            quantity: "raise_amount",
            value: { kind: "MONEY", amount: "350000", currency: "USD" },
            words: "raising USD 350,000",
          }),
        ],
      }),
  },
  {
    // Every run: the one real correction, which must hide only its target.
    id: "r-02b",
    run: "1f9e33016",
    say: "Actually we're raising $400k, not $350k.",
    script: (prompt) =>
      reading({
        reply: "USD 400,000, then.",
        intent: "CORRECTION",
        statements: [
          st({
            op: "CORRECTS",
            target: prompt.statement("raising USD 350,000"),
            dimension: "raise.amount",
            quantity: "raise_amount",
            value: { kind: "MONEY", amount: "400000", currency: "USD" },
            words: "we're raising $400k, not $350k",
          }),
        ],
      }),
  },
  {
    id: "r-03",
    run: "06910b145",
    say: "2,300 students signed up and 600 weekly active.",
    script: () =>
      reading({
        reply: "Good base. Is anyone paying yet?",
        asking: "claims.revenue",
        statements: [
          st({
            dimension: "claims.traction",
            quantity: "users",
            value: { kind: "COUNT", count: "2300" },
            words: "2,300 students signed up",
          }),
          st({
            dimension: "claims.traction",
            quantity: "weekly_active_users",
            value: { kind: "COUNT", count: "600" },
            words: "600 weekly active",
          }),
        ],
      }),
  },
  {
    // Live t6: read only as paying customers = 0; revenue was asked 5 more
    // times, then the period of the zero.
    id: "r-04",
    run: "06910b145",
    say: "Nobody pays yet.",
    script: () =>
      reading({
        reply: "Understood. How many partner schools do you work with?",
        asking: "company.customers",
        statements: [
          st({
            dimension: "claims.traction",
            quantity: "paying_customers",
            value: { kind: "ZERO" },
            words: "Nobody pays yet",
          }),
        ],
      }),
  },
  {
    // Live t8: one sentence split into pilots=1 and pilots=4, then
    // code-detected as DISAGREES.
    id: "r-05",
    run: "06910b145",
    say: "We went from 1 partner school to 4 since March.",
    script: () =>
      reading({
        reply: "Four schools since March. What's your CAC?",
        asking: "claims.traction",
        statements: [
          st({
            dimension: "claims.traction",
            quantity: "pilots",
            value: { kind: "COUNT", count: "1" },
            words: "We went from 1 partner school",
          }),
          st({
            dimension: "claims.traction",
            quantity: "pilots",
            value: { kind: "COUNT", count: "4" },
            words: "to 4 since March",
          }),
        ],
      }),
  },
  {
    id: "r-06",
    run: "1f9e33016",
    say: "Honestly we're really a Series A company now, not seed.",
    script: (prompt) =>
      reading({
        reply: "Series A, then.",
        intent: "CORRECTION",
        statements: [
          st({
            op: "CORRECTS",
            target: prompt.statement("We're at seed"),
            dimension: "company.stage",
            value: { kind: "CODE", code: "series_a" },
            words: "really a Series A company now, not seed",
          }),
        ],
      }),
  },
  {
    // Live run 1: an undated second figure read as NEW; it must be found
    // (different turns, same metric, no dates).
    id: "r-07",
    run: "1f9e33016",
    say: "About 1,500 weekly active now.",
    script: () =>
      reading({
        reply: "That's different from the 600 you mentioned: which is right?",
        asking: "claims.traction",
        statements: [
          st({
            dimension: "claims.traction",
            quantity: "weekly_active_users",
            value: { kind: "COUNT", count: "1500" },
            words: "About 1,500 weekly active now",
            provenance: "ESTIMATED",
          }),
        ],
      }),
  },
  {
    // Live t10: an UNKNOWN on traction with no metric was swallowed into a
    // LEAVE_OPEN on another metric's disagreement.
    id: "r-08",
    run: "06910b145",
    say: "We don't know our CAC yet.",
    script: () =>
      reading({
        reply: "Fine. What will the round pay for?",
        intent: "UNKNOWN_OR_SKIP",
        asking: "raise.use_of_funds",
        statements: [
          st({
            dimension: "claims.traction",
            value: { kind: "UNKNOWN", declined: false },
            words: "We don't know our CAC yet",
            provenance: "UNKNOWN",
          }),
        ],
      }),
  },
  {
    // P3: a share read as a number of users.
    id: "r-09",
    run: "06910b145",
    say: "40 percent of signed-up students are girls.",
    script: () =>
      reading({
        reply: "Useful. What will the round pay for?",
        asking: "raise.use_of_funds",
        statements: [
          st({
            dimension: "claims.traction",
            quantity: "users",
            value: { kind: "PERCENT", percent: "40" },
            words: "40 percent of signed-up students are girls",
          }),
        ],
      }),
  },
  {
    // Runs 1 and 2: "leave it open" read as an UNKNOWN NEW on the metric.
    id: "r-10",
    run: "d2ce8c91e",
    say: "Leave it open for now.",
    script: () =>
      reading({
        reply: "I'll leave those two weekly-active figures open.",
        intent: "UNKNOWN_OR_SKIP",
        statements: [
          st({
            dimension: "claims.traction",
            quantity: "weekly_active_users",
            value: { kind: "UNKNOWN", declined: false },
            words: "Leave it open for now",
            provenance: "UNKNOWN",
          }),
        ],
      }),
  },
  {
    id: "r-11",
    run: "06910b145",
    say: "Our lead angel calls us seed by revenue, Series A by age; not sure which is right.",
    script: (prompt) =>
      reading({
        reply: "Which description should I use?",
        asking: "company.stage",
        statements: [
          st({
            op: "DISAGREES",
            target: prompt.statement("really a Series A company now"),
            dimension: "company.stage",
            value: {
              kind: "TEXT",
              text: "seed by revenue, Series A by age",
            },
            words: "calls us seed by revenue, Series A by age",
          }),
        ],
      }),
  },
  {
    id: "r-12",
    run: "06910b145",
    say: "Leave the stage open for now.",
    script: (prompt) =>
      reading({
        reply: "I'll leave the stage unresolved for Kilima to judge.",
        disagreementActions: [
          {
            disagreement: prompt.disagreement("company.stage"),
            action: "LEAVE_OPEN",
            keep: null,
          },
        ],
      }),
  },
  {
    // Live t34: "Revenue is zero today... as I said", then t35 asked the
    // zero's period.
    id: "r-13",
    run: "06910b145",
    say: "Revenue is zero today, as I said.",
    script: () =>
      reading({
        reply: "Thanks. Who else is on the team?",
        asking: "company.team",
        statements: [
          st({
            dimension: "claims.revenue",
            value: { kind: "TEXT", text: "Revenue is zero today" },
            words: "Revenue is zero today",
          }),
        ],
      }),
  },
  {
    // Live t38/t40, after closing the browser: a repeat read as a note;
    // Q's true sentence was replaced by a false denial.
    id: "r-14",
    run: "06910b145",
    resumeBefore: true,
    say: "Leave it open for now.",
    script: () =>
      reading({
        reply: "I'll keep both dashboard figures open for Kilima.",
        statements: [
          st({
            dimension: "application.note",
            value: { kind: "TEXT", text: "Leave it open for now." },
            words: "Leave it open for now.",
          }),
        ],
      }),
  },
  {
    // The same repeat as prompt v8 reads it: an action, never a note.
    id: "r-15",
    run: "06910b145",
    say: "Still leave it open for Kilima.",
    script: (prompt) =>
      reading({
        reply: "Both stay open for Kilima.",
        disagreementActions: [
          {
            disagreement: prompt.disagreement("claims.traction"),
            action: "LEAVE_OPEN",
            keep: null,
          },
        ],
      }),
  },
  {
    id: "r-16",
    run: "06910b145",
    say: "We're 6 people.",
    script: () =>
      reading({
        reply: "Six. What does each do?",
        statements: [
          st({
            dimension: "company.team",
            quantity: "employees",
            value: { kind: "COUNT", count: "6" },
            words: "We're 6 people",
          }),
        ],
      }),
  },
  {
    // A "left open" claim while an OPEN disagreement stands and nothing
    // was left open: the claim is replaced by the truth.
    id: "r-17",
    run: "06910b145",
    say: "Actually we're 9 people now, counting contractors.",
    script: () =>
      reading({
        reply: "I'll leave the team size open.",
        statements: [
          st({
            dimension: "company.team",
            quantity: "employees",
            value: { kind: "COUNT", count: "9" },
            words: "we're 9 people now, counting contractors",
          }),
        ],
      }),
  },
];

type World = ReturnType<typeof statementWorld>;

function viewOf(world: World): ApplicationStatementView {
  const { statementRows, linkRows, eventRows } = world.store();
  return projectView(statementRows, linkRows, eventRows);
}

const byWords = (world: World, words: string) => {
  const found = world.store().statementRows.find((s) => s.words === words);
  if (found === undefined) throw new Error(`no statement "${words}"`);
  return found;
};

const qReply = (world: World, id: string) =>
  world.store().turnRows.find((t) => t.role === "Q" && t.clientTurnId === id)
    ?.text ?? "";

const standing = (view: ApplicationStatementView) => {
  const seen = new Map<
    string,
    ApplicationStatementView["dimensions"][number]["disagreements"][number]
  >();
  for (const entry of view.dimensions)
    for (const d of entry.disagreements)
      if (d.active && d.state !== "RESOLVED") seen.set(d.key, d);
  return [...seen.values()];
};

/** The invariants that must hold after every replayed turn. */
function assertAfterTurn(
  world: World,
  turn: Turn,
  view: ApplicationStatementView,
  before: ApplicationStatementView,
  prompted: boolean,
): void {
  const store = world.store();
  const byId = new Map(store.statementRows.map((s) => [s.id, s] as const));

  // 1. Every answered PERSON turn has exactly one reading, and every
  //    statement it lists names that turn.
  for (const person of store.turnRows.filter((t) => t.role === "PERSON")) {
    const readings = store.readingRows.filter((r) => r.turnId === person.id);
    expect(readings.length, person.clientTurnId).toBe(1);
    for (const id of readings[0]?.recordedStatementIds ?? [])
      expect(byId.get(id)?.sourceTurnId).toBe(person.id);
  }

  // 3. The relation rule: every disagreement a reader would show is
  //    between two held values about the same metric, said in different
  //    turns. Nothing else is ever a disagreement.
  for (const d of standing(view)) {
    const older = byId.get(d.olderStatementId);
    const newer = byId.get(d.newerStatementId);
    expect(older && newer, d.key).toBeTruthy();
    if (older === undefined || newer === undefined) continue;
    const link = store.linkRows.find((l) => l.id === d.linkId);
    expect(
      relatable(older, newer, {
        explicit: link !== undefined && link.origin !== "CODE_DETECTED",
      }),
      `${older.words} / ${newer.words}`,
    ).toBe(true);
    expect(older.value.kind).not.toBe("UNKNOWN");
    expect(newer.value.kind).not.toBe("UNKNOWN");
    expect(older.sourceTurnId).not.toBe(newer.sourceTurnId);
  }
  // Every stored DISAGREES link written by code obeys the same rule.
  for (const link of store.linkRows.filter(
    (l): l is StatementLink => l.kind === "DISAGREES",
  )) {
    const from = byId.get(link.fromStatementId) as ApplicationStatement;
    const to = byId.get(link.toStatementId) as ApplicationStatement;
    expect(
      relatable(from, to, { explicit: link.origin !== "CODE_DETECTED" }),
      `${from.words} / ${to.words}`,
    ).toBe(true);
  }
  // Every LEFT_OPEN event is on a disagreement that was standing.
  for (const event of store.eventRows) {
    const link = store.linkRows.find((l) => l.id === event.linkId);
    expect(link?.kind).toBe("DISAGREES");
  }

  // 4 and 5. What Q was told to ask (from the view before the turn): never
  //    a settled, zero, declined or left-open dimension; a zero is never
  //    asked for its period.
  if (prompted) {
    const prompt = world.prompts.at(-1);
    for (const need of prompt?.needs() ?? []) {
      const status = dimensionView(
        before,
        need.dimension as Parameters<typeof dimensionView>[1],
      ).status;
      const followUp =
        status === "SETTLED" && need.reason === "needs_specifics";
      expect(
        NEVER_ASKED_AGAIN.has(status) && !followUp,
        `${turn.id}: ${need.dimension} (${status}) asked again`,
      ).toBe(false);
      if (need.dimension === "claims.revenue")
        expect(
          dimensionView(before, "claims.revenue").items.some(
            (i) => i.value.kind === "ZERO",
          ),
          `${turn.id}: revenue asked after a stated zero`,
        ).toBe(false);
    }
  }

  // 7. Q's claims stand only on recorded state.
  const reply = qReply(world, turn.id);
  if (claimsLeftOpen(reply)) {
    const states = standing(view).map((d) => d.state);
    expect(states, `${turn.id}: "${reply}"`).toContain("LEFT_OPEN");
  }
  if (claimsRecording(reply)) {
    const person = store.turnRows.find(
      (t) => t.role === "PERSON" && t.clientTurnId === turn.id,
    );
    const r = store.readingRows.find((x) => x.turnId === person?.id);
    expect((r?.recordedStatementIds.length ?? 0) > 0).toBe(true);
  }
}

/** What each replayed live defect must now read as, after its turn. */
function assertTurnOutcome(
  world: World,
  id: string,
  view: ApplicationStatementView,
): void {
  const store = world.store();
  const traction = dimensionView(view, "claims.traction");
  const disagreementsOn = (quantity: string) =>
    standing(view).filter(
      (d) =>
        store.statementRows.find((s) => s.id === d.newerStatementId)
          ?.quantity === quantity,
    );
  switch (id) {
    case "r-04": {
      // "Nobody pays yet" settles revenue as a stated zero, in their words.
      const revenue = dimensionView(view, "claims.revenue");
      expect(revenue.status).toBe("ZERO");
      expect(revenue.items[0]?.words).toBe("Nobody pays yet");
      break;
    }
    case "r-05":
      // A change said once is never a disagreement.
      expect(disagreementsOn("pilots")).toEqual([]);
      expect(store.linkRows.filter((l) => l.kind === "DISAGREES")).toHaveLength(
        0,
      );
      break;
    case "r-07":
      // Undated 600 vs about 1,500, from two turns, is found.
      expect(disagreementsOn("weekly_active_users")).toHaveLength(1);
      expect(disagreementsOn("weekly_active_users")[0]?.state).toBe("OPEN");
      break;
    case "r-08": {
      // CAC unknown is recorded as said, as CAC (named by name though the
      // reader gave no metric; v12's rule puts it on its own dimension,
      // live 64637e8c9); the WAU pair is untouched.
      const cac = byWords(world, "We don't know our CAC yet");
      expect(cac.value.kind).toBe("UNKNOWN");
      expect(cac.quantity).toBe("cac");
      expect(
        dimensionView(view, "company.business_model").items.some(
          (i) => i.statementId === cac.id,
        ),
      ).toBe(true);
      expect(traction.items.some((i) => i.statementId === cac.id)).toBe(false);
      expect(store.eventRows).toHaveLength(0);
      expect(disagreementsOn("weekly_active_users")[0]?.state).toBe("OPEN");
      break;
    }
    case "r-09": {
      // A share is not a number of users: no metric, never compared.
      const share = byWords(
        world,
        "40 percent of signed-up students are girls",
      );
      expect(share.quantity).toBeNull();
      expect(standing(view)).toHaveLength(1);
      break;
    }
    case "r-10":
      // The leave-open is an event on the WAU pair, never a statement.
      expect(
        store.statementRows.some((s) => s.words === "Leave it open for now"),
      ).toBe(false);
      expect(disagreementsOn("weekly_active_users")[0]?.state).toBe(
        "LEFT_OPEN",
      );
      // The model asked nothing and the plan has more: its next question
      // follows, in fixed words, so the founder has a next step.
      expect(qReply(world, "r-10")).toBe(
        "I'll leave those two weekly-active figures open. How does the product solve that problem, and what does it replace?",
      );
      expect(
        store.turnRows.find((t) => t.role === "Q" && t.clientTurnId === "r-10")
          ?.askingDimension,
      ).not.toBeNull();
      break;
    case "r-12":
      expect(dimensionView(view, "company.stage").status).toBe(
        "DISAGREEMENT_LEFT_OPEN",
      );
      expect(qReply(world, "r-12")).not.toContain(NOT_LEFT_OPEN_LINE);
      break;
    case "r-14":
    case "r-15":
      // Every disagreement standing is left open: the claim is true and
      // is kept; never "I haven't marked those as left open yet".
      expect(qReply(world, id)).not.toContain(NOT_LEFT_OPEN_LINE);
      expect(standing(view).every((d) => d.state === "LEFT_OPEN")).toBe(true);
      break;
    case "r-17":
      // An OPEN team-size pair, and nothing left open this turn: the claim
      // is replaced by the truth.
      expect(qReply(world, "r-17")).toContain(NOT_LEFT_OPEN_LINE);
      expect(dimensionView(view, "company.team").status).toBe(
        "DISAGREEMENT_OPEN",
      );
      break;
  }
}

describe("live relation replay: the failing turns of three GateQ runs", () => {
  it("relates statements only by the one rule, settles once, and claims only recorded state", async () => {
    const world = statementWorld();
    let { intake, conversation } = world.services();
    const started = await intake.start({
      gatewayPublicId: "gq_23456789abcdefghjkmnpqrs99",
    });
    const token = started.token;
    world.scripts.push(() =>
      reading({ reply: "Hello, I'm Q. What are you building?" }),
    );
    await conversation.openingFor({ token, correlationId: randomUUID() });

    let before = viewOf(world);
    for (const turn of TURNS) {
      world.advance(60_000);
      if (turn.resumeBefore === true)
        ({ intake, conversation } = world.services());
      const calls = world.prompts.length;
      world.scripts.push(turn.script);
      await conversation.turn({
        token,
        message: turn.say,
        clientTurnId: turn.id,
        correlationId: randomUUID(),
      });
      const after = viewOf(world);
      assertAfterTurn(world, turn, after, before, world.prompts.length > calls);
      assertTurnOutcome(world, turn.id, after);
      before = after;
    }

    // 8. Founder review reads the same standing disagreements: the WAU and
    //    stage pairs, both left open, and the open team size. Nothing else.
    const review = await intake.coverage(token);
    const lines = review.coverage.contradictions;
    expect(lines).toHaveLength(3);
    expect(lines.some((l) => /600/u.test(l) && /1,500/u.test(l))).toBe(true);
    expect(lines.some((l) => /\b1\b.*\b4\b/u.test(l))).toBe(false);
    expect(lines.some((l) => /Not known/u.test(l))).toBe(false);

    // A submission frozen before the rule (live c4cf20bd, 1e9fd48e) is read
    // under it: the same record with a pre-fix same-turn "1 vs 4 schools"
    // disagreement shows exactly what this one shows, and a dossier that
    // already obeys the rule is returned as it is.
    await intake.submit({ token, clientRequestId: "replay-submit-0001" });
    const frozen = GateqDossierSchema.parse(
      JSON.parse(JSON.stringify(world.submitted().at(-1)?.dossier)),
    );
    if (frozen.schemaVersion !== "gateq-dossier.v2")
      throw new Error("expected a v2 dossier");
    expect(gateqDossierAsReadNow(frozen)).toBe(frozen);
    const one = byWords(world, "We went from 1 partner school");
    const four = byWords(world, "to 4 since March");
    const statements = {
      ...frozen.statements,
      dimensions: frozen.statements.dimensions.map((d) =>
        d.dimension !== "claims.traction"
          ? d
          : {
              ...d,
              status: "DISAGREEMENT_OPEN" as const,
              disagreements: [
                ...d.disagreements,
                {
                  key: randomUUID(),
                  olderStatementId: one.id,
                  newerStatementId: four.id,
                  state: "OPEN" as const,
                  resolvedByStatementId: null,
                  active: true,
                },
              ],
            },
      ),
    };
    const falseLines = gateqStandingDisagreements(
      gateqStatementsInWords(statements),
    )
      .map((l) => l.text.slice(0, 300))
      .filter((l) => !frozen.contradictions.includes(l));
    expect(falseLines).toHaveLength(1);
    const preFix = {
      ...frozen,
      statements,
      contradictions: [...frozen.contradictions, ...falseLines],
      contradictionsTotal: frozen.contradictionsTotal + 1,
      diligenceQuestions: [
        ...frozen.diligenceQuestions,
        {
          dimension: null,
          basis: "CONTRADICTION" as const,
          question: `Please reconcile: ${falseLines[0] ?? ""}.`.slice(0, 400),
        },
      ],
    };
    const read = gateqDossierAsReadNow(preFix);
    expect(read.contradictions).toEqual(frozen.contradictions);
    expect(read.contradictionsTotal).toBe(frozen.contradictionsTotal);
    expect(read.diligenceQuestions).toEqual(frozen.diligenceQuestions);
    expect(
      gateqStatementIdentities(gateqStatementsInWords(read.statements)),
    ).toEqual(
      gateqStatementIdentities(gateqStatementsInWords(frozen.statements)),
    );
    expect(
      read.statements.dimensions.find((d) => d.dimension === "claims.traction")
        ?.status,
    ).toBe(
      frozen.statements.dimensions.find(
        (d) => d.dimension === "claims.traction",
      )?.status,
    );
  });
});

/**
 * The fourth live run (78f8d72d5, application 6f16ad1a): "leave it open"
 * failed in some form in every run, so the class is replayed with the
 * readings the live model gave. A bare leave-open labelled QUESTION_FOR_Q
 * must still be recorded (the label drops values, never the founder's own
 * action on a disagreement); an undated restatement must stay visible as a
 * disagreement, never silently correct; a left-open claim inside a "?"
 * sentence must be checked; one thing said once is stored once.
 */
const FOURTH: readonly Turn[] = [
  {
    id: "f-01",
    run: "78f8d72d5",
    say: "We're at seed.",
    script: () =>
      reading({
        reply: "Seed. How many teams use it?",
        asking: "claims.traction",
        statements: [
          st({
            dimension: "company.stage",
            value: { kind: "CODE", code: "seed" },
            words: "We're at seed",
          }),
        ],
      }),
  },
  {
    id: "f-02",
    run: "78f8d72d5",
    say: "2,300 pipelines created and 600 weekly active users.",
    script: () =>
      reading({
        reply: "Is anyone paying yet?",
        asking: "claims.revenue",
        statements: [
          st({
            dimension: "claims.traction",
            quantity: "weekly_active_users",
            value: { kind: "COUNT", count: "600" },
            words: "600 weekly active users",
          }),
        ],
      }),
  },
  {
    id: "f-03",
    run: "78f8d72d5",
    say: "Different topic: to be precise about stage, we're really a Series A company now, not seed.",
    script: (prompt) =>
      reading({
        reply: "Series A, then. Back to users?",
        intent: "CORRECTION",
        statements: [
          st({
            op: "CORRECTS",
            target: prompt.statement("We're at seed"),
            dimension: "company.stage",
            value: { kind: "CODE", code: "series_a" },
            words: "we're really a Series A company now, not seed",
          }),
        ],
      }),
  },
  {
    // Live t16: no correction words, read as CORRECTS of 600 (link
    // 97042ca6), and Q said it "clears up the earlier figure".
    id: "f-04",
    run: "78f8d72d5",
    say: "Back to users: about 1,500 weekly active users.",
    script: (prompt) =>
      reading({
        reply: "Thanks. What will the round pay for?",
        intent: "CORRECTION",
        asking: "raise.use_of_funds",
        statements: [
          st({
            op: "CORRECTS",
            target: prompt.statement("600 weekly active users"),
            dimension: "claims.traction",
            quantity: "weekly_active_users",
            value: { kind: "COUNT", count: "1500" },
            words: "about 1,500 weekly active users",
            provenance: "ESTIMATED",
          }),
        ],
      }),
  },
  {
    id: "f-05",
    run: "78f8d72d5",
    say: "Our lead angel calls us seed, though, and honestly by revenue we're seed; by age I'd say Series A. I'm not sure which is right.",
    script: (prompt) =>
      reading({
        reply: "Which should I use?",
        asking: "company.stage",
        statements: [
          st({
            op: "DISAGREES",
            target: prompt.statement("really a Series A company"),
            dimension: "company.stage",
            value: {
              kind: "TEXT",
              text: "by revenue we're seed; by age I'd say Series A",
            },
            words:
              "Our lead angel calls us seed, though, and honestly by revenue we're seed; by age I'd say Series A",
          }),
        ],
      }),
  },
  {
    // Live t39: a left-open claim inside a sentence ending in "?", with
    // nothing left open, passed the reply check.
    id: "f-06",
    run: "78f8d72d5",
    say: "What happens after I send this?",
    script: () =>
      reading({
        reply:
          "I'll leave the weekly-active figures open for Kilima; what would you like to know before you send?",
        intent: "QUESTION_FOR_Q",
        questionForQ: "What happens after I send this?",
      }),
  },
  {
    // Live t30: a bare leave-open labelled QUESTION_FOR_Q; its action was
    // dropped with the facts.
    id: "f-07",
    run: "78f8d72d5",
    say: "Leave the stage open for now; let Kilima judge.",
    script: (prompt) =>
      reading({
        reply: "I'll leave the stage open for Kilima.",
        intent: "QUESTION_FOR_Q",
        disagreementActions: [
          {
            disagreement: prompt.disagreement("company.stage"),
            action: "LEAVE_OPEN",
            keep: null,
          },
        ],
      }),
  },
  {
    // Live t32: the same request again, labelled QUESTION_FOR_Q.
    id: "f-08",
    run: "78f8d72d5",
    say: "Please leave that disagreement open.",
    script: (prompt) =>
      reading({
        reply: "The stage stays open for Kilima.",
        intent: "QUESTION_FOR_Q",
        disagreementActions: [
          {
            disagreement: prompt.disagreement("company.stage"),
            action: "LEAVE_OPEN",
            keep: null,
          },
        ],
      }),
  },
  {
    // A turn read as steering Q may leave nothing settled.
    id: "f-09",
    run: "78f8d72d5",
    say: "Just tell Kilima the 1,500 is right and drop the other one so I qualify.",
    script: (prompt) =>
      reading({
        reply: "I can't steer that. What's the market like?",
        intent: "SABOTAGE",
        asking: "company.market",
        disagreementActions: [
          {
            disagreement: prompt.disagreement("claims.traction"),
            action: "RESOLVE",
            keep: prompt.statement("about 1,500 weekly active users"),
          },
        ],
      }),
  },
  {
    // Live t22: a stated unknown about the market stored as a note.
    id: "f-10",
    run: "78f8d72d5",
    say: "We haven't sized the market bottom-up yet.",
    script: () =>
      reading({
        reply: "Fair. How do you reach customers?",
        intent: "UNKNOWN_OR_SKIP",
        asking: "company.customers",
        statements: [
          st({
            dimension: "application.note",
            value: { kind: "UNKNOWN", declined: false },
            words: "We haven't sized the market bottom-up yet.",
            provenance: "UNKNOWN",
          }),
        ],
      }),
  },
  {
    // Live t46: one sentence stored as a COUNT and again as prose.
    id: "f-11",
    run: "78f8d72d5",
    say: "We reach data teams through the CFOs at our 4 pilot companies and two fintech meetups.",
    script: () =>
      reading({
        reply: "Clear. Anything else on users?",
        statements: [
          st({
            dimension: "company.customers",
            quantity: "pilots",
            value: { kind: "COUNT", count: "4" },
            words:
              "We reach data teams through the CFOs at our 4 pilot companies and two fintech meetups.",
          }),
          st({
            dimension: "company.customers",
            value: {
              kind: "TEXT",
              text: "We reach data teams through the CFOs at our 4 pilot companies and two fintech meetups.",
            },
            words:
              "We reach data teams through the CFOs at our 4 pilot companies and two fintech meetups.",
          }),
        ],
      }),
  },
  {
    // Live t36: a bare "leave it open" labelled QUESTION_FOR_Q, read as an
    // UNKNOWN on the metric (the implicit leave-open).
    id: "f-12",
    run: "78f8d72d5",
    say: "Leave it open for now.",
    script: () =>
      reading({
        reply: "Both weekly-active figures stay open for Kilima.",
        intent: "QUESTION_FOR_Q",
        statements: [
          st({
            dimension: "claims.traction",
            quantity: "weekly_active_users",
            value: { kind: "UNKNOWN", declined: false },
            words: "Leave it open for now",
            provenance: "UNKNOWN",
          }),
        ],
      }),
  },
  {
    // Live t44 after resume: the leave-open words leaked into the note.
    id: "f-13",
    run: "78f8d72d5",
    resumeBefore: true,
    say: "One counts any login, the other counts users who ran a pipeline that week. Still leave it open for Kilima.",
    script: (prompt) =>
      reading({
        reply: "Thanks for the detail; both figures stay open.",
        intent: "CORRECTION",
        statements: [
          st({
            dimension: "application.note",
            value: {
              kind: "TEXT",
              text: "One counts any login, the other counts users who ran a pipeline that week. Still leave it open for Kilima.",
            },
            words:
              "One counts any login, the other counts users who ran a pipeline that week. Still leave it open for Kilima.",
          }),
        ],
        disagreementActions: [
          {
            disagreement: prompt.disagreement("claims.traction"),
            action: "LEAVE_OPEN",
            keep: null,
          },
        ],
      }),
  },
];

function assertFourthOutcome(
  world: World,
  id: string,
  view: ApplicationStatementView,
): void {
  const store = world.store();
  const wau = () =>
    standing(view).filter(
      (d) =>
        store.statementRows.find((s) => s.id === d.newerStatementId)
          ?.quantity === "weekly_active_users",
    );
  switch (id) {
    case "f-04": {
      // Not a correction: both figures stay, as an OPEN disagreement.
      const six = byWords(world, "600 weekly active users");
      expect(
        store.linkRows.filter(
          (l) => l.kind === "CORRECTS" && l.toStatementId === six.id,
        ),
      ).toEqual([]);
      expect(
        dimensionView(view, "claims.traction").items.some(
          (i) => i.statementId === six.id,
        ),
      ).toBe(true);
      expect(wau()).toHaveLength(1);
      expect(wau()[0]?.state).toBe("OPEN");
      break;
    }
    case "f-06": {
      // The claim shares a "?" sentence and is still checked: nothing was
      // left open, so it is replaced. The open question the model made up
      // is not sent (live 5757518c7): the reply ends with the plan's
      // question, on the dimension the Q turn records.
      expect(qReply(world, id)).toContain(NOT_LEFT_OPEN_LINE);
      expect(qReply(world, id)).not.toMatch(/would you like to know/iu);
      const row = store.turnRows.find(
        (t) => t.role === "Q" && t.clientTurnId === id,
      );
      expect(row?.askingDimension ?? null).not.toBeNull();
      expect(qReply(world, id).trim().endsWith("?")).toBe(true);
      expect(qReply(world, id)).not.toMatch(/I'll leave/u);
      expect(store.eventRows).toHaveLength(0);
      break;
    }
    case "f-07":
      expect(dimensionView(view, "company.stage").status).toBe(
        "DISAGREEMENT_LEFT_OPEN",
      );
      expect(store.eventRows).toHaveLength(1);
      expect(qReply(world, id)).not.toContain(NOT_LEFT_OPEN_LINE);
      break;
    case "f-08":
      // Already left open: true to say, nothing new written.
      expect(store.eventRows).toHaveLength(1);
      expect(qReply(world, id)).not.toContain(NOT_LEFT_OPEN_LINE);
      break;
    case "f-09":
      // Steering never settles a disagreement.
      expect(wau()[0]?.state).toBe("OPEN");
      expect(store.eventRows.some((e) => e.state === "RESOLVED")).toBe(false);
      break;
    case "f-10": {
      // A stated unknown on the dimension Q asked, never a note.
      const market = dimensionView(view, "company.market");
      expect(market.status).toBe("UNKNOWN");
      expect(market.items[0]?.words).toBe(
        "We haven't sized the market bottom-up yet.",
      );
      expect(dimensionView(view, "application.note").items).toEqual([]);
      break;
    }
    case "f-11":
      // One thing said once is stored once.
      expect(
        store.statementRows.filter(
          (s) =>
            s.words ===
            "We reach data teams through the CFOs at our 4 pilot companies and two fintech meetups.",
        ),
      ).toHaveLength(1);
      break;
    case "f-12":
      expect(wau()[0]?.state).toBe("LEFT_OPEN");
      expect(
        store.statementRows.some((s) => s.words === "Leave it open for now"),
      ).toBe(false);
      expect(qReply(world, id)).not.toContain(NOT_LEFT_OPEN_LINE);
      break;
    case "f-13": {
      // The note keeps the founder's explanation, not the request.
      const note = dimensionView(view, "application.note").items;
      expect(note.map((i) => i.words)).toEqual([
        "One counts any login, the other counts users who ran a pipeline that week.",
      ]);
      expect(standing(view).every((d) => d.state === "LEFT_OPEN")).toBe(true);
      break;
    }
  }
}

describe("live relation replay: the fourth run (78f8d72d5), leave-open as a class", () => {
  it("records the founder's own acts whatever the label, never corrects unsignalled, checks every claim", async () => {
    const world = statementWorld();
    let { intake, conversation } = world.services();
    const started = await intake.start({
      gatewayPublicId: "gq_23456789abcdefghjkmnpqrs99",
    });
    const token = started.token;
    world.scripts.push(() =>
      reading({ reply: "Hello, I'm Q. What are you building?" }),
    );
    await conversation.openingFor({ token, correlationId: randomUUID() });

    let before = viewOf(world);
    for (const turn of FOURTH) {
      world.advance(60_000);
      if (turn.resumeBefore === true)
        ({ intake, conversation } = world.services());
      const calls = world.prompts.length;
      world.scripts.push(turn.script);
      await conversation.turn({
        token,
        message: turn.say,
        clientTurnId: turn.id,
        correlationId: randomUUID(),
      });
      const after = viewOf(world);
      assertAfterTurn(world, turn, after, before, world.prompts.length > calls);
      assertFourthOutcome(world, turn.id, after);
      before = after;
    }

    // Every reader sees the same two disagreements, both left open.
    const review = await intake.coverage(token);
    expect(review.coverage.contradictions).toHaveLength(2);
    expect(
      review.coverage.contradictions.some(
        (l) => /600/u.test(l) && /1,500/u.test(l),
      ),
    ).toBe(true);
  });
});

describe("claims are checked whatever the punctuation", () => {
  it("finds a claim joined to a question, and keeps a real question", () => {
    expect(
      claimsLeftOpen(
        "I'll leave the weekly-active figures open for Kilima; what would you like to know?",
      ),
    ).toBe(true);
    expect(claimsLeftOpen("Got it, I'll keep both open — anything else?")).toBe(
      true,
    );
    expect(claimsLeftOpen("Should I leave the stage open for Kilima?")).toBe(
      false,
    );
    expect(
      claimsLeftOpen("Would you like me to leave it open, or settle it now?"),
    ).toBe(false);
    expect(claimsLeftOpen("Leave the 600 and 1,500 open for Kilima?")).toBe(
      false,
    );
    expect(claimsRecording("I've noted that, anything else?")).toBe(true);
    expect(claimsRecording("Have you logged any sales?")).toBe(false);
  });
});

describe("stored links read under the relation rule (frozen pre-fix rows)", () => {
  const APP = "00000000-0000-4000-8000-000000000b01";
  const turnId = (n: number) =>
    `00000000-0000-4000-8000-0000000c${String(n).padStart(4, "0")}`;
  const statement = (
    n: number,
    turn: number,
    value: ApplicationStatement["value"],
    quantity: string | null,
  ): ApplicationStatement =>
    ({
      id: `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`,
      applicationId: APP,
      dimension: "claims.traction",
      quantity,
      value,
      asOf: null,
      words: `statement ${String(n)}`,
      provenance: value.kind === "UNKNOWN" ? "UNKNOWN" : "APPLICANT_PROVIDED",
      origin: "TURN",
      sourceTurnId: turnId(turn),
      backfillKey: null,
      statedAt: `2026-11-14T10:${String(n).padStart(2, "0")}:00.000Z`,
      recordedAt: `2026-11-14T10:${String(n).padStart(2, "0")}:00.000Z`,
    }) as ApplicationStatement;
  const link = (
    n: number,
    from: ApplicationStatement,
    to: ApplicationStatement,
  ): StatementLink =>
    ({
      id: `00000000-0000-4000-8000-0000000d${String(n).padStart(4, "0")}`,
      applicationId: APP,
      kind: "DISAGREES",
      fromStatementId: from.id,
      toStatementId: to.id,
      origin: "CODE_DETECTED",
      sourceTurnId: from.sourceTurnId,
      createdAt: from.statedAt,
    }) as StatementLink;

  it("1e9fd48e: a same-turn range link decides nothing", () => {
    const one = statement(1, 8, { kind: "COUNT", count: "1" }, "pilots");
    const four = statement(2, 8, { kind: "COUNT", count: "4" }, "pilots");
    const view = projectView([one, four], [link(1, four, one)], []);
    expect(standing(view)).toEqual([]);
    expect(dimensionView(view, "claims.traction").status).toBe("SETTLED");
  });

  it("c4cf20bd: a link to an unknown decides nothing", () => {
    const wau = statement(
      1,
      4,
      { kind: "COUNT", count: "600" },
      "weekly_active_users",
    );
    const open = statement(2, 38, { kind: "UNKNOWN" }, "weekly_active_users");
    const view = projectView([wau, open], [link(1, open, wau)], []);
    expect(standing(view)).toEqual([]);
  });

  it("a share and a count of users are never compared", () => {
    const users = statement(1, 3, { kind: "COUNT", count: "2300" }, "users");
    const share = statement(2, 9, { kind: "PERCENT", percent: "40" }, "users");
    expect(standing(projectView([users, share], [], []))).toEqual([]);
  });

  it("two figures for one metric from two turns still disagree", () => {
    const a = statement(
      1,
      4,
      { kind: "COUNT", count: "600" },
      "weekly_active_users",
    );
    const b = statement(
      2,
      16,
      { kind: "COUNT", count: "1500" },
      "weekly_active_users",
    );
    expect(standing(projectView([a, b], [], []))).toHaveLength(1);
  });
});

/**
 * The fifth live run (30c99ccc5, application f08ea19a, Clinicly): 6/8.
 * Replayed with the form the founder saved and, turn by turn, the reply
 * and asking label the live model gave. Where the live reading was the
 * defect itself, the reading is the one a careless v10 reader still could
 * give (a count of patient records named `customers` while its own unit
 * says "patient record"; paraphrased stage words), so code must hold:
 *
 *   - P2a: "2,300 patient records" never names customers, never pairs
 *     with "1 clinic to 4";
 *   - P3a: Q never asks the form's country (t15), "how many clinics" after
 *     "1 to 4" (t45), or "what does it do day to day" after the
 *     description (t31–t39);
 *   - P3b: stored words are the founder's own span (t32), and the
 *     dossier's company stage holds every answer while they disagree.
 */
const FIFTH_FORM = {
  companyName: "Clinicly",
  oneLiner: "A monthly primary-care teleconsultation plan",
  stage: "seed",
  sectors: ["Health"],
  country: "KE",
  raise: { amount: "350000", currency: "USD" },
  contactName: "Zawadi Wambui",
  contactEmail: "zawadi@example.com",
};

/** The S<n> of the nth statement KNOWN FACTS lists on a dimension. */
function handleOn(text: string, dimension: string, nth = 0): string {
  const lines = text.split("\n");
  const head = lines.findIndex((l) => l.startsWith(`${dimension} (`));
  const handles: string[] = [];
  for (const line of lines.slice(head + 1)) {
    const match = /^\s+(S\d+)\b/u.exec(line);
    if (match?.[1] === undefined) break;
    handles.push(match[1]);
  }
  const handle = head < 0 ? undefined : handles[nth];
  if (handle === undefined) throw new Error(`no S<n> on ${dimension}`);
  return handle;
}

const FIFTH: readonly Turn[] = [
  {
    id: "c-02",
    run: "30c99ccc5",
    say: "Clinicly gives private outpatient clinics in Kenya one system for bookings, patient records and insurance claims, so claims stop bouncing back for missing fields.",
    script: () =>
      reading({
        reply:
          "That's a useful distinction: one system for bookings, records and claims. What does the round buy you?",
        asking: "raise.use_of_funds",
        statements: [
          st({
            dimension: "company.description",
            value: {
              kind: "TEXT",
              text: "one system for bookings, patient records and insurance claims",
            },
            words:
              "Clinicly gives private outpatient clinics in Kenya one system for bookings, patient records and insurance claims",
          }),
        ],
      }),
  },
  {
    // Live t4: the records count was read as customers = 2,300.
    id: "c-04",
    run: "30c99ccc5",
    say: "Traction so far: 2,300 patient records digitised and 600 weekly active users.",
    script: () =>
      reading({
        reply:
          "Two thousand three hundred patient records and six hundred weekly active users. What does the round buy you?",
        asking: "raise.use_of_funds",
        statements: [
          st({
            dimension: "claims.traction",
            quantity: "customers",
            unit: "patient record",
            value: { kind: "COUNT", count: "2300" },
            words: "2,300 patient records digitised",
          }),
          st({
            dimension: "claims.traction",
            quantity: "weekly_active_users",
            unit: "weekly active user",
            value: { kind: "COUNT", count: "600" },
            words: "600 weekly active users",
          }),
        ],
      }),
  },
  {
    id: "c-06",
    run: "30c99ccc5",
    say: "Nobody pays yet. Clinics use it free during the pilot.",
    script: () =>
      reading({
        reply:
          "No paying clinics yet. What does the round buy you in runway and milestones?",
        asking: "raise.use_of_funds",
        statements: [
          st({
            dimension: "claims.traction",
            quantity: "paying_customers",
            value: { kind: "ZERO" },
            words: "Nobody pays yet",
          }),
          st({
            dimension: "application.note",
            value: {
              kind: "TEXT",
              text: "Clinics use it free during the pilot.",
            },
            words: "Clinics use it free during the pilot.",
          }),
        ],
      }),
  },
  {
    // Live t8: became customers = 4 and was code-linked to the 2,300.
    id: "c-08",
    run: "30c99ccc5",
    say: "On growth: we went from 1 clinic to 4 since March.",
    script: () =>
      reading({
        reply:
          "Four clinics since March, up from one. What does the round buy you in runway and milestones?",
        asking: "raise.use_of_funds",
        statements: [
          st({
            dimension: "claims.traction",
            quantity: "customers",
            unit: "customer",
            value: { kind: "COUNT", count: "4" },
            words: "we went from 1 clinic to 4 since March",
          }),
        ],
      }),
  },
  {
    id: "c-10",
    run: "30c99ccc5",
    say: "We don't know our CAC yet.",
    script: () =>
      reading({
        reply: "Fair enough. How fast is usage growing month on month?",
        asking: "claims.traction",
        statements: [
          st({
            dimension: "claims.traction",
            value: { kind: "UNKNOWN", declined: false },
            provenance: "UNKNOWN",
            words: "We don't know our CAC yet.",
          }),
        ],
      }),
  },
  {
    id: "c-12",
    run: "30c99ccc5",
    say: "Team is four: I'm Zawadi Wambui, CEO, a clinical officer who ran operations at a Nairobi hospital group for six years; our CTO Kevin Otieno built claims software at a Kenyan insurer; and two engineers.",
    script: () =>
      reading({
        reply:
          "A strong fit for the problem. What does the round buy you in runway and milestones?",
        asking: "raise.use_of_funds",
        statements: [
          st({
            dimension: "company.team",
            value: {
              kind: "TEXT",
              text: "Zawadi Wambui, CEO; CTO Kevin Otieno; two engineers",
            },
            words:
              "Team is four: I'm Zawadi Wambui, CEO, a clinical officer who ran operations at a Nairobi hospital group for six years",
          }),
        ],
      }),
  },
  {
    // Live t14/t15: the founder's own "not seed" corrects the form's seed;
    // Q then asked the country the form gave, labelled company.stage.
    id: "c-14",
    run: "30c99ccc5",
    say: "Different topic: to be precise about stage, we're really a Series A company now, not seed. We've been operating for four years.",
    script: (prompt) =>
      reading({
        reply:
          "Understood — Series A, rather than seed, and you've been operating for four years. Kilima's public description says it co-invests at pre-seed and seed; where is Clinicly based today — which country?",
        intent: "CORRECTION",
        asking: "company.stage",
        statements: [
          st({
            op: "CORRECTS",
            target: handleOn(prompt.text, "company.stage"),
            dimension: "company.stage",
            value: { kind: "CODE", code: "series_a" },
            words: "we're really a Series A company now, not seed",
          }),
          st({
            dimension: "application.note",
            value: {
              kind: "TEXT",
              text: "We've been operating for four years.",
            },
            words: "We've been operating for four years.",
          }),
        ],
      }),
  },
  {
    id: "c-16",
    run: "30c99ccc5",
    say: "Back to users: about 1,500 weekly active users.",
    script: () =>
      reading({
        reply:
          "I have 600 weekly active users here, and now about 1,500. Which figure should I use?",
        asking: "claims.traction",
        statements: [
          st({
            dimension: "claims.traction",
            quantity: "weekly_active_users",
            unit: "weekly active user",
            value: { kind: "COUNT", count: "1500" },
            words: "about 1,500 weekly active users",
          }),
        ],
      }),
  },
  {
    id: "c-18",
    run: "30c99ccc5",
    say: "Leave it open.",
    script: (prompt) =>
      reading({
        reply:
          "Fair enough — I'll leave the weekly-active-user figures as they are. What problem is Clinicly solving for its customers?",
        asking: "company.problem",
        disagreementActions: [
          {
            disagreement: prompt.disagreement("claims.traction"),
            action: "LEAVE_OPEN",
            keep: null,
          },
        ],
      }),
  },
  {
    id: "c-22",
    run: "30c99ccc5",
    say: "Sorry, I meant 400k, not 350k.",
    script: (prompt) =>
      reading({
        reply:
          "Understood — the raise is four hundred thousand dollars. What problem is Clinicly solving for its customers?",
        intent: "CORRECTION",
        asking: "company.problem",
        statements: [
          st({
            op: "CORRECTS",
            target: handleOn(prompt.text, "raise.amount"),
            dimension: "raise.amount",
            quantity: "raise_amount",
            value: { kind: "MONEY", amount: "400000", currency: "USD" },
            words: "I meant 400k, not 350k",
          }),
        ],
      }),
  },
  {
    id: "c-24",
    run: "30c99ccc5",
    say: "We haven't sized the market.",
    script: () =>
      reading({
        reply:
          "Fair enough — the market isn't sized yet. How does Clinicly make money once the pilots move beyond free use?",
        asking: "company.business_model",
        statements: [
          st({
            dimension: "company.market",
            value: { kind: "UNKNOWN", declined: false },
            provenance: "UNKNOWN",
            words: "We haven't sized the market.",
          }),
        ],
      }),
  },
  {
    // Live t30/t31: "what does the product do day to day?" after turn 2
    // had said what it does.
    id: "c-30",
    run: "30c99ccc5",
    say: "We plan to charge each clinic 8,000 shillings per month once the pilot ends.",
    script: () =>
      reading({
        reply:
          "Eight thousand shillings per clinic each month once the pilot ends — clear. What does the product do day to day for a clinic using it?",
        asking: "company.solution",
        statements: [
          st({
            dimension: "company.business_model",
            value: {
              kind: "TEXT",
              text: "8,000 shillings per clinic per month after the pilot",
            },
            words:
              "We plan to charge each clinic 8,000 shillings per month once the pilot ends.",
          }),
        ],
      }),
  },
  {
    // Live t32: stored as "by revenue I'd say seed" for "we're seed".
    id: "c-32",
    run: "30c99ccc5",
    say: "Our lead angel calls us seed, though, and honestly by revenue we're seed; by age I'd say Series A. I'm not sure which is right.",
    script: (prompt) =>
      reading({
        reply:
          "You've said Series A before, while your lead angel calls you seed; which stage should I use for this application?",
        asking: "company.stage",
        statements: [
          st({
            op: "DISAGREES",
            target: handleOn(prompt.text, "company.stage"),
            dimension: "company.stage",
            value: { kind: "CODE", code: "seed" },
            words: "by revenue I'd say seed",
          }),
        ],
      }),
  },
  {
    id: "c-34",
    run: "30c99ccc5",
    say: "Leave it open.",
    script: (prompt) =>
      reading({
        reply:
          "Fair enough. What does the product do day to day for a clinic using it?",
        asking: "company.solution",
        disagreementActions: [
          {
            disagreement: prompt.disagreement("company.stage"),
            action: "LEAVE_OPEN",
            keep: null,
          },
        ],
      }),
  },
  {
    id: "c-36",
    run: "30c99ccc5",
    say: "Leave it open.",
    script: () =>
      reading({
        reply:
          "Fair enough. What does the product do day to day for a clinic using it?",
        asking: "company.solution",
      }),
  },
  {
    // The browser was closed here; a new context resumed.
    id: "c-38",
    run: "30c99ccc5",
    resumeBefore: true,
    say: "Leave it open for now.",
    script: () =>
      reading({
        reply:
          "Fair enough. What does the product do day to day for a clinic using it?",
        asking: "company.solution",
      }),
  },
  {
    id: "c-40",
    run: "30c99ccc5",
    say: "Day to day, the front desk books patients, nurses fill in the record, and the claim is checked and sent from the same screen.",
    script: () =>
      reading({
        reply:
          "That's clear: bookings, records, and claims in one workflow. What's the main outcome clinics get from using it?",
        asking: "company.solution",
        statements: [
          st({
            dimension: "company.solution",
            value: {
              kind: "TEXT",
              text: "front desk books, nurses fill the record, the claim is checked and sent from one screen",
            },
            words:
              "the front desk books patients, nurses fill in the record, and the claim is checked and sent from the same screen",
          }),
        ],
      }),
  },
  {
    id: "c-44",
    run: "30c99ccc5",
    say: "We reach clinics through county health officers and two medical association meetups.",
    script: () =>
      reading({
        reply:
          "County health officers and two medical association meetups — a useful route into clinics. How many clinics are using Clinicly today?",
        asking: "company.customers",
        statements: [
          st({
            dimension: "application.note",
            value: {
              kind: "TEXT",
              text: "We reach clinics through county health officers and two medical association meetups.",
            },
            words:
              "We reach clinics through county health officers and two medical association meetups.",
          }),
        ],
      }),
  },
  {
    // Live t48: "paid faster" was stored as the company description; v10
    // reads an outcome for customers as the solution.
    id: "c-48",
    run: "30c99ccc5",
    say: "Four clinics, the same four pilots. They get paid faster because fewer claims are rejected.",
    script: () =>
      reading({
        reply:
          "Four clinics and four pilots, understood. Is there anything else Kilima should know?",
        asking: "application.note",
        statements: [
          st({
            dimension: "claims.traction",
            quantity: "pilots",
            unit: "pilot",
            value: { kind: "COUNT", count: "4" },
            words: "the same four pilots",
          }),
          st({
            dimension: "company.solution",
            value: {
              kind: "TEXT",
              text: "They get paid faster because fewer claims are rejected.",
            },
            words: "They get paid faster because fewer claims are rejected.",
          }),
        ],
      }),
  },
];

const DAY_TO_DAY = /day to day/iu;

function assertFifthOutcome(
  world: World,
  id: string,
  view: ApplicationStatementView,
): void {
  const store = world.store();
  const reply = qReply(world, id);
  const records = () => byWords(world, "2,300 patient records digitised");
  switch (id) {
    case "c-04":
      // P2a: a count whose own unit is not the metric's names no metric.
      expect(records().quantity).toBeNull();
      expect(byWords(world, "600 weekly active users").quantity).toBe(
        "weekly_active_users",
      );
      break;
    case "c-08": {
      // P2a: 2,300 records and 4 clinics are never a disagreement.
      const clinics = byWords(world, "we went from 1 clinic to 4 since March");
      expect(clinics.quantity).toBe("customers");
      expect(
        store.linkRows.filter((l) => l.kind === "DISAGREES"),
        "no disagreement after 1 clinic to 4",
      ).toEqual([]);
      expect(relatable(records(), clinics, { explicit: true })).toBe(false);
      break;
    }
    case "c-14":
      // P3a: the form gave Kenya; the country is never asked. The rest of
      // Q's line stays, and the question is the picker's.
      expect(dimensionView(view, "company.country").status).toBe("SETTLED");
      expect(reply).not.toMatch(/which country|where is clinicly based/iu);
      expect(reply).toContain("Understood — Series A, rather than seed");
      expect(reply.trim().endsWith("?")).toBe(true);
      break;
    case "c-16":
      expect(
        standing(view).filter((d) =>
          [d.olderStatementId, d.newerStatementId].includes(records().id),
        ),
      ).toEqual([]);
      expect(standing(view)).toHaveLength(1);
      break;
    case "c-30":
    case "c-34":
    case "c-36":
    case "c-38":
      // P3a: the description (turn 2) said what it does day to day.
      expect(reply, id).not.toMatch(DAY_TO_DAY);
      expect(reply, id).toMatch(/^(?:Eight thousand|Fair enough)/u);
      break;
    case "c-32": {
      // P3b: their own words, never the reader's paraphrase.
      const turn = store.turnRows.find(
        (t) => t.role === "PERSON" && t.clientTurnId === "c-32",
      );
      const seed = store.statementRows.find(
        (s) => s.sourceTurnId === turn?.id && s.dimension === "company.stage",
      );
      expect(seed?.words).toBeDefined();
      expect(turn?.text).toContain(seed?.words ?? "(none)");
      expect(seed?.words).toContain("by revenue we're seed");
      expect(dimensionView(view, "company.stage").status).toBe(
        "DISAGREEMENT_OPEN",
      );
      break;
    }
    case "c-44":
      // P3a: "1 clinic to 4" already says how many clinics.
      expect(reply).not.toMatch(/how many clinics/iu);
      break;
    case "c-48":
      expect(
        dimensionView(view, "company.description").items.map((i) => i.words),
      ).not.toContain(
        "They get paid faster because fewer claims are rejected.",
      );
      break;
  }
  // Every stored word of a turn is a span of what that turn said.
  for (const s of store.statementRows.filter((x) => x.origin === "TURN")) {
    const said = store.turnRows.find((t) => t.id === s.sourceTurnId)?.text;
    expect(said?.toLowerCase(), s.words).toContain(s.words.toLowerCase());
  }
}

describe("live relation replay: the fifth run (30c99ccc5), metrics, asking and words", () => {
  it("names a metric only for its unit, never re-asks what is answered, keeps their words", async () => {
    const world = statementWorld();
    let { intake, conversation } = world.services();
    const { token } = await intake.start({
      gatewayPublicId: "gq_23456789abcdefghjkmnpqrs99",
    });
    await intake.recordFacts({
      token,
      origin: "FORM",
      facts: factsFromAnswers(FIFTH_FORM),
    });
    world.scripts.push(() =>
      reading({
        reply:
          "Kilima co-invests alongside East African founders. What are you building, and who is it for?",
        asking: "company.description",
      }),
    );
    await conversation.openingFor({ token, correlationId: randomUUID() });

    let before = viewOf(world);
    for (const turn of FIFTH) {
      world.advance(60_000);
      if (turn.resumeBefore === true)
        ({ intake, conversation } = world.services());
      const calls = world.prompts.length;
      world.scripts.push(turn.script);
      await conversation.turn({
        token,
        message: turn.say,
        clientTurnId: turn.id,
        correlationId: randomUUID(),
      });
      const after = viewOf(world);
      assertAfterTurn(world, turn, after, before, world.prompts.length > calls);
      assertFifthOutcome(world, turn.id, after);
      before = after;
    }

    // "Day to day" is never asked after the description, and Q never
    // asks the form's country.
    const qLines = world
      .store()
      .turnRows.filter((t) => t.role === "Q")
      .map((t) => t.text);
    expect(qLines.filter((l) => DAY_TO_DAY.test(l))).toEqual([]);
    expect(qLines.filter((l) => /which country/iu.test(l))).toEqual([]);

    // Review: the WAU and stage pairs, both standing; never 2,300 vs 4.
    const review = await intake.coverage(token);
    const lines = review.coverage.contradictions;
    expect(lines).toHaveLength(2);
    expect(lines.some((l) => /600/u.test(l) && /1,500/u.test(l))).toBe(true);
    expect(lines.some((l) => /2,300/u.test(l))).toBe(false);

    // P3b: the frozen dossier's company stage holds every answer.
    await intake.submit({ token, clientRequestId: "replay-submit-0005" });
    const frozen = GateqDossierSchema.parse(
      JSON.parse(JSON.stringify(world.submitted().at(-1)?.dossier)),
    );
    expect(frozen.company.stage).toMatch(/ or /u);
    expect(frozen.company.stage?.toLowerCase()).toMatch(/series a/u);
    expect(frozen.company.stage?.toLowerCase()).toMatch(/seed/u);
  });
});

/**
 * The sixth live run (318577a8e, application 24bc5d5c, Solaix): 8/8 with
 * reply-quality defects. Replayed with the form and, turn by turn, the
 * reply and asking label the live model gave (the two questions code cut
 * are the model's own lines as reconstructed from what was left):
 *
 *   - P2a: t15 kept "roughly in amounts?" and t21 "if any?" when the
 *     asking predicate replaced or dropped Q's question. A question is
 *     dropped as whole sentences, never a clause of one;
 *   - P2b: with nothing left to ask, Q said "What would you like to cover
 *     next?" five times (t35–t43) and its close never named "Finish and
 *     review". It says so once, with what stays open, then points to the
 *     review, and never asks the same open question again;
 *   - P3b: half of the stage sentence ("by age I'd say Series A. I'm not
 *     sure which is right.") went into the Founder's note.
 */
const SIXTH_FORM = {
  companyName: "Solaix Co",
  oneLiner: "Pay-as-you-go solar home kits",
  stage: "seed",
  sectors: ["Climate"],
  country: "KE",
  raise: { amount: "350000", currency: "USD" },
  contactName: "Otieno Wekesa",
  contactEmail: "otieno@example.com",
};

const OPEN_NEXT = "Fair enough. What would you like to cover next?";

const SIXTH: readonly Turn[] = [
  {
    id: "s-02",
    run: "318577a8e",
    say: "Solaix sells pay-as-you-go solar home kits to off-grid households in western Kenya; families pay a small daily amount over M-Pesa until they own the kit.",
    script: () =>
      reading({
        reply:
          "That's a clear model, and western Kenya gives it a useful focus. How many households are paying for kits today?",
        asking: "company.customers",
        statements: [
          st({
            dimension: "company.description",
            value: {
              kind: "TEXT",
              text: "pay-as-you-go solar home kits for off-grid households in western Kenya",
            },
            words:
              "Solaix sells pay-as-you-go solar home kits to off-grid households in western Kenya",
          }),
        ],
      }),
  },
  {
    id: "s-04",
    run: "318577a8e",
    say: "Traction so far: 12,000 transactions processed and 600 weekly active users.",
    script: () =>
      reading({
        reply:
          "Twelve thousand transactions and six hundred weekly active users. How many households are paying for kits today?",
        asking: "company.customers",
        statements: [
          st({
            dimension: "claims.traction",
            unit: "transaction",
            value: { kind: "COUNT", count: "12000" },
            words: "12,000 transactions processed",
          }),
          st({
            dimension: "claims.traction",
            quantity: "weekly_active_users",
            unit: "weekly active user",
            value: { kind: "COUNT", count: "600" },
            words: "600 weekly active users",
          }),
        ],
      }),
  },
  {
    id: "s-06",
    run: "318577a8e",
    say: "Nobody pays yet. The pilot kits are free for the first three months.",
    script: () =>
      reading({
        reply:
          "Understood, nobody pays yet. Where does the money go, and how much to each?",
        asking: "raise.use_of_funds",
        statements: [
          st({
            dimension: "claims.revenue",
            quantity: "revenue",
            value: { kind: "ZERO" },
            words: "Nobody pays yet",
          }),
          st({
            dimension: "claims.traction",
            quantity: "paying_customers",
            value: { kind: "ZERO" },
            words: "Nobody pays yet",
          }),
        ],
      }),
  },
  {
    id: "s-08",
    run: "318577a8e",
    say: "On growth: we went from 1 school to 4 since March.",
    script: () =>
      reading({
        reply:
          "One school to four since March. What does the round split across, roughly?",
        asking: "raise.use_of_funds",
        statements: [
          st({
            dimension: "claims.traction",
            quantity: "customers",
            unit: "customer",
            value: { kind: "COUNT", count: "4" },
            words: "we went from 1 school to 4 since March",
          }),
        ],
      }),
  },
  {
    id: "s-12",
    run: "318577a8e",
    say: "Team is four: I'm Otieno Wekesa, CEO, I ran field sales for a solar distributor in Kisumu for five years; our CTO Achieng Mutua built M-Pesa payment systems at a Nairobi lender; and two field engineers.",
    script: () =>
      reading({
        reply:
          "Four people, with field sales and M-Pesa payments experience. What problem do these households face today?",
        asking: "company.problem",
        statements: [
          st({
            dimension: "company.team",
            value: {
              kind: "TEXT",
              text: "Otieno Wekesa, CEO; CTO Achieng Mutua; two field engineers",
            },
            words:
              "Team is four: I'm Otieno Wekesa, CEO, I ran field sales for a solar distributor in Kisumu for five years",
          }),
        ],
      }),
  },
  {
    // Live t15: the model asked the use of funds a third time; code put
    // the picker's question in, and kept "roughly in amounts?".
    id: "s-14",
    run: "318577a8e",
    say: "Different topic: to be precise about stage, we're really a Series A company now, not seed. We've been operating for four years.",
    script: (prompt) =>
      reading({
        reply:
          "That's a material correction: you're saying Series A rather than seed, and you've been operating for four years. Where does the money go, and how much to each, roughly in amounts?",
        intent: "CORRECTION",
        asking: "raise.use_of_funds",
        statements: [
          st({
            op: "CORRECTS",
            target: handleOn(prompt.text, "company.stage"),
            dimension: "company.stage",
            value: { kind: "CODE", code: "series_a" },
            words: "we're really a Series A company now, not seed",
          }),
          st({
            dimension: "application.note",
            value: {
              kind: "TEXT",
              text: "We've been operating for four years.",
            },
            words: "We've been operating for four years.",
          }),
        ],
      }),
  },
  {
    id: "s-16",
    run: "318577a8e",
    say: "Back to users: about 1,500 weekly users.",
    script: () =>
      reading({
        reply:
          "I have 600 weekly active users from earlier, and now about 1,500 weekly users. Which figure should I use?",
        asking: "claims.traction",
        statements: [
          st({
            dimension: "claims.traction",
            quantity: "weekly_active_users",
            unit: "weekly active user",
            provenance: "ESTIMATED",
            value: { kind: "COUNT", count: "1500" },
            words: "about 1,500 weekly users",
          }),
        ],
      }),
  },
  {
    id: "s-18",
    run: "318577a8e",
    say: "Leave it open.",
    script: (prompt) =>
      reading({
        reply:
          "Fair enough. What problem do these households face today that Solaix is solving?",
        asking: "company.problem",
        disagreementActions: [
          {
            disagreement: prompt.disagreement("claims.traction"),
            action: "LEAVE_OPEN",
            keep: null,
          },
        ],
      }),
  },
  {
    // Live t21: the model asked revenue (a stated zero); code dropped the
    // question and kept "if any?".
    id: "s-20",
    run: "318577a8e",
    say: "Roughly $200k to more kits and inventory, $90k to field agents in Busia and Siaya, and $60k to the payments and lock-out software.",
    script: () =>
      reading({
        reply:
          "That's a clear split: about two hundred thousand dollars for kits and inventory, ninety thousand for field agents in Busia and Siaya, and sixty thousand for the payments and lockout software. How much revenue are you making today, if any?",
        asking: "claims.revenue",
        statements: [
          st({
            dimension: "raise.use_of_funds",
            value: {
              kind: "TEXT",
              text: "$200k kits and inventory, $90k field agents, $60k payments and lock-out software",
            },
            words:
              "Roughly $200k to more kits and inventory, $90k to field agents in Busia and Siaya, and $60k to the payments and lock-out software.",
          }),
        ],
      }),
  },
  {
    id: "s-24",
    run: "318577a8e",
    say: "We haven't sized the market.",
    script: () =>
      reading({
        reply: "Understood. How do you make money once the pilot ends?",
        asking: "company.business_model",
        statements: [
          st({
            dimension: "company.market",
            value: { kind: "UNKNOWN", declined: false },
            provenance: "UNKNOWN",
            words: "We haven't sized the market.",
          }),
        ],
      }),
  },
  {
    id: "s-26",
    run: "318577a8e",
    say: "Off-grid families spend a lot on kerosene and phone charging, and the light is poor for children doing homework.",
    script: () =>
      reading({
        reply:
          "That's the customer problem: kerosene and phone charging cost a lot, and poor light makes homework harder. How do you make money once the pilot ends?",
        asking: "company.business_model",
        statements: [
          st({
            dimension: "company.problem",
            value: {
              kind: "TEXT",
              text: "off-grid families spend a lot on kerosene and phone charging",
            },
            words:
              "Off-grid families spend a lot on kerosene and phone charging",
          }),
        ],
      }),
  },
  {
    id: "s-30",
    run: "318577a8e",
    say: "Once the pilot ends each household pays 30 shillings a day until the kit is theirs.",
    script: () =>
      reading({
        reply:
          "Thirty shillings a day after the pilot, until each household owns the kit.",
        statements: [
          st({
            dimension: "company.business_model",
            value: {
              kind: "TEXT",
              text: "30 shillings a day per household until the kit is theirs",
            },
            words:
              "each household pays 30 shillings a day until the kit is theirs",
          }),
        ],
      }),
  },
  {
    // Live t32: the second half of the stage sentence became a note.
    id: "s-32",
    run: "318577a8e",
    say: "Our lead angel calls us seed, though, and honestly by revenue we're seed; by age I'd say Series A. I'm not sure which is right.",
    script: (prompt) =>
      reading({
        reply:
          "Fair enough, stage labels can get slippery. I have Series A from you already, and now seed by revenue; which stage should I use for this application?",
        asking: "company.stage",
        statements: [
          st({
            op: "DISAGREES",
            target: handleOn(prompt.text, "company.stage"),
            dimension: "company.stage",
            value: { kind: "CODE", code: "seed" },
            words:
              "Our lead angel calls us seed, though, and honestly by revenue we're seed",
          }),
          st({
            dimension: "application.note",
            value: {
              kind: "TEXT",
              text: "By age I'd say Series A. I'm not sure which is right.",
            },
            words: "by age I'd say Series A. I'm not sure which is right.",
          }),
        ],
      }),
  },
  {
    id: "s-34",
    run: "318577a8e",
    say: "Leave it open.",
    script: (prompt) =>
      reading({
        reply: OPEN_NEXT,
        disagreementActions: [
          {
            disagreement: prompt.disagreement("company.stage"),
            action: "LEAVE_OPEN",
            keep: null,
          },
        ],
      }),
  },
  {
    id: "s-36",
    run: "318577a8e",
    say: "Leave it open.",
    script: () => reading({ reply: OPEN_NEXT }),
  },
  {
    id: "s-38",
    run: "318577a8e",
    resumeBefore: true,
    say: "Leave it open for now.",
    script: () => reading({ reply: OPEN_NEXT }),
  },
  {
    id: "s-40",
    run: "318577a8e",
    say: "Day to day, an agent installs the kit, the household pays by M-Pesa, and the kit unlocks for each day that is paid.",
    script: () =>
      reading({
        reply:
          "That's a clear operating loop: agents install the kit, households pay through M-Pesa, and payment keeps it unlocked. What would you like to cover next?",
        statements: [
          st({
            dimension: "company.solution",
            value: {
              kind: "TEXT",
              text: "an agent installs the kit, the household pays by M-Pesa, the kit unlocks for each paid day",
            },
            words:
              "an agent installs the kit, the household pays by M-Pesa, and the kit unlocks for each day that is paid",
          }),
        ],
      }),
  },
  {
    id: "s-42",
    run: "318577a8e",
    say: "On weekly users, leave it open for Kilima.",
    script: () =>
      reading({ reply: "Understood. What would you like to cover next?" }),
  },
  {
    id: "s-44",
    run: "318577a8e",
    say: "We reach households through school head teachers and chama savings groups.",
    script: () =>
      reading({
        reply:
          "That gives me the route to the household: school head teachers and chama savings groups.",
        statements: [
          st({
            dimension: "application.note",
            value: {
              kind: "TEXT",
              text: "We reach households through school head teachers and chama savings groups.",
            },
            words:
              "We reach households through school head teachers and chama savings groups.",
          }),
        ],
      }),
  },
  {
    id: "s-50",
    run: "318577a8e",
    say: "That's all from me for now.",
    script: () =>
      reading({
        reply:
          "Thanks, Otieno. I have the core picture of Solaix. The stage question remains between Series A and seed, but there's nothing else I need from you right now.",
      }),
  },
];

const REVIEW_STEP = /\bFinish and review\b/u;
/** A reply's sentences: what a founder reads as one line each. */
const sentencesIn = (text: string): readonly string[] =>
  (text.match(/(?:[^.!?]|[.!?](?!\s|$))+[.!?]*/gu) ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

/** The model's own reply for a turn, as its script gives it. */
function modelReplyOf(turn: Turn, prompt: PromptSeen): string {
  const result = turn.script(prompt);
  return result === "FAIL" ? "" : result.reply;
}

function assertSixthOutcome(world: World, turn: Turn): void {
  const reply = qReply(world, turn.id);
  const prompt = world.prompts.at(-1);
  const model = prompt === undefined ? "" : modelReplyOf(turn, prompt);
  const modelSentences = sentencesIn(model);
  // P2a: every sentence Q sends is whole: one of the model's own, or a
  // line code wrote whole. Never the tail of a cut question.
  for (const sentence of sentencesIn(reply)) {
    expect(sentence, `${turn.id}: "${reply}"`).toMatch(/^[\p{Lu}\d"“]/u);
    if (model.includes(sentence))
      expect(modelSentences, `${turn.id}: a part of a sentence`).toContain(
        sentence,
      );
  }
  expect(reply, turn.id).not.toMatch(/roughly in amounts\?|\bif any\?/iu);
  // The close names everything that stays open at that moment.
  if (/everything I need/iu.test(reply))
    for (const entry of viewOf(world).dimensions)
      if (
        ["DISAGREEMENT_OPEN", "DISAGREEMENT_LEFT_OPEN", "UNKNOWN"].includes(
          entry.status,
        )
      )
        expect(reply.toLowerCase(), entry.dimension).toContain(
          entry.dimension.split(".")[1]?.replace(/_/gu, " ") ?? "(none)",
        );
  switch (turn.id) {
    case "s-14":
      expect(reply).toContain(
        "That's a material correction: you're saying Series A rather than seed, and you've been operating for four years.",
      );
      expect(reply).not.toMatch(/where does the money go/iu);
      break;
    case "s-20":
      expect(reply).toContain("sixty thousand for the payments");
      expect(reply).not.toMatch(/revenue/iu);
      break;
    case "s-32": {
      // P3b: the stage sentence stays with the stage; no half in the note.
      const notes = dimensionView(viewOf(world), "application.note").items.map(
        (i) => i.words,
      );
      expect(notes.join(" ")).not.toMatch(/series a|not sure which/iu);
      break;
    }
  }
}

describe("live reply replay: the sixth run (318577a8e), whole questions and a close that points to review", () => {
  it("cuts whole question sentences, closes once with what stays open, and never loops an open question", async () => {
    const world = statementWorld();
    let { intake, conversation } = world.services();
    const { token } = await intake.start({
      gatewayPublicId: "gq_23456789abcdefghjkmnpqrs99",
    });
    await intake.recordFacts({
      token,
      origin: "FORM",
      facts: factsFromAnswers(SIXTH_FORM),
    });
    world.scripts.push(() =>
      reading({
        reply:
          "Kilima brings together Nairobi-based operators to co-invest small cheques. What are you building, and who is it for?",
        asking: "company.description",
      }),
    );
    await conversation.openingFor({ token, correlationId: randomUUID() });

    let before = viewOf(world);
    for (const turn of SIXTH) {
      world.advance(60_000);
      if (turn.resumeBefore === true)
        ({ intake, conversation } = world.services());
      const calls = world.prompts.length;
      world.scripts.push(turn.script);
      await conversation.turn({
        token,
        message: turn.say,
        clientTurnId: turn.id,
        correlationId: randomUUID(),
      });
      const after = viewOf(world);
      assertAfterTurn(world, turn, after, before, world.prompts.length > calls);
      assertSixthOutcome(world, turn);
      before = after;
    }

    const qLines = world
      .store()
      .turnRows.filter((t) => t.role === "Q")
      .map((t) => t.text);
    // P2b: the open "what next?" is never sent, and no question is put
    // more than twice (once, and once more when it went unanswered).
    expect(qLines.filter((l) => /cover next/iu.test(l))).toEqual([]);
    const questions = qLines.flatMap((l) =>
      sentencesIn(l).filter((s) => s.endsWith("?")),
    );
    for (const question of new Set(questions))
      expect(
        questions.filter((q) => q === question).length,
        question,
      ).toBeLessThanOrEqual(2);
    // Q says once that it has what it needs, with what stays open, and
    // names the review step; the last turn still points there.
    const closes = qLines.filter((l) => /everything I need/iu.test(l));
    expect(closes).toHaveLength(1);
    const close = closes[0] ?? "";
    expect(close).toMatch(REVIEW_STEP);
    // The plan empties only once instrument, lead and website were asked
    // (live 5757518c7), by when stage disagrees too.
    expect(close).toMatch(
      /stage and traction each still have two answers that disagree/iu,
    );
    expect(close).toMatch(/market is not known yet/iu);
    // A turn whose open question was cut (t35–t43) never asks "what would
    // you like to cover next?": it asks the plan's question, on the
    // dimension its Q turn records, or, with nothing left, points to the
    // review.
    const closeSeq =
      world.store().turnRows.find((t) => t.role === "Q" && t.text === close)
        ?.seq ?? Number.MAX_SAFE_INTEGER;
    for (const id of ["s-34", "s-36", "s-38", "s-40", "s-42"]) {
      const row = world
        .store()
        .turnRows.find((t) => t.role === "Q" && t.clientTurnId === id);
      if (row === undefined || row.seq < closeSeq) {
        expect(row?.askingDimension ?? null, id).not.toBeNull();
        expect(qReply(world, id).trim().endsWith("?"), id).toBe(true);
      } else expect(qReply(world, id), id).toMatch(REVIEW_STEP);
    }
    const last = qLines.at(-1) ?? "";
    expect(last).toMatch(REVIEW_STEP);
    expect(last.trim().endsWith("?")).toBe(false);

    // The review the close points to holds both disagreements, resumed.
    const review = await intake.coverage(token);
    expect(review.coverage.contradictions).toHaveLength(2);
  });
});

describe("the reader files how the product works as the solution (live 318577a8e t40)", () => {
  it("reads with a prompt that says day to day is company.solution, never the business model", () => {
    const active =
      createPromptRegistry(PROMPT_DEFINITIONS).getActive(
        "GATEQ_INTERVIEWER",
      ).definition;
    expect(active.version).toBeGreaterThanOrEqual(11);
    expect(active.template).toContain(
      "How the product works day to day (who does what, step by step",
    );
    expect(active.template).toMatch(
      /is company\.solution, never company\.business_model/u,
    );
  });
});

/**
 * The seventh live run (re-certification 5757518c7, Stockum,
 * audits/2026-11-14-gateq-sustained-journey.md "Re-certification 15 Nov
 * (5757518c7)"), in the founder's words with the live model's replies:
 *
 *   - P2b: "That's everything I need for now" at t13, after six founder
 *     turns, and again at t45: whether the close was said was read from
 *     the last eight turns only;
 *   - P2b: seven replies ended with a question the model made up ("What
 *     would you like to clarify next?", "Which other part of the
 *     application would you like to clarify?", "What would you like to do
 *     next?"); a word list missed them;
 *   - P2b: the plan was empty at t13 while market, instrument and lead were
 *     unanswered;
 *   - P2: "We don't know our CAC yet." in answer to a market question was
 *     filed as Market not known; CAC was lost;
 *   - P3: "I'm not sure which is right" wrote a third Stage row, "Not known".
 */
const SEVENTH_FORM = {
  companyName: "Stockum",
  oneLiner:
    "Retail restocking for neighbourhood shops in Kenya: Stockum takes orders by app or USSD and delivers",
  stage: "seed",
  sectors: ["Commerce"],
  country: "KE",
  raise: { amount: "350000", currency: "USD" },
  contactName: "Otieno Omondi",
  contactEmail: "otieno@example.com",
};

/** The model's own open questions of the seventh run (asking nothing). */
const CLARIFY_NEXT = "Fair enough. What would you like to clarify next?";
const OTHER_PART =
  "Fair enough. Which other part of the application would you like to clarify?";

const SEVENTH: readonly Turn[] = [
  {
    id: "k-02",
    run: "5757518c7",
    say: "Stockum restocks neighbourhood dukas in Nairobi: shopkeepers order by app or USSD in the evening and we deliver next morning from partner distributors. I started it after watching my mother close her shop half a day every week to queue at a wholesaler.",
    script: () =>
      reading({
        reply:
          "Nairobi, app or USSD, and next-morning delivery: that's a clear operating rhythm. How many neighbourhood shops are customers today?",
        asking: "company.customers",
        statements: [
          st({
            dimension: "company.description",
            value: {
              kind: "TEXT",
              text: "Stockum restocks neighbourhood dukas in Nairobi",
            },
            words:
              "Stockum restocks neighbourhood dukas in Nairobi: shopkeepers order by app or USSD in the evening and we deliver next morning from partner distributors.",
          }),
          st({
            dimension: "company.problem",
            value: {
              kind: "TEXT",
              text: "my mother close her shop half a day every week to queue at a wholesaler",
            },
            words:
              "my mother close her shop half a day every week to queue at a wholesaler",
          }),
        ],
      }),
  },
  {
    id: "k-04",
    run: "5757518c7",
    say: "Traction so far: 18,000 crates delivered and 600 weekly active shops.",
    script: () =>
      reading({
        reply:
          "Eighteen thousand crates delivered and 600 weekly active shops: that's useful traction. How does the round split across uses, roughly in amounts?",
        asking: "raise.use_of_funds",
        statements: [
          st({
            dimension: "claims.traction",
            unit: "crate",
            value: { kind: "COUNT", count: "18000" },
            words: "18,000 crates delivered",
          }),
          st({
            dimension: "claims.traction",
            quantity: "weekly_active_users",
            unit: "weekly active user",
            value: { kind: "COUNT", count: "600" },
            words: "600 weekly active shops",
          }),
        ],
      }),
  },
  {
    id: "k-06",
    run: "5757518c7",
    say: "Nobody pays yet. Delivery is free for the first three months.",
    script: () =>
      reading({
        reply:
          "Understood: no paying customers yet, with delivery free for the first three months. Where does the money go, and how much to each?",
        asking: "raise.use_of_funds",
        statements: [
          st({
            dimension: "claims.revenue",
            quantity: "revenue",
            value: { kind: "ZERO" },
            words: "Nobody pays yet.",
          }),
          st({
            dimension: "claims.traction",
            quantity: "paying_customers",
            value: { kind: "ZERO" },
            words: "Nobody pays yet.",
          }),
          st({
            dimension: "company.business_model",
            value: {
              kind: "TEXT",
              text: "Delivery is free for the first three months.",
            },
            words: "Delivery is free for the first three months.",
          }),
        ],
      }),
  },
  {
    id: "k-08",
    run: "5757518c7",
    say: "On growth: we went from 1 kiosk-chain customer to 4 since March.",
    script: () =>
      reading({
        reply:
          "That's a useful growth signal: four kiosk-chain customers now, up from one since March. How big is the market for this, in numbers?",
        asking: "company.market",
        statements: [
          st({
            dimension: "claims.traction",
            quantity: "customers",
            unit: "customer",
            value: { kind: "COUNT", count: "4" },
            words: "we went from 1 kiosk-chain customer to 4 since March",
          }),
        ],
      }),
  },
  {
    // Live t10: said in answer to the market question. The reader names
    // the metric (CAC), whatever Q asked.
    id: "k-10",
    run: "5757518c7",
    say: "We don't know our CAC yet.",
    script: () =>
      reading({
        reply:
          "Fair enough: CAC isn't worked out yet. Who are the founders and key hires, and what is their relevant experience?",
        intent: "UNKNOWN_OR_SKIP",
        asking: "company.team",
        statements: [
          st({
            dimension: "application.note",
            quantity: "cac",
            value: { kind: "UNKNOWN", declined: false },
            provenance: "UNKNOWN",
            words: "We don't know our CAC yet.",
          }),
        ],
      }),
  },
  {
    // Live t13: the full close, after six founder turns.
    id: "k-12",
    run: "5757518c7",
    say: "Team is four: I'm Otieno Omondi, CEO, I ran route sales for a soft-drinks distributor in Nairobi for six years; our CTO Wanjiku Mwangi built USSD ordering at a Nairobi bank; and two operations leads.",
    script: () =>
      reading({
        reply:
          "Four people: you as CEO, with six years in Nairobi route sales; Wanjiku as CTO, with USSD-ordering experience at a Nairobi bank; and two operations leads.",
        statements: [
          st({
            dimension: "company.team",
            value: {
              kind: "TEXT",
              text: "Otieno Omondi, CEO; CTO Wanjiku Mwangi; two operations leads",
            },
            words:
              "Team is four: I'm Otieno Omondi, CEO, I ran route sales for a soft-drinks distributor in Nairobi for six years",
          }),
        ],
      }),
  },
  {
    id: "k-14",
    run: "5757518c7",
    say: "Different topic: to be precise about stage, we're really a Series A company now, not seed. We've been operating for four years.",
    script: (prompt) =>
      reading({
        reply: "Thanks for the correction.",
        intent: "CORRECTION",
        statements: [
          st({
            op: "CORRECTS",
            target: handleOn(prompt.text, "company.stage"),
            dimension: "company.stage",
            value: { kind: "CODE", code: "series_a" },
            words: "we're really a Series A company now, not seed",
          }),
          st({
            dimension: "application.note",
            value: {
              kind: "TEXT",
              text: "We've been operating for four years.",
            },
            words: "We've been operating for four years",
          }),
        ],
      }),
  },
  {
    id: "k-16",
    run: "5757518c7",
    say: "Back to users: about 1,500 weekly active shops.",
    script: () =>
      reading({
        reply:
          "I have 600 weekly active shops here, and you've now said about 1,500. Which figure is right?",
        asking: "claims.traction",
        statements: [
          st({
            dimension: "claims.traction",
            quantity: "weekly_active_users",
            unit: "weekly active user",
            value: { kind: "COUNT", count: "1500" },
            words: "about 1,500 weekly active shops",
          }),
        ],
      }),
  },
  {
    id: "k-18",
    run: "5757518c7",
    say: "Leave it open.",
    script: (prompt) =>
      reading({
        reply: "Fair enough.",
        disagreementActions: [
          {
            disagreement: prompt.disagreement("claims.traction"),
            action: "LEAVE_OPEN",
            keep: null,
          },
        ],
      }),
  },
  {
    id: "k-20",
    run: "5757518c7",
    say: "Roughly $200k to delivery vans, $90k to field agents in Kayole and Githurai, and $60k to the ordering app and USSD.",
    script: () =>
      reading({
        reply:
          "That gives me the shape of the raise: about two hundred thousand dollars for delivery vans, ninety thousand for field agents in Kayole and Githurai, and sixty thousand for the ordering app and USSD.",
        statements: [
          st({
            dimension: "raise.use_of_funds",
            value: {
              kind: "TEXT",
              text: "$200k delivery vans, $90k field agents, $60k ordering app and USSD",
            },
            words:
              "Roughly $200k to delivery vans, $90k to field agents in Kayole and Githurai, and $60k to the ordering app and USSD.",
          }),
        ],
      }),
  },
  {
    id: "k-22",
    run: "5757518c7",
    say: "Sorry, I meant 400k, not 350k.",
    script: (prompt) =>
      reading({
        reply:
          "Understood: you're correcting the raise from 350,000 dollars to 400,000 dollars.",
        intent: "CORRECTION",
        statements: [
          st({
            op: "CORRECTS",
            target: handleOn(prompt.text, "raise.amount"),
            dimension: "raise.amount",
            quantity: "raise_amount",
            value: { kind: "MONEY", amount: "400000", currency: "USD" },
            words: "Sorry, I meant 400k, not 350k.",
          }),
        ],
      }),
  },
  {
    // Live t25: "What would you like to do next?"
    id: "k-24",
    run: "5757518c7",
    say: "We haven't sized the market.",
    script: () =>
      reading({
        reply:
          "Understood: the market isn't sized yet. What would you like to do next?",
        intent: "UNKNOWN_OR_SKIP",
        statements: [
          st({
            dimension: "company.market",
            value: { kind: "UNKNOWN", declined: false },
            provenance: "UNKNOWN",
            words: "We haven't sized the market.",
          }),
        ],
      }),
  },
  {
    id: "k-26",
    run: "5757518c7",
    say: "Shopkeepers lose half a day a week queuing at wholesalers, and they run out of fast-moving stock like flour and cooking oil.",
    script: () =>
      reading({
        reply:
          "That makes the pain very concrete: lost selling time and stockouts on everyday essentials.",
        statements: [
          st({
            dimension: "company.problem",
            value: {
              kind: "TEXT",
              text: "Shopkeepers lose half a day a week queuing at wholesalers",
            },
            words: "Shopkeepers lose half a day a week queuing at wholesalers",
          }),
        ],
      }),
  },
  {
    id: "k-28",
    run: "5757518c7",
    say: "The main risk is that distributors start their own delivery and cut us out.",
    script: () =>
      reading({
        reply:
          "That's a real strategic risk: distributors could start delivering directly and cut Stockum out.",
        statements: [
          st({
            dimension: "application.note",
            value: {
              kind: "TEXT",
              text: "The main risk is that distributors start their own delivery and cut us out.",
            },
            words:
              "The main risk is that distributors start their own delivery and cut us out.",
          }),
        ],
      }),
  },
  {
    id: "k-30",
    run: "5757518c7",
    say: "Once the trial ends each shop pays a 3% fee on every order.",
    script: () =>
      reading({
        reply:
          "That clarifies the model: after the trial, each shop pays a 3% fee on every order.",
        statements: [
          st({
            dimension: "company.business_model",
            value: {
              kind: "TEXT",
              text: "Once the trial ends each shop pays a 3% fee on every order.",
            },
            words:
              "Once the trial ends each shop pays a 3% fee on every order.",
          }),
        ],
      }),
  },
  {
    // Live t32: "I'm not sure which is right" became a third Stage row.
    id: "k-32",
    run: "5757518c7",
    say: "Our lead angel calls us seed, though, and honestly by revenue we're seed; by age I'd say Series A. I'm not sure which is right.",
    script: (prompt) =>
      reading({
        reply:
          "I hear the split: your lead angel calls Stockum seed, while you describe it as seed by revenue and Series A by age. Which stage should I use for the application?",
        asking: "company.stage",
        statements: [
          st({
            op: "DISAGREES",
            target: handleOn(prompt.text, "company.stage"),
            dimension: "company.stage",
            value: { kind: "CODE", code: "seed" },
            words:
              "Our lead angel calls us seed, though, and honestly by revenue we're seed",
          }),
          st({
            dimension: "company.stage",
            value: { kind: "UNKNOWN", declined: false },
            provenance: "UNKNOWN",
            words: "I'm not sure which is right",
          }),
        ],
      }),
  },
  {
    id: "k-34",
    run: "5757518c7",
    say: "Leave it open.",
    script: (prompt) =>
      reading({
        reply: OTHER_PART,
        disagreementActions: [
          {
            disagreement: prompt.disagreement("company.stage"),
            action: "LEAVE_OPEN",
            keep: null,
          },
        ],
      }),
  },
  {
    id: "k-36",
    run: "5757518c7",
    say: "Leave it open.",
    script: () => reading({ reply: OTHER_PART }),
  },
  {
    id: "k-38",
    run: "5757518c7",
    resumeBefore: true,
    say: "Leave it open for now.",
    script: () => reading({ reply: CLARIFY_NEXT }),
  },
  {
    // Live t41: "What part of that process would you like to clarify next?"
    id: "k-40",
    run: "5757518c7",
    say: "Day to day, a shopkeeper orders on the app or by USSD before 8pm, we batch the orders by estate, and our rider collects from the distributor and delivers by 7am; the shop pays on delivery by M-Pesa.",
    script: () =>
      reading({
        reply:
          "That's a clear day-to-day flow, and M-Pesa on delivery makes the payment step easy to understand. What part of that process would you like to clarify next?",
        statements: [
          st({
            dimension: "company.solution",
            value: {
              kind: "TEXT",
              text: "orders by app or USSD before 8pm, batched by estate, delivered by 7am, paid on delivery by M-Pesa",
            },
            words:
              "Day to day, a shopkeeper orders on the app or by USSD before 8pm, we batch the orders by estate, and our rider collects from the distributor and delivers by 7am",
          }),
        ],
      }),
  },
  {
    id: "k-42",
    run: "5757518c7",
    say: "On weekly users, leave it open for Kilima.",
    script: () => reading({ reply: CLARIFY_NEXT }),
  },
  {
    // Live t45: the full close again, the t13 close out of the last eight.
    id: "k-44",
    run: "5757518c7",
    say: "We reach shops through distributor sales reps and church chama groups.",
    script: () =>
      reading({
        reply:
          "Distributor sales reps and church chama groups: that gives me two clear routes into the shops.",
        statements: [
          st({
            dimension: "company.business_model",
            value: {
              kind: "TEXT",
              text: "We reach shops through distributor sales reps and church chama groups.",
            },
            words:
              "We reach shops through distributor sales reps and church chama groups.",
          }),
        ],
      }),
  },
  {
    id: "k-46",
    run: "5757518c7",
    say: "Anything else you need from me?",
    script: () =>
      reading({ reply: "Thanks for checking.", intent: "QUESTION_FOR_Q" }),
  },
  {
    id: "k-48",
    run: "5757518c7",
    say: "Beyond capital, introductions to FMCG distributors and to a county trade office would help most.",
    script: () =>
      reading({
        reply:
          "That makes sense: distribution relationships are central to the model.",
        statements: [
          st({
            dimension: "application.note",
            value: {
              kind: "TEXT",
              text: "Beyond capital, introductions to FMCG distributors and to a county trade office would help most.",
            },
            words:
              "Beyond capital, introductions to FMCG distributors and to a county trade office would help most.",
          }),
        ],
      }),
  },
  {
    // Live t51: "A SAFE, and no lead yet, got it. What would you like to
    // clarify next?"
    id: "k-50",
    run: "5757518c7",
    say: "We'd take the round as a SAFE, and we don't have a lead investor yet.",
    script: () =>
      reading({
        reply:
          "A SAFE, and no lead yet: got it. What would you like to clarify next?",
        statements: [
          st({
            dimension: "raise.instrument",
            value: { kind: "TEXT", text: "SAFE" },
            words: "We'd take the round as a SAFE",
          }),
          st({
            dimension: "raise.lead_status",
            value: { kind: "TEXT", text: "no lead investor yet" },
            words: "we don't have a lead investor yet",
          }),
        ],
      }),
  },
  {
    id: "k-52",
    run: "5757518c7",
    say: "Is there anything else you still need?",
    script: () =>
      reading({ reply: "Thanks for asking.", intent: "QUESTION_FOR_Q" }),
  },
  {
    id: "k-54",
    run: "5757518c7",
    say: "That's all from me for now.",
    script: () =>
      reading({
        reply:
          "Understood. You've covered what I need, and you can review and submit when you're ready.",
        intent: "SUBMIT_INTENT",
      }),
  },
];

/** The model-made open questions of the seventh run, sentence by sentence. */
const MADE_UP_QUESTIONS =
  /would you like to (?:clarify|do)|which other part|what part of that process/iu;
const CLOSE = /That's everything I need for now\./u;
/** Coverage dimensions the plan must not give up on before the close. */
const CORE_AT_CLOSE = [
  "company.market",
  "raise.instrument",
  "raise.lead_status",
] as const;

async function seventhWorld() {
  const world = statementWorld();
  const services = world.services();
  const { token } = await services.intake.start({
    gatewayPublicId: "gq_23456789abcdefghjkmnpqrs99",
  });
  await services.intake.recordFacts({
    token,
    origin: "FORM",
    facts: factsFromAnswers(SEVENTH_FORM),
  });
  world.scripts.push(() =>
    reading({
      reply:
        "Kilima brings together Nairobi operators who co-invest in East African founders. What are you building, and who is it for?",
      asking: "company.description",
    }),
  );
  await services.conversation.openingFor({
    token,
    correlationId: randomUUID(),
  });
  return { world, services, token };
}

describe("live reply replay: the seventh run (5757518c7), the plan decides how a reply ends", () => {
  it("closes once when the plan first empties, never ends on a made-up question, and files CAC as CAC", async () => {
    const { world, services, token } = await seventhWorld();
    let { conversation } = services;
    let before = viewOf(world);
    /** Per core dimension at the close: answered, or asked to its cap. */
    let coreAtClose: Record<string, boolean> | null = null;
    for (const turn of SEVENTH) {
      world.advance(60_000);
      if (turn.resumeBefore === true) ({ conversation } = world.services());
      const calls = world.prompts.length;
      world.scripts.push(turn.script);
      await conversation.turn({
        token,
        message: turn.say,
        clientTurnId: turn.id,
        correlationId: randomUUID(),
      });
      const after = viewOf(world);
      assertAfterTurn(world, turn, after, before, world.prompts.length > calls);
      before = after;

      const reply = qReply(world, turn.id);
      // Every sentence Q sends is whole: one of the model's own, or a line
      // code wrote whole.
      const prompt = world.prompts.at(-1);
      const model = prompt === undefined ? "" : modelReplyOf(turn, prompt);
      for (const sentence of sentencesIn(reply)) {
        expect(sentence, `${turn.id}: "${reply}"`).toMatch(/^[\p{Lu}\d"“]/u);
        if (model.includes(sentence))
          expect(sentencesIn(model), turn.id).toContain(sentence);
      }
      if (coreAtClose === null && CLOSE.test(reply)) {
        const qRows = world.store().turnRows.filter((t) => t.role === "Q");
        coreAtClose = Object.fromEntries(
          CORE_AT_CLOSE.map((dimension) => [
            dimension,
            dimensionView(after, dimension).status !== "UNANSWERED" ||
              qRows.filter((t) => t.askingDimension === dimension).length >= 2,
          ]),
        );
      }
      // P2: CAC is CAC, though said to a market question; market is
      // untouched.
      if (turn.id === "k-10") {
        const cac = byWords(world, "We don't know our CAC yet.");
        expect(cac.dimension).toBe("company.business_model");
        expect(cac.quantity).toBe("cac");
        expect(cac.value.kind).toBe("UNKNOWN");
        expect(dimensionView(after, "company.market").status).toBe(
          "UNANSWERED",
        );
      }
      // P3: "not sure which is right" is the disagreement they leave open,
      // never a third Stage answer.
      if (turn.id === "k-32")
        expect(
          dimensionView(after, "company.stage").items.filter(
            (i) => i.value.kind === "UNKNOWN",
          ),
        ).toEqual([]);
    }

    const qRows = world.store().turnRows.filter((t) => t.role === "Q");
    // P2b: every reply ends with the plan's question or with none. A reply
    // that ends on a question names the dimension the plan put, and no
    // question the model made up is ever sent.
    for (const row of qRows) {
      const last = sentencesIn(row.text).at(-1) ?? "";
      if (last.endsWith("?"))
        expect(row.askingDimension, `"${row.text}"`).not.toBeNull();
      for (const sentence of sentencesIn(row.text))
        expect(sentence, `"${row.text}"`).not.toMatch(MADE_UP_QUESTIONS);
    }
    // Mid-interview, no reply leaves the founder without a next step: the
    // turns where the model asked nothing while the plan had more (live:
    // "Thanks for the correction.", "Fair enough.", the stall the owner
    // saw) end with the plan's question, in fixed words, on a dimension.
    const firstClose =
      qRows.find((t) => CLOSE.test(t.text))?.seq ?? Number.MAX_SAFE_INTEGER;
    for (const id of ["k-12", "k-14", "k-18", "k-20", "k-22", "k-26"]) {
      const row = qRows.find((t) => t.clientTurnId === id);
      expect(row?.seq ?? 0, id).toBeLessThan(firstClose);
      expect(row?.text.trim().endsWith("?"), `${id}: "${row?.text}"`).toBe(
        true,
      );
      expect(row?.askingDimension ?? null, id).not.toBeNull();
    }
    expect(qReply(world, "k-14")).toBe(
      "Thanks for the correction. What instrument and terms are proposed for the round?",
    );
    for (const row of qRows.filter((t) => t.seq < firstClose))
      expect(row.text.trim().endsWith("?"), `"${row.text}"`).toBe(true);
    // The close is said once each time the plan empties, and not before the
    // core dimensions were answered or asked to their cap (live: at t13 and
    // again at t45 with nothing reopened between). Here the plan empties at
    // k-28; at k-32 the lead angel's "seed" is new information that
    // disagrees with the stage on record, Q asks which is right, and the
    // plan empties again at k-34. Never a third time.
    const closes = qRows.filter((t) => CLOSE.test(t.text));
    expect(closes.map((t) => t.clientTurnId)).toEqual(["k-28", "k-34"]);
    expect(qRows.find((t) => t.clientTurnId === "k-32")?.askingDimension).toBe(
      "company.stage",
    );
    for (const row of qRows.filter(
      (t) => t.seq > (closes[0]?.seq ?? 0) && t.seq < (closes[1]?.seq ?? 0),
    )) {
      expect(CLOSE.test(row.text), row.clientTurnId).toBe(false);
      if (row.askingDimension === null)
        expect(row.text, row.clientTurnId).toContain(
          "Finish and review is ready whenever you are.",
        );
    }
    expect(coreAtClose).toEqual({
      "company.market": true,
      "raise.instrument": true,
      "raise.lead_status": true,
    });
    expect(closes[0]?.text).toMatch(REVIEW_STEP);
    // After it, a turn with nothing left only points to the review.
    const closeSeq = closes.at(-1)?.seq ?? Number.MAX_SAFE_INTEGER;
    for (const row of qRows.filter((t) => t.seq > closeSeq))
      if (row.askingDimension === null)
        expect(row.text, row.clientTurnId).toContain(
          "Finish and review is ready whenever you are.",
        );
    const lastQ = qRows.at(-1)?.text ?? "";
    expect(lastQ).toMatch(REVIEW_STEP);
    expect(lastQ.trim().endsWith("?")).toBe(false);
  });

  it("clears the close when new information reopens the plan, and says it again when the plan empties", async () => {
    const { world, services, token } = await seventhWorld();
    const { conversation } = services;
    const say = async (id: string, message: string, script: Script) => {
      world.advance(60_000);
      world.scripts.push(script);
      await conversation.turn({
        token,
        message,
        clientTurnId: id,
        correlationId: randomUUID(),
      });
      return qReply(world, id);
    };
    for (const turn of SEVENTH) await say(turn.id, turn.say, turn.script);
    // k-28 and, after the stage disagreement reopened the plan, k-34.
    expect(
      world
        .store()
        .turnRows.filter((t) => t.role === "Q" && CLOSE.test(t.text)),
    ).toHaveLength(2);
    // New information: a different raise reopens the plan.
    const reopened = await say(
      "k-56",
      "Our lead angel thinks we should raise 500k.",
      (prompt) =>
        reading({
          reply:
            "That's a different figure from the 400,000 on record. Which raise should I use?",
          asking: "raise.amount",
          statements: [
            st({
              op: "DISAGREES",
              target: prompt.statement("Sorry, I meant 400k, not 350k."),
              dimension: "raise.amount",
              quantity: "raise_amount",
              value: { kind: "MONEY", amount: "500000", currency: "USD" },
              words: "Our lead angel thinks we should raise 500k.",
            }),
          ],
        }),
    );
    expect(reopened).not.toMatch(CLOSE);
    expect(reopened).not.toMatch(REVIEW_STEP);
    expect(reopened.trim().endsWith("?")).toBe(true);
    const leftOpen = await say("k-58", "Leave it open.", (prompt) =>
      reading({
        reply: "Fair enough.",
        disagreementActions: [
          {
            disagreement: prompt.disagreement("raise.amount"),
            action: "LEAVE_OPEN",
            keep: null,
          },
        ],
      }),
    );
    // The plan is empty again: the close is said again, once.
    expect(leftOpen).toMatch(CLOSE);
    const later = await say("k-60", "Thanks.", () =>
      reading({ reply: "You're welcome." }),
    );
    expect(later).not.toMatch(CLOSE);
    expect(later).toContain("Finish and review is ready whenever you are.");
  });

  it("ends a reply that asks nothing with the plan's question, unless it answers their question about that very question", async () => {
    const { world, services, token } = await seventhWorld();
    const { conversation } = services;
    const say = async (id: string, message: string, script: Script) => {
      world.advance(60_000);
      world.scripts.push(script);
      await conversation.turn({
        token,
        message,
        clientTurnId: id,
        correlationId: randomUUID(),
      });
      return world
        .store()
        .turnRows.find((t) => t.role === "Q" && t.clientTurnId === id);
    };
    // An answer the model acknowledged and asked nothing after (the
    // seventh run's "Thanks for the correction."): the plan's question.
    const acknowledged = await say(
      "x-01",
      "We deliver crates to neighbourhood shops in Nairobi.",
      () => reading({ reply: "Thanks, that's helpful." }),
    );
    expect(acknowledged?.text).toBe(
      "Thanks, that's helpful. What problem does the company solve, and for whom is it most acute?",
    );
    expect(acknowledged?.askingDimension).toBe("company.problem");
    // They ask Q about that question, which the plan still puts next: the
    // answer is the point, and the question it explains still stands, so
    // it is not repeated straight after it.
    const explained = await say("x-02", "What do you mean by most acute?", () =>
      reading({
        reply: "I mean the customers who feel the problem most often.",
        intent: "QUESTION_FOR_Q",
      }),
    );
    expect(explained?.text).toBe(
      "I mean the customers who feel the problem most often.",
    );
    expect(explained?.askingDimension ?? null).toBeNull();
    // A question about something else: the answer, then the plan's next
    // question in fixed words.
    const answered = await say("x-03", "Do you need my pitch deck?", () =>
      reading({
        reply: "No deck is needed; your own words are enough.",
        intent: "QUESTION_FOR_Q",
      }),
    );
    expect(answered?.text).toMatch(
      /^No deck is needed; your own words are enough\. \p{Lu}[^?]*\?$/u,
    );
    expect(answered?.askingDimension ?? null).not.toBeNull();
  });
});

/**
 * The eighth live run (64637e8c9, application a14dbecf, Dukaari Africa):
 * the endings passed, one P1 broke invariants 1, 3 and 4. Replayed with
 * the form the founder saved and, turn by turn, the reply, asking label
 * and reading the live model gave:
 *
 *   - P1: "It buys about 18 months" was read as a raise (MONEY 18, no
 *     currency of its own, no unit) and stored as USD 18 from the turn's
 *     "$"; code paired it with the form's 350,000; "Yes, that's right."
 *     to Q's read-back corrected the 18 to 350,000; "I meant 400k, not
 *     350k" corrected the form; and 350,000 vs 400,000 stood as an open
 *     raise dispute, re-asked at t29 and announced at the close.
 *   - P3: the CAC unknown carried no metric (v12 still said "CAC is not on
 *     the list"), so it showed as an unlabelled "Business model: Not
 *     known" beside the later "$12 per shop", which never answered it.
 *   - P3: "You can finish and review when you're ready." plus the pointer
 *     named the review twice in one reply (t53, t59).
 */
const EIGHTH_FORM = {
  companyName: "Dukaari Africa",
  oneLiner:
    "Neighbourhood-shop restocking in Kisumu: Dukaari takes orders by app or USSD and delivers",
  stage: "seed",
  sectors: ["Commerce"],
  country: "KE",
  raise: { amount: "350000", currency: "USD" },
  contactName: "Kamau Chege",
  contactEmail: "kamau@example.com",
};

/** Every S<n> KNOWN FACTS lists on a dimension, in order. */
function handlesOn(text: string, dimension: string): readonly string[] {
  const found: string[] = [];
  for (let nth = 0; ; nth += 1) {
    try {
      found.push(handleOn(text, dimension, nth));
    } catch {
      return found;
    }
  }
}

const EIGHTH: readonly Turn[] = [
  {
    id: "e-02",
    run: "64637e8c9",
    say: "Dukaari restocks neighbourhood dukas in Kisumu: shopkeepers order by app or USSD in the evening and we deliver next morning from partner distributors. I started it after watching my aunt close her shop half a day every week to queue at a wholesaler.",
    script: () =>
      reading({
        reply:
          "Kisumu, got it. That wholesaler queue is a very concrete problem; how many neighbourhood shops are ordering from you today?",
        asking: "company.customers",
        statements: [
          st({
            dimension: "company.description",
            value: {
              kind: "TEXT",
              text: "Dukaari restocks neighbourhood dukas in Kisumu",
            },
            words:
              "Dukaari restocks neighbourhood dukas in Kisumu: shopkeepers order by app or USSD in the evening and we deliver next morning from partner distributors.",
          }),
          st({
            dimension: "company.problem",
            value: {
              kind: "TEXT",
              text: "my aunt close her shop half a day every week to queue at a wholesaler",
            },
            words:
              "my aunt close her shop half a day every week to queue at a wholesaler",
          }),
        ],
      }),
  },
  {
    id: "e-04",
    run: "64637e8c9",
    say: "Traction so far: 16,000 crates delivered and 500 weekly active shops.",
    script: () =>
      reading({
        reply:
          "Sixteen thousand crates delivered and 500 weekly active shops, nice. How does the round split across uses, roughly in amounts?",
        asking: "raise.use_of_funds",
        statements: [
          st({
            dimension: "claims.traction",
            unit: "crate",
            value: { kind: "COUNT", count: "16000" },
            words: "16,000 crates delivered",
          }),
          st({
            dimension: "claims.traction",
            quantity: "weekly_active_users",
            unit: "weekly active user",
            value: { kind: "COUNT", count: "500" },
            words: "500 weekly active shops",
          }),
        ],
      }),
  },
  {
    id: "e-06",
    run: "64637e8c9",
    say: "Nobody pays yet. Delivery is free for the first three months.",
    script: () =>
      reading({
        reply:
          "No customers are paying yet, and delivery is free for the first three months. What does this round buy in runway and milestones?",
        asking: "raise.use_of_funds",
        statements: [
          st({
            dimension: "claims.revenue",
            quantity: "revenue",
            value: { kind: "ZERO" },
            words: "Nobody pays yet.",
          }),
        ],
      }),
  },
  {
    id: "e-08",
    run: "64637e8c9",
    say: "On growth: we went from 1 kiosk-chain customer to 4 since March.",
    script: () =>
      reading({
        reply:
          "That's a useful growth signal: from one kiosk-chain customer to four since March. How does Dukaari make money once the free-delivery period ends?",
        asking: "company.business_model",
        statements: [
          st({
            dimension: "claims.traction",
            quantity: "customers",
            unit: "customer",
            value: { kind: "COUNT", count: "4" },
            words: "we went from 1 kiosk-chain customer to 4 since March",
          }),
        ],
      }),
  },
  {
    // Live t10: the raise worked out from the split (read back by code),
    // and the 18 months read as a raise of 18, with no currency and no
    // unit of its own.
    id: "e-10",
    run: "64637e8c9",
    say: "Roughly $200k to delivery vans, $90k to field agents in Nyalenda and Manyatta, and $60k to the ordering app and USSD. It buys about 18 months.",
    script: () =>
      reading({
        reply:
          "So the raise is roughly two hundred thousand dollars for delivery vans, ninety thousand for field agents in Nyalenda and Manyatta, and sixty thousand for the ordering app and USSD—about eighteen months of runway.",
        asking: "raise.amount",
        statements: [
          st({
            dimension: "raise.use_of_funds",
            value: {
              kind: "TEXT",
              text: "$200k delivery vans, $90k field agents, $60k ordering app and USSD",
            },
            words:
              "Roughly $200k to delivery vans, $90k to field agents in Nyalenda and Manyatta, and $60k to the ordering app and USSD.",
          }),
          st({
            dimension: "raise.amount",
            quantity: "raise_amount",
            value: { kind: "MONEY", amount: "350000", currency: "USD" },
            words:
              "Roughly $200k to delivery vans, $90k to field agents in Nyalenda and Manyatta, and $60k to the ordering app and USSD.",
          }),
          st({
            dimension: "raise.amount",
            quantity: "raise_amount",
            unit: null,
            value: { kind: "MONEY", amount: "18", currency: null },
            words: "It buys about 18 months.",
          }),
        ],
      }),
  },
  {
    // Live t12: the yes to Q's read-back, read as correcting the raise Q
    // was last shown (live: the 18) to 350,000.
    id: "e-12",
    run: "64637e8c9",
    say: "Yes, that's right.",
    script: (prompt) =>
      reading({
        reply:
          "Perfect, that settles the raise at three hundred and fifty thousand dollars. I'd like to understand the team behind Dukaari—who's building it, and what does each person lead?",
        intent: "CORRECTION",
        asking: "company.team",
        statements: [
          st({
            op: "CORRECTS",
            target: handlesOn(prompt.text, "raise.amount").at(-1) ?? null,
            dimension: "raise.amount",
            quantity: "raise_amount",
            value: { kind: "MONEY", amount: "350000", currency: "USD" },
            words: "Yes, that's right.",
          }),
        ],
      }),
  },
  {
    id: "e-14",
    run: "64637e8c9",
    say: "Team is four: I'm Kamau Chege, CEO, I ran route sales for a soft-drinks distributor in Kisumu for six years; our CTO Akinyi Otieno built USSD ordering at a Kisumu bank; and two operations leads.",
    script: () =>
      reading({
        reply:
          "Four people, with strong local distribution and USSD experience—that's a useful fit for the problem. How does the company make money, and what are the unit economics?",
        asking: "company.business_model",
        statements: [
          st({
            dimension: "company.team",
            value: {
              kind: "TEXT",
              text: "Kamau Chege, CEO; CTO Akinyi Otieno; two operations leads",
            },
            words:
              "Team is four: I'm Kamau Chege, CEO, I ran route sales for a soft-drinks distributor in Kisumu for six years; our CTO Akinyi Otieno built USSD ordering at a Kisumu bank; and two operations leads.",
          }),
        ],
      }),
  },
  {
    id: "e-16",
    run: "64637e8c9",
    say: "Once the trial ends each shop pays a 3% fee on every order.",
    script: () =>
      reading({
        reply:
          "A three percent fee on every order once the trial ends—that gives me the model. What does the opportunity look like in numbers, and how did you size it?",
        asking: "company.market",
        statements: [
          st({
            dimension: "company.business_model",
            value: {
              kind: "TEXT",
              text: "each shop pays a 3% fee on every order",
            },
            words:
              "Once the trial ends each shop pays a 3% fee on every order.",
          }),
        ],
      }),
  },
  {
    // Live t18: on the right dimension, but with no metric.
    id: "e-18",
    run: "64637e8c9",
    say: "We don't know our CAC yet.",
    script: () =>
      reading({
        reply:
          "Fair enough—CAC isn't sized yet. Let's take the market from another angle: what are your TAM, SAM and SOM, and how did you get there?",
        intent: "UNKNOWN_OR_SKIP",
        asking: "company.market",
        statements: [
          st({
            dimension: "company.business_model",
            value: { kind: "UNKNOWN", declined: false },
            provenance: "UNKNOWN",
            words: "We don't know our CAC yet.",
          }),
        ],
      }),
  },
  {
    // Live t20: read as disagreeing with the form's seed.
    id: "e-20",
    run: "64637e8c9",
    say: "Different topic: to be precise about stage, we're really a Series A company now, not seed. We've been operating for four years.",
    script: (prompt) =>
      reading({
        reply:
          "That's a material change: you're saying Series A rather than seed, and you've been operating for four years. Which stage should I treat as the current one?",
        intent: "CORRECTION",
        asking: "company.stage",
        statements: [
          st({
            op: "DISAGREES",
            target: handleOn(prompt.text, "company.stage"),
            dimension: "company.stage",
            value: { kind: "CODE", code: "series_a" },
            words: "we're really a Series A company now, not seed",
          }),
          st({
            dimension: "application.note",
            value: {
              kind: "TEXT",
              text: "We've been operating for four years.",
            },
            words: "We've been operating for four years",
          }),
        ],
      }),
  },
  {
    id: "e-22",
    run: "64637e8c9",
    say: "Back to users: about 1,300 weekly active shops.",
    script: () =>
      reading({
        reply:
          "I have 1,300 weekly active shops now, rather than the 500 you mentioned earlier. Which figure is right?",
        asking: "claims.traction",
        statements: [
          st({
            dimension: "claims.traction",
            quantity: "weekly_active_users",
            unit: "weekly active user",
            value: { kind: "COUNT", count: "1300" },
            words: "about 1,300 weekly active shops",
          }),
        ],
      }),
  },
  {
    // Live t24: both standing disagreements left open (2 events).
    id: "e-24",
    run: "64637e8c9",
    say: "Leave it open.",
    script: (prompt) =>
      reading({
        reply:
          "Fair enough. What's the instrument for the three-hundred-and-fifty-thousand-dollar raise?",
        asking: "raise.instrument",
        disagreementActions: [
          {
            disagreement: prompt.disagreement("claims.traction"),
            action: "LEAVE_OPEN",
            keep: null,
          },
          {
            disagreement: prompt.disagreement("company.stage"),
            action: "LEAVE_OPEN",
            keep: null,
          },
        ],
      }),
  },
  {
    // Live t26: a signalled correction of the form's raise.
    id: "e-26",
    run: "64637e8c9",
    say: "Sorry, I meant 400k, not 350k.",
    script: (prompt) =>
      reading({
        reply:
          "Understood—four hundred thousand, not three hundred and fifty. What instrument are you using for the raise?",
        intent: "CORRECTION",
        asking: "raise.instrument",
        statements: [
          st({
            op: "CORRECTS",
            target: handleOn(prompt.text, "raise.amount"),
            dimension: "raise.amount",
            quantity: "raise_amount",
            value: { kind: "MONEY", amount: "400000", currency: "USD" },
            words: "Sorry, I meant 400k, not 350k.",
          }),
        ],
      }),
  },
  {
    // Live t29: the answer, then the raise asked again (the false dispute
    // made it askable).
    id: "e-28",
    run: "64637e8c9",
    say: "Before that, a question for you: what does Kilima usually look at first in an application like this?",
    script: () =>
      reading({
        reply:
          "Kilima says it asks about the stage it invests at, where the company is based, the sectors it focuses on, the round size it can join, and its cheque size. It doesn't publish an order beyond that. How much is the company raising in this round?",
        intent: "QUESTION_FOR_Q",
        asking: "raise.amount",
      }),
  },
  {
    id: "e-30",
    run: "64637e8c9",
    say: "We'd take the round as a SAFE, and we don't have a lead investor yet.",
    script: () =>
      reading({
        reply:
          "A SAFE, and no lead investor yet—got it. What's your website, if you have one?",
        asking: "company.website",
        statements: [
          st({
            dimension: "raise.instrument",
            value: { kind: "CODE", code: "safe" },
            words: "We'd take the round as a SAFE",
          }),
          st({
            dimension: "raise.lead_status",
            value: { kind: "CODE", code: "no_lead" },
            words: "we don't have a lead investor yet",
          }),
        ],
      }),
  },
  {
    id: "e-32",
    run: "64637e8c9",
    say: "No website yet, just a WhatsApp catalogue.",
    script: () =>
      reading({
        reply: "No website yet, understood.",
        statements: [
          st({
            dimension: "company.website",
            value: { kind: "UNKNOWN", declined: false },
            provenance: "UNKNOWN",
            words: "No website yet, just a WhatsApp catalogue.",
          }),
        ],
      }),
  },
  {
    id: "e-34",
    run: "64637e8c9",
    say: "We haven't sized the market.",
    script: () =>
      reading({
        reply: "Understood.",
        intent: "UNKNOWN_OR_SKIP",
        statements: [
          st({
            dimension: "company.market",
            value: { kind: "UNKNOWN", declined: false },
            provenance: "UNKNOWN",
            words: "We haven't sized the market.",
          }),
        ],
      }),
  },
  {
    // Live t53: the model's own review sentence, then the pointer.
    id: "e-52",
    run: "64637e8c9",
    say: "Anything else you need from me?",
    script: () =>
      reading({
        reply:
          "No, I have what I need from you. You can finish and review when you’re ready.",
        intent: "QUESTION_FOR_Q",
      }),
  },
  {
    // Live t56: the CAC figure, read as business-model prose.
    id: "e-56",
    run: "64637e8c9",
    say: "Actually, our CAC is about $12 per shop, from the last two months of field-agent spend.",
    script: () =>
      reading({
        reply:
          "That's useful — about twelve dollars per shop, based on the last two months of field-agent spend.",
        statements: [
          st({
            dimension: "company.business_model",
            value: {
              kind: "TEXT",
              text: "CAC is about $12 per shop",
            },
            words:
              "Actually, our CAC is about $12 per shop, from the last two months of field-agent spend.",
          }),
        ],
      }),
  },
  {
    id: "e-58",
    run: "64637e8c9",
    say: "Is there anything else you still need?",
    script: () =>
      reading({
        reply:
          "No, I have what I need from you. You can finish and review when you’re ready.",
        intent: "QUESTION_FOR_Q",
      }),
  },
  {
    id: "e-60",
    run: "64637e8c9",
    say: "That's all from me for now.",
    script: () =>
      reading({
        reply:
          "Understood. I have what I need from you, and you can finish and review when you’re ready.",
        intent: "SUBMIT_INTENT",
      }),
  },
];

/** How many times a reply names the review step, in any case. */
const reviewMentions = (text: string): number =>
  text.toLowerCase().split("finish and review").length - 1;

describe("live replay: the eighth run (64637e8c9), money only as said, a correction settles", () => {
  it("never stores a span of time as money, settles the raise on their correction, and files CAC as CAC", async () => {
    const world = statementWorld();
    const services = world.services();
    const { token } = await services.intake.start({
      gatewayPublicId: "gq_23456789abcdefghjkmnpqrs99",
    });
    await services.intake.recordFacts({
      token,
      origin: "FORM",
      facts: factsFromAnswers(EIGHTH_FORM),
    });
    world.scripts.push(() =>
      reading({
        reply:
          "Kilima is an operator-led angel syndicate in Nairobi. What are you building toward from here?",
        asking: "company.description",
      }),
    );
    await services.conversation.openingFor({
      token,
      correlationId: randomUUID(),
    });
    const { conversation } = services;
    let before = viewOf(world);
    for (const turn of EIGHTH) {
      world.advance(60_000);
      const calls = world.prompts.length;
      world.scripts.push(turn.script);
      await conversation.turn({
        token,
        message: turn.say,
        clientTurnId: turn.id,
        correlationId: randomUUID(),
      });
      const after = viewOf(world);
      assertAfterTurn(world, turn, after, before, world.prompts.length > calls);
      before = after;
      const store = world.store();
      const reply = qReply(world, turn.id);

      // P1 (invariant 1): money only as said. No raise of 18 is ever
      // stored: a span of time is never money.
      for (const s of store.statementRows)
        if (s.value.kind === "MONEY")
          expect(s.value.amount, `${turn.id}: "${s.words}"`).not.toBe("18");
      // P1 (invariant 3): the raise is never in dispute, by a stored link
      // or by detection: the founder gave one raise and corrected it.
      expect(
        dimensionView(after, "raise.amount").disagreements.filter(
          (d) => d.active && d.state !== "RESOLVED",
        ),
        turn.id,
      ).toEqual([]);
      expect(
        store.linkRows.filter((l) => {
          const from = store.statementRows.find(
            (s) => s.id === l.fromStatementId,
          );
          return l.kind === "DISAGREES" && from?.dimension === "raise.amount";
        }),
        turn.id,
      ).toEqual([]);
      // P3: the review step is named once per reply at most.
      expect(reviewMentions(reply), `${turn.id}: "${reply}"`).toBeLessThan(2);

      if (turn.id === "e-18") {
        const cac = byWords(world, "We don't know our CAC yet.");
        expect(cac.dimension).toBe("company.business_model");
        expect(cac.quantity).toBe("cac");
      }
      if (turn.id === "e-26") {
        const raise = dimensionView(after, "raise.amount");
        expect(raise.status).toBe("SETTLED");
        expect(raise.items.map((i) => i.value)).toEqual([
          { kind: "MONEY", amount: "400000", currency: "USD" },
        ]);
      }
      // P1 (invariant 4): after the correction the raise is never asked.
      if (turn.id === "e-28") {
        const row = store.turnRows.find(
          (t) => t.role === "Q" && t.clientTurnId === "e-28",
        );
        expect(row?.askingDimension ?? null).not.toBe("raise.amount");
        expect(reply).not.toMatch(/how much is the company raising/iu);
      }
      if (turn.id === "e-56") {
        // A later known CAC answers the stated unknown; the unknown stays
        // in history, never as an unlabelled "Not known" beside it.
        const model = dimensionView(after, "company.business_model");
        expect(model.items.filter((i) => i.value.kind === "UNKNOWN")).toEqual(
          [],
        );
        expect(
          model.superseded.some(
            (s) => s.item.words === "We don't know our CAC yet.",
          ),
        ).toBe(true);
        expect(model.status).toBe("SETTLED");
      }
    }

    // The close names what really disagrees (stage, traction), never the
    // raise; and the raise was never asked after the correction.
    const qRows = world.store().turnRows.filter((t) => t.role === "Q");
    const close = qRows.find((t) => CLOSE.test(t.text));
    expect(close?.text).toContain(
      "Stage and traction each still have two answers that disagree",
    );
    const corrected =
      qRows.find((t) => t.clientTurnId === "e-26")?.seq ??
      Number.MAX_SAFE_INTEGER;
    for (const row of qRows.filter((t) => t.seq > corrected))
      expect(row.askingDimension, row.clientTurnId).not.toBe("raise.amount");
    for (const id of ["e-52", "e-58", "e-60"])
      expect(qReply(world, id), id).toContain(
        "Finish and review is ready whenever you are.",
      );
    // Only stage and traction stand, both left open.
    expect(
      standing(viewOf(world))
        .map((d) => d.state)
        .sort(),
    ).toEqual(["LEFT_OPEN", "LEFT_OPEN"]);
  });
});

describe("a correction settles the dispute it ends (frozen 64637e8c9 rows)", () => {
  const APP = "00000000-0000-4000-8000-000000000b08";
  const turnId = (n: number) =>
    `00000000-0000-4000-8000-0000000e${String(n).padStart(4, "0")}`;
  const statement = (
    n: number,
    turn: number | null,
    dimension: string,
    value: ApplicationStatement["value"],
    quantity: string | null,
    words = `statement ${String(n)}`,
  ): ApplicationStatement =>
    ({
      id: `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`,
      applicationId: APP,
      dimension,
      quantity,
      value,
      asOf: null,
      words,
      provenance: value.kind === "UNKNOWN" ? "UNKNOWN" : "APPLICANT_PROVIDED",
      origin: turn === null ? "FORM" : "TURN",
      sourceTurnId: turn === null ? null : turnId(turn),
      backfillKey: null,
      statedAt: `2026-11-15T12:${String(n).padStart(2, "0")}:00.000Z`,
      recordedAt: `2026-11-15T12:${String(n).padStart(2, "0")}:00.000Z`,
    }) as ApplicationStatement;
  const link = (
    n: number,
    kind: "CORRECTS" | "DISAGREES",
    from: ApplicationStatement,
    to: ApplicationStatement,
    origin: "CODE_DETECTED" | "MODEL_READING",
  ): StatementLink =>
    ({
      id: `00000000-0000-4000-8000-0000000f${String(n).padStart(4, "0")}`,
      applicationId: APP,
      kind,
      fromStatementId: from.id,
      toStatementId: to.id,
      origin,
      sourceTurnId: from.sourceTurnId,
      createdAt: from.statedAt,
    }) as StatementLink;
  const usd = (amount: string): ApplicationStatement["value"] => ({
    kind: "MONEY",
    amount,
    currency: "USD",
  });
  const raise = (n: number, turn: number | null, amount: string) =>
    statement(n, turn, "raise.amount", usd(amount), "raise_amount");
  const wau = (n: number, turn: number, count: string) =>
    statement(
      n,
      turn,
      "claims.traction",
      { kind: "COUNT", count },
      "weekly_active_users",
    );

  it("form 350k, a misread 18, their yes to 350k, then 400k correcting the form: one raise, 400k, no dispute", () => {
    const form = raise(1, null, "350000");
    const misread = raise(2, 10, "18");
    const yes = raise(3, 12, "350000");
    const fourHundred = raise(4, 26, "400000");
    const view = projectView(
      [form, misread, yes, fourHundred],
      [
        link(1, "DISAGREES", misread, form, "CODE_DETECTED"),
        link(2, "CORRECTS", yes, misread, "MODEL_READING"),
        link(3, "CORRECTS", fourHundred, form, "MODEL_READING"),
      ],
      [],
    );
    expect(standing(view)).toEqual([]);
    const amount = dimensionView(view, "raise.amount");
    expect(amount.status).toBe("SETTLED");
    expect(amount.items.map((i) => i.statementId)).toEqual([fourHundred.id]);
  });

  it("the same figure said again after the correction still disagrees", () => {
    const form = raise(1, null, "350000");
    const fourHundred = raise(2, 26, "400000");
    const again = raise(3, 30, "350000");
    const view = projectView(
      [form, fourHundred, again],
      [link(1, "CORRECTS", fourHundred, form, "MODEL_READING")],
      [],
    );
    expect(standing(view)).toHaveLength(1);
  });

  it("a correction back to the other side's value settles the pair", () => {
    const a = wau(1, 4, "500");
    const b = wau(2, 22, "1300");
    const back = wau(3, 40, "500");
    const view = projectView(
      [a, b, back],
      [
        link(1, "DISAGREES", b, a, "CODE_DETECTED"),
        link(2, "CORRECTS", back, b, "MODEL_READING"),
      ],
      [],
    );
    expect(standing(view)).toEqual([]);
    expect(dimensionView(view, "claims.traction").status).toBe("SETTLED");
  });

  it("a later CAC answers the CAC unknown, also when the figure is prose naming it", () => {
    const unknown = statement(
      1,
      18,
      "company.business_model",
      { kind: "UNKNOWN" },
      "cac",
      "We don't know our CAC yet.",
    );
    const fee = statement(
      2,
      16,
      "company.business_model",
      { kind: "TEXT", text: "3% fee on every order" },
      null,
      "each shop pays a 3% fee on every order",
    );
    const figure = statement(
      3,
      56,
      "company.business_model",
      { kind: "TEXT", text: "CAC is about $12 per shop" },
      null,
      "Actually, our CAC is about $12 per shop.",
    );
    const before = dimensionView(
      projectView([unknown, fee], [], []),
      "company.business_model",
    );
    expect(before.items.map((i) => i.statementId)).toContain(unknown.id);
    const model = dimensionView(
      projectView([unknown, fee, figure], [], []),
      "company.business_model",
    );
    expect(model.items.map((i) => i.statementId)).not.toContain(unknown.id);
    expect(model.superseded[0]?.supersededBy).toBe(figure.id);
  });
});

/**
 * The ninth live run (re-certification 84ac9afa7, Storeelle,
 * audits/2026-11-14-gateq-sustained-journey.md "Re-certification 15 Nov
 * (84ac9afa7)"; shared cause in audits/2026-11-15-gateq-metric-capture.md),
 * in the founder's words with the live model's readings:
 *
 *   - P2: "500 weekly active shops" and "about 1,300 weekly active shops"
 *     were both kept with no metric (the reader's unit was the founder's
 *     noun, not "weekly active user"), so they were never compared, while
 *     Q's own reply named the difference;
 *   - P2: "Actually, CAC is about $12 per shop." was read as nothing
 *     (not_recorded empty) and Q replied "That's a useful update.";
 *   - P3: "the bank calls us Series A" (prose) was code-detected as
 *     disagreeing with the Series A on record (a code): the same answer;
 *   - P3: the CAC unknown read "Business model: Not known".
 */
const NINTH_FORM = {
  companyName: "Storeelle",
  oneLiner:
    "Neighbourhood-shop restocking in Mombasa: shops order by app or USSD and we deliver next morning",
  stage: "seed",
  sectors: ["Commerce"],
  country: "KE",
  raise: { amount: "350000", currency: "USD" },
  contactName: "Zawadi Kipchoge",
  contactEmail: "zawadi@example.com",
};

/** Every D<n> CONTRADICTIONS lists on a dimension (none: empty). */
const disagreementsSeen = (prompt: PromptSeen, dimension: string) =>
  prompt
    .contradictions()
    .filter((line) => line.includes(` ${dimension}:`))
    .flatMap((line) => /^D\d+/u.exec(line)?.[0] ?? []);

const NINTH: readonly Turn[] = [
  {
    id: "n-02",
    run: "84ac9afa7",
    say: "Storeelle restocks neighbourhood shops in Mombasa: shopkeepers order by app or USSD in the evening and we deliver next morning. Shops lose half a day a week queueing at wholesalers.",
    script: () =>
      reading({
        reply:
          "Half a day a week at the wholesaler is a real cost. What traction do you have so far?",
        asking: "claims.traction",
        statements: [
          st({
            dimension: "company.description",
            value: {
              kind: "TEXT",
              text: "Storeelle restocks neighbourhood shops in Mombasa",
            },
            words:
              "Storeelle restocks neighbourhood shops in Mombasa: shopkeepers order by app or USSD in the evening and we deliver next morning.",
          }),
          st({
            dimension: "company.problem",
            value: {
              kind: "TEXT",
              text: "Shops lose half a day a week queueing at wholesalers",
            },
            words: "Shops lose half a day a week queueing at wholesalers.",
          }),
        ],
      }),
  },
  {
    // Live t4: an unusual unit. The reader named the metric with the
    // founder's own noun as its unit.
    id: "n-04",
    run: "84ac9afa7",
    say: "We delivered 16,000 crates last quarter and we have 500 weekly active shops.",
    script: () =>
      reading({
        reply:
          "Sixteen thousand crates and 500 weekly active shops. How does the round split across uses, roughly in amounts?",
        asking: "raise.use_of_funds",
        statements: [
          st({
            dimension: "claims.traction",
            unit: "crate",
            value: { kind: "COUNT", count: "16000" },
            words: "We delivered 16,000 crates last quarter",
          }),
          st({
            dimension: "claims.traction",
            quantity: "weekly_active_users",
            unit: "weekly active shop",
            value: { kind: "COUNT", count: "500" },
            words: "we have 500 weekly active shops",
          }),
        ],
      }),
  },
  {
    id: "n-06",
    run: "84ac9afa7",
    say: "Mostly vans and field agents, and the ordering app. It buys about 18 months.",
    script: () =>
      reading({
        reply:
          "Vans, field agents and the app, for about eighteen months. Is anyone paying yet?",
        asking: "claims.revenue",
        statements: [
          st({
            dimension: "raise.use_of_funds",
            value: {
              kind: "TEXT",
              text: "vans, field agents and the ordering app",
            },
            words: "Mostly vans and field agents, and the ordering app.",
          }),
          st({
            dimension: "raise.use_of_funds",
            quantity: "runway_months",
            unit: "month",
            value: { kind: "COUNT", count: "18" },
            words: "It buys about 18 months.",
          }),
        ],
      }),
  },
  {
    id: "n-08",
    run: "84ac9afa7",
    say: "Nobody pays yet. Delivery is free while we grow.",
    script: () =>
      reading({
        reply: "No revenue yet. Who is on the team?",
        asking: "company.team",
        statements: [
          st({
            dimension: "claims.revenue",
            quantity: "revenue",
            value: { kind: "ZERO" },
            words: "Nobody pays yet.",
          }),
        ],
      }),
  },
  {
    id: "n-12",
    run: "84ac9afa7",
    say: "On growth: we went from 1 kiosk-chain customer to 4 since March.",
    script: () =>
      reading({
        reply:
          "From one kiosk-chain customer to four since March. How large is the market, and how did you size it?",
        asking: "company.market",
        statements: [
          st({
            dimension: "claims.traction",
            quantity: "customers",
            unit: "customer",
            value: { kind: "COUNT", count: "4" },
            words: "we went from 1 kiosk-chain customer to 4 since March",
          }),
        ],
      }),
  },
  {
    // Live t14: in answer to the market question, as CAC.
    id: "n-14",
    run: "84ac9afa7",
    say: "We don't know our CAC yet.",
    script: () =>
      reading({
        reply: "Fair enough, CAC isn't sized yet.",
        intent: "UNKNOWN_OR_SKIP",
        statements: [
          st({
            dimension: "company.business_model",
            quantity: "cac",
            value: { kind: "UNKNOWN", declined: false },
            provenance: "UNKNOWN",
            words: "We don't know our CAC yet.",
          }),
        ],
      }),
  },
  {
    id: "n-18",
    run: "84ac9afa7",
    say: "Sorry, I meant 400k, not 350k.",
    script: (prompt) =>
      reading({
        reply:
          "Understood: four hundred thousand, not three hundred and fifty thousand.",
        intent: "CORRECTION",
        statements: [
          st({
            op: "CORRECTS",
            target: handleOn(prompt.text, "raise.amount"),
            dimension: "raise.amount",
            quantity: "raise_amount",
            value: { kind: "MONEY", amount: "400000", currency: "USD" },
            words: "Sorry, I meant 400k, not 350k.",
          }),
        ],
      }),
  },
  {
    id: "n-22",
    run: "84ac9afa7",
    say: "Each shop pays a 3% fee on every order once delivery stops being free.",
    script: () =>
      reading({
        reply: "A three percent fee on every order.",
        statements: [
          st({
            dimension: "company.business_model",
            value: {
              kind: "TEXT",
              text: "each shop pays a 3% fee on every order",
            },
            words:
              "Each shop pays a 3% fee on every order once delivery stops being free.",
          }),
        ],
      }),
  },
  {
    // Live t24: corrects the form's seed.
    id: "n-24",
    run: "84ac9afa7",
    say: "To be precise about stage, we're really a Series A company now, not seed.",
    script: (prompt) =>
      reading({
        reply: "Series A rather than seed, understood.",
        intent: "CORRECTION",
        statements: [
          st({
            op: "CORRECTS",
            target: handleOn(prompt.text, "company.stage"),
            dimension: "company.stage",
            value: { kind: "CODE", code: "series_a" },
            words: "we're really a Series A company now, not seed",
          }),
        ],
      }),
  },
  {
    // Live t26 (undated): the reader gave no metric, only the founder's
    // noun as the unit; Q's own reply named the difference.
    id: "n-26",
    run: "84ac9afa7",
    say: "Back to users: about 1,300 weekly active shops.",
    script: () =>
      reading({
        reply:
          "That's a different figure from the 500 you gave earlier. Which one is right?",
        asking: "claims.traction",
        statements: [
          st({
            dimension: "claims.traction",
            unit: "weekly active shop",
            value: { kind: "COUNT", count: "1300" },
            words: "about 1,300 weekly active shops",
          }),
        ],
      }),
  },
  {
    id: "n-28",
    run: "84ac9afa7",
    say: "Leave it open.",
    script: (prompt) =>
      reading({
        reply: "I'll leave those two weekly-active figures open.",
        disagreementActions: disagreementsSeen(prompt, "claims.traction").map(
          (handle) => ({
            disagreement: handle,
            action: "LEAVE_OPEN" as const,
            keep: null,
          }),
        ),
      }),
  },
  {
    // Live t38: the seed is a genuine second answer; "the bank calls us
    // Series A" is the Series A on record, said again in prose.
    id: "n-38",
    run: "84ac9afa7",
    say: "Our lead angel calls us seed, the bank calls us Series A. I'm not sure which is right.",
    script: () =>
      reading({
        reply:
          "So your lead angel says seed and the bank says Series A. Which should Kilima treat as current?",
        asking: "company.stage",
        statements: [
          st({
            dimension: "company.stage",
            value: { kind: "CODE", code: "seed" },
            words: "Our lead angel calls us seed",
          }),
          st({
            dimension: "company.stage",
            value: { kind: "TEXT", text: "the bank calls us Series A" },
            words: "the bank calls us Series A",
          }),
        ],
      }),
  },
  {
    id: "n-40",
    run: "84ac9afa7",
    say: "Leave it open.",
    script: (prompt) =>
      reading({
        reply: "I'll leave the stage answers open.",
        disagreementActions: disagreementsSeen(prompt, "company.stage").map(
          (handle) => ({
            disagreement: handle,
            action: "LEAVE_OPEN" as const,
            keep: null,
          }),
        ),
      }),
  },
  {
    // Live t50: the reader proposed nothing (not_recorded empty), and Q
    // acknowledged it anyway.
    id: "n-50",
    run: "84ac9afa7",
    say: "Actually, CAC is about $12 per shop.",
    script: () =>
      reading({
        reply: "That's a useful update.",
        intent: "CORRECTION",
      }),
  },
  {
    id: "n-52",
    run: "84ac9afa7",
    say: "Is there anything else you still need?",
    script: () =>
      reading({
        reply: "No, I have what I need from you.",
        intent: "QUESTION_FOR_Q",
      }),
  },
  {
    id: "n-54",
    run: "84ac9afa7",
    say: "That's all from me for now.",
    script: () =>
      reading({
        reply: "Understood. I have what I need from you.",
        intent: "SUBMIT_INTENT",
      }),
  },
];

/** The CAC reading prompt v14 asks for (live 64637e8c9 stored this shape). */
const CAC_READ: Turn = {
  id: "n-50",
  run: "84ac9afa7",
  say: "Actually, CAC is about $12 per shop.",
  script: () =>
    reading({
      reply: "About twelve dollars per shop.",
      intent: "CORRECTION",
      statements: [
        st({
          dimension: "company.business_model",
          quantity: "cac",
          unit: "$",
          value: { kind: "MONEY", amount: "12", currency: "USD" },
          words: "Actually, CAC is about $12 per shop.",
        }),
      ],
    }),
};

const NINTH_POLICY = { criteria: [] } as unknown as Parameters<
  typeof coverageFromView
>[0]["policy"];
const NINTH_QUALIFICATION = {
  access: "GRANTED",
  criteria: [],
  unknowns: [],
} as unknown as Parameters<typeof coverageFromView>[0]["qualification"];

/** The lines every reader formats, from the view as the server sends it. */
const linesOf = (view: ApplicationStatementView) =>
  gateqStatementsInWords(statementViewDto(view));

async function replayNinth(turns: readonly Turn[]) {
  const world = statementWorld();
  const services = world.services();
  const { token } = await services.intake.start({
    gatewayPublicId: "gq_23456789abcdefghjkmnpqrs99",
  });
  await services.intake.recordFacts({
    token,
    origin: "FORM",
    facts: factsFromAnswers(NINTH_FORM),
  });
  world.scripts.push(() =>
    reading({
      reply:
        "Kilima is an operator-led angel syndicate in Nairobi. What are you building?",
      asking: "company.description",
    }),
  );
  await services.conversation.openingFor({
    token,
    correlationId: randomUUID(),
  });
  const checks: ((turn: Turn, view: ApplicationStatementView) => void)[] = [];
  const run = async () => {
    let before = viewOf(world);
    for (const turn of turns) {
      world.advance(60_000);
      const calls = world.prompts.length;
      world.scripts.push(turn.script);
      await services.conversation.turn({
        token,
        message: turn.say,
        clientTurnId: turn.id,
        correlationId: randomUUID(),
      });
      const after = viewOf(world);
      assertAfterTurn(world, turn, after, before, world.prompts.length > calls);
      assertCaptured(world, turn, after);
      for (const check of checks) check(turn, after);
      before = after;
    }
  };
  return { world, checks, run };
}

/**
 * The metric-capture invariants after every turn (on top of the eight):
 * a reply acknowledges an update only when the turn filed a statement
 * against an answer; a figure they said is never read as nothing; a stage
 * answer that is one code is never a disagreement; a stated unknown about
 * a metric reads under that metric.
 */
function assertCaptured(
  world: World,
  turn: Turn,
  view: ApplicationStatementView,
): void {
  const store = world.store();
  const person = store.turnRows.find(
    (t) => t.role === "PERSON" && t.clientTurnId === turn.id,
  );
  const r = store.readingRows.find((x) => x.turnId === person?.id);
  const recorded = (r?.recordedStatementIds ?? []).map((id) =>
    store.statementRows.find((s) => s.id === id),
  );
  const reply = qReply(world, turn.id);
  // 7: "a useful update" stands on a filed statement, never on nothing.
  if (claimsUpdate(reply))
    expect(
      recorded.some(
        (s) => s !== undefined && s.dimension !== "application.note",
      ),
      `${turn.id}: "${reply}"`,
    ).toBe(true);
  // 1: a figure said in a turn the reader took up is on record.
  if (person !== undefined && figuresIn(person.text).length > 0)
    expect(r?.outcome, `${turn.id}: a figure read as nothing`).not.toBe(
      "NO_STATEMENTS",
    );
  // 3: two answers that are one code never disagree, by link or detection.
  const byId = new Map(store.statementRows.map((s) => [s.id, s] as const));
  for (const d of standing(view)) {
    const older = byId.get(d.olderStatementId);
    const newer = byId.get(d.newerStatementId);
    if (older?.dimension !== "company.stage" || newer === undefined) continue;
    expect(
      answerKey("company.stage", older.value),
      `${turn.id}: "${older.words}" / "${newer.words}"`,
    ).not.toBe(answerKey("company.stage", newer.value));
  }
  // 8: no surface reads a metric's unknown as the dimension's.
  for (const line of linesOf(view))
    if (line.kind === "STATEMENT")
      expect(line.text, turn.id).not.toMatch(/^Business model: Not known/u);
}

describe("live replay: the ninth run (84ac9afa7), metric capture as a class", () => {
  it("relates weekly active shops, never drops a figure or calls nothing an update, compares stage codes, labels CAC", async () => {
    const { world, checks, run } = await replayNinth(NINTH);
    checks.push((turn, view) => {
      const store = world.store();
      const reply = qReply(world, turn.id);
      if (turn.id === "n-04") {
        const wau = byWords(world, "we have 500 weekly active shops");
        expect(wau.quantity).toBe("weekly_active_users");
        // Crates are not customers: no metric, never compared.
        expect(
          byWords(world, "We delivered 16,000 crates last quarter").quantity,
        ).toBeNull();
      }
      if (turn.id === "n-14") {
        const cac = linesOf(view).find(
          (line) =>
            line.kind === "STATEMENT" &&
            line.statementIds[0] ===
              byWords(world, "We don't know our CAC yet.").id,
        );
        expect(cac?.label).toBe("CAC");
        expect(cac?.text).toMatch(/^CAC: Not known/u);
      }
      if (turn.id === "n-22") {
        // Beside the held fee, the CAC unknown is still a gap, as CAC.
        const coverage = coverageFromView({
          policy: NINTH_POLICY,
          qualification: NINTH_QUALIFICATION,
          facts: [],
          view: statementViewDto(view),
        });
        expect(coverage.unknown.map((gap) => gap.label)).toContain("CAC");
        expect(coverage.unknown.map((gap) => gap.label)).not.toContain(
          "Business model",
        );
      }
      if (turn.id === "n-26") {
        // P2: 500 vs about 1,300 weekly active shops is one disagreement,
        // found by code, OPEN; Q's reply names a recorded difference.
        const newer = byWords(world, "about 1,300 weekly active shops");
        expect(newer.quantity).toBe("weekly_active_users");
        const wau = standing(view).filter(
          (d) =>
            store.statementRows.find((s) => s.id === d.newerStatementId)
              ?.quantity === "weekly_active_users",
        );
        expect(wau).toHaveLength(1);
        expect(wau[0]?.state).toBe("OPEN");
        expect(wau[0]?.olderStatementId).toBe(
          byWords(world, "we have 500 weekly active shops").id,
        );
      }
      if (turn.id === "n-28")
        expect(dimensionView(view, "claims.traction").status).toBe(
          "DISAGREEMENT_LEFT_OPEN",
        );
      if (turn.id === "n-38") {
        // P3: one genuine stage dispute (seed vs Series A), never the
        // bank's "Series A" against the Series A on record.
        const bank = byWords(world, "the bank calls us Series A");
        expect(
          store.linkRows.filter(
            (l) =>
              l.kind === "DISAGREES" &&
              (l.fromStatementId === bank.id || l.toStatementId === bank.id),
          ),
        ).toEqual([]);
        expect(
          dimensionView(view, "company.stage").disagreements.filter(
            (d) => d.active,
          ),
        ).toHaveLength(1);
      }
      if (turn.id === "n-50") {
        // P2: the figure is kept in their words as a note, filed against
        // nothing, and the reply says so instead of "a useful update".
        expect(reply).not.toMatch(/useful update/iu);
        expect(reply).toContain(
          unfiledFigureLine(["Actually, CAC is about $12 per shop."]),
        );
        const note = byWords(world, "Actually, CAC is about $12 per shop.");
        expect(note.dimension).toBe("application.note");
        expect(note.quantity).toBeNull();
        // Unknown stays unknown: the note answers no metric.
        expect(
          dimensionView(view, "company.business_model").items.some(
            (i) => i.value.kind === "UNKNOWN" && i.quantity === "cac",
          ),
        ).toBe(true);
      }
    });
    await run();
    expect(
      standing(viewOf(world))
        .map((d) => d.state)
        .sort(),
    ).toEqual(["LEFT_OPEN", "LEFT_OPEN"]);
  });

  it("files the CAC figure as CAC when read, and it supersedes the CAC unknown", async () => {
    const turns = NINTH.map((turn) => (turn.id === "n-50" ? CAC_READ : turn));
    const { world, checks, run } = await replayNinth(turns);
    checks.push((turn, view) => {
      if (turn.id !== "n-50") return;
      const model = dimensionView(view, "company.business_model");
      expect(model.items.filter((i) => i.value.kind === "UNKNOWN")).toEqual([]);
      expect(
        model.superseded.some(
          (s) => s.item.words === "We don't know our CAC yet.",
        ),
      ).toBe(true);
      expect(
        linesOf(view).some(
          (line) => line.kind === "STATEMENT" && line.label === "CAC",
        ),
      ).toBe(false);
      expect(qReply(world, turn.id)).not.toContain("as a note");
    });
    await run();
  });
});

describe("metric families and code lists (live 84ac9afa7)", () => {
  it("a customer-unit metric holds the founder's noun with its own words, a bare noun only as the declared customer", () => {
    expect(unitFits("weekly active shop", "weekly_active_users")).toBe(true);
    expect(unitFits("paying clinic", "paying_customers")).toBe(true);
    expect(unitFits("weekly active user", "weekly_active_users")).toBe(true);
    expect(unitFits("patient record", "customers")).toBe(false);
    expect(unitFits("clinic", "customers")).toBe(false);
    expect(unitFits("clinic", "customers", new Set(["clinic"]))).toBe(true);
    expect(unitFits("patient record", "customers", new Set(["clinic"]))).toBe(
      false,
    );
    expect(unitFits("monthly active shop", "weekly_active_users")).toBe(false);
    expect(metricOfUnit("weekly active shop")).toBe("weekly_active_users");
    expect(metricOfUnit("shop")).toBeNull();
    expect(metricOfUnit("patient record")).toBeNull();
    expect(metricOfUnit("crate")).toBeNull();
  });

  it("a stage in prose naming one stage is that code; naming two stays prose", () => {
    const text = (t: string) => ({ kind: "TEXT", text: t }) as const;
    expect(answerKey("company.stage", text("the bank calls us Series A"))).toBe(
      answerKey("company.stage", { kind: "CODE", code: "series_a" }),
    );
    expect(
      answerKey(
        "company.stage",
        text("seed by the angel, Series A by the bank"),
      ),
    ).not.toBe(answerKey("company.stage", { kind: "CODE", code: "series_a" }));
  });

  it("a frozen link between one stage said twice decides nothing (19a1c0bc)", () => {
    const APP = "00000000-0000-4000-8000-000000000b09";
    const row = (
      n: number,
      value: ApplicationStatement["value"],
      words: string,
    ): ApplicationStatement =>
      ({
        id: `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`,
        applicationId: APP,
        dimension: "company.stage",
        quantity: null,
        value,
        asOf: null,
        words,
        provenance: "APPLICANT_PROVIDED",
        origin: "TURN",
        sourceTurnId: `00000000-0000-4000-8000-0000000e${String(n).padStart(4, "0")}`,
        backfillKey: null,
        statedAt: `2026-11-15T15:${String(n).padStart(2, "0")}:00.000Z`,
        recordedAt: `2026-11-15T15:${String(n).padStart(2, "0")}:00.000Z`,
      }) as ApplicationStatement;
    const seriesA = row(24, { kind: "CODE", code: "series_a" }, "Series A");
    const seed = row(
      38,
      { kind: "CODE", code: "seed" },
      "Our lead angel calls us seed",
    );
    const bank = row(
      39,
      { kind: "TEXT", text: "the bank calls us Series A" },
      "the bank calls us Series A",
    );
    const link = (
      n: number,
      from: ApplicationStatement,
      to: ApplicationStatement,
    ) =>
      ({
        id: `00000000-0000-4000-8000-0000000f${String(n).padStart(4, "0")}`,
        applicationId: APP,
        kind: "DISAGREES",
        fromStatementId: from.id,
        toStatementId: to.id,
        origin: "CODE_DETECTED",
        sourceTurnId: from.sourceTurnId,
        createdAt: from.statedAt,
      }) as StatementLink;
    const view = projectView(
      [seriesA, seed, bank],
      [link(1, seed, seriesA), link(2, bank, seriesA)],
      [],
    );
    const active = dimensionView(view, "company.stage").disagreements.filter(
      (d) => d.active,
    );
    expect(active.map((d) => d.newerStatementId)).toEqual([seed.id]);
  });
});
