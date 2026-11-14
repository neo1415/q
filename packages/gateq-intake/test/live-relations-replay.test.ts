import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";
import {
  GateqDossierSchema,
  gateqDossierAsReadNow,
  gateqStandingDisagreements,
  gateqStatementIdentities,
  gateqStatementsInWords,
} from "@capital-q/contracts";
import type { GateQStatementOp } from "@capital-q/q-core";

import type {
  ApplicationStatement,
  ApplicationStatementView,
  StatementLink,
} from "../src/contracts/statements.js";
import {
  claimsLeftOpen,
  claimsRecording,
  NOT_LEFT_OPEN_LINE,
} from "../src/application/statement-plan.js";
import {
  NEVER_ASKED_AGAIN,
  dimensionView,
  projectView,
  relatable,
} from "../src/application/statement-view.js";
import {
  reading,
  statementWorld,
  type Script,
} from "./support/statement-world.js";

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
  readonly run: "1f9e33016" | "d2ce8c91e" | "06910b145";
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
      // CAC unknown is recorded as said; the WAU pair is untouched.
      const cac = byWords(world, "We don't know our CAC yet");
      expect(cac.value.kind).toBe("UNKNOWN");
      expect(traction.items.some((i) => i.statementId === cac.id)).toBe(true);
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
      expect(qReply(world, "r-10")).toBe(
        "I'll leave those two weekly-active figures open.",
      );
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
