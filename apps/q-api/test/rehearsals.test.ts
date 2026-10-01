import { describe, expect, it } from "vitest";

import { QRehearsalPersonaDtoSchema } from "@capital-q/contracts";
import type { CounterpartPersonaResult } from "@capital-q/q-core";
import type { ActorContext } from "@capital-q/security";

import {
  createRehearsalService,
  scoreOf,
  shownPersona,
  type PersonaRow,
  type RehearsalComposer,
  type RehearsalMaterial,
  type RehearsalRow,
  type RehearsalStore,
} from "../src/composition/rehearsals.js";
import type { VoiceSessionBinding } from "../src/voice/bindings.js";
import type { VoiceSpeaker } from "../src/voice/provider.js";
import { createRehearsalAwareTurn } from "../src/voice/rehearsal-turn.js";

/**
 * REHEARSE (founder direction 2026-10-01): a person rehearses a meeting
 * with someone they are connected to, played by Q from a persona built
 * only from what they may see; the persona is reused while its material is
 * unchanged; the review's score is computed by code.
 */

const TENANT = "11111111-1111-4111-8111-111111111111";
const FOUNDER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const INVESTOR = "44444444-4444-4444-8444-444444444444";
const HIDDEN = "55555555-5555-4555-8555-555555555555";
const RELATIONSHIP = "66666666-6666-4666-8666-666666666666";
const MEETING = "77777777-7777-4777-8777-777777777777";
const COMPANY = "88888888-8888-4888-8888-888888888888";

const actor = (userId: string) =>
  ({ tenantId: TENANT, userId, actorType: "HUMAN" }) as unknown as ActorContext;

const PERSONA: CounterpartPersonaResult = {
  summary: "A sharp seed investor who wants proof.",
  style: "Direct, quick, presses on numbers.",
  temperament: { baseline: "SKEPTICAL", warmsTo: ["numbers"], coolsOn: [] },
  priorities: ["Retention"],
  likelyQuestions: [
    { question: "What is your retention?", why: "Their focus" },
    { question: "Who else is investing?", why: "Signal" },
    { question: "Why now?", why: "Timing" },
  ],
  likelyAnswers: [],
  pushbacks: ["Asks for the cohort data"],
  howToWin: ["Bring cohorts"],
  dealbreakers: [],
  grounding: "SOME",
};

function memoryStore(): RehearsalStore & {
  readonly rows: RehearsalRow[];
  readonly counts: { personas: number };
} {
  const rows: RehearsalRow[] = [];
  const personas = new Map<string, PersonaRow>();
  const state = { personas: 0 };
  const key = (a: ActorContext, kind: string, id: string) =>
    `${a.userId}:${kind}:${id}`;
  const store: RehearsalStore = {
    findPersona: (a, kind, id) =>
      Promise.resolve(personas.get(key(a, kind, id)) ?? null),
    savePersona: (a, input) => {
      state.personas += 1;
      const row: PersonaRow = {
        id: "99999999-9999-4999-8999-999999999999",
        subjectName: input.name,
        profile: input.profile,
        sources: input.sources,
        signalDigest: input.signalDigest,
        webReadAt: input.webReadAt,
        refreshedAt: new Date("2026-10-01T10:00:00Z"),
      };
      personas.set(key(a, input.kind, input.id), row);
      return Promise.resolve(row);
    },
    insert: (a, input) => {
      const row: RehearsalRow & { userId: string } = {
        id: input.id,
        userId: a.userId,
        counterpartKind: input.kind,
        counterpartId: input.counterpartId,
        counterpartName: input.name,
        userRole: input.role,
        persona: input.persona,
        turns: input.turns,
        asked: 0,
        status: "ACTIVE",
        outcome: null,
        score: null,
        scorecard: null,
        meetingId: input.meetingId,
        voice: input.voice,
        difficulty: input.difficulty,
        // Each later rehearsal starts a minute later.
        createdAt: new Date(
          Date.parse("2026-10-01T10:00:00Z") + rows.length * 60_000,
        ),
        endedAt: null,
      };
      rows.push(row);
      return Promise.resolve(row);
    },
    own: (a, id) =>
      Promise.resolve(
        rows.find(
          (r) => r.id === id && (r as { userId?: string }).userId === a.userId,
        ) ?? null,
      ),
    saveTurns: (a, id, input) => {
      const index = rows.findIndex(
        (r) =>
          r.id === id &&
          (r as { userId?: string }).userId === a.userId &&
          r.status === "ACTIVE" &&
          r.endedAt === null,
      );
      const row = rows[index];
      if (row === undefined) return Promise.resolve(null);
      const next = {
        ...row,
        turns: input.turns,
        asked: input.asked,
        outcome: input.outcome ?? row.outcome,
        endedAt: input.ended ? new Date("2026-10-01T10:20:00Z") : null,
      };
      rows[index] = next;
      return Promise.resolve(next);
    },
    finish: (a, id, input) => {
      const index = rows.findIndex(
        (r) =>
          r.id === id &&
          (r as { userId?: string }).userId === a.userId &&
          r.status === "ACTIVE",
      );
      const row = rows[index];
      if (row === undefined) return Promise.resolve(null);
      const next: RehearsalRow = {
        ...row,
        status: "FINISHED",
        outcome: input.outcome,
        score: input.score,
        scorecard: input.review,
      };
      rows[index] = next;
      return Promise.resolve(next);
    },
    list: (a) =>
      Promise.resolve(
        rows
          .filter((r) => (r as { userId?: string }).userId === a.userId)
          .reverse(),
      ),
  };
  return { ...store, rows, counts: state };
}

function setup(options: { messages?: () => string } = {}) {
  const seen = {
    personaInputs: [] as string[],
    turnInputs: [] as {
      cue: string;
      screen: boolean;
      material: string;
      difficulty: string;
    }[],
    webReads: 0,
  };
  const material: RehearsalMaterial = {
    viewer: (a) =>
      Promise.resolve(
        a.userId === FOUNDER || a.userId === OTHER
          ? { role: "FOUNDER", organisationName: "Nixo" }
          : null,
      ),
    counterpart: (_a, kind, id) =>
      Promise.resolve(
        kind === "INVESTOR_ORGANISATION" && id === INVESTOR
          ? {
              name: "Ventures Fund",
              profile: "Name: Ventures Fund\nType: VC",
              relationshipId: RELATIONSHIP,
            }
          : null,
      ),
    theirMessages: () => Promise.resolve(options.messages?.() ?? "Kola: hi"),
    theirCalls: () => Promise.resolve(""),
    counterpartMaterial: () => Promise.resolve({ text: "", sources: [] }),
    publicWeb: () => {
      seen.webReads += 1;
      return Promise.resolve({
        text: "Ventures Fund backs seed fintech",
        sources: [
          {
            kind: "PUBLIC_WEB",
            label: "Fund news",
            url: "https://example.com/news",
            excerpt: "backs seed fintech",
          },
        ],
      });
    },
    ownMaterial: () =>
      Promise.resolve({
        text: "THEIR DECK: 40% month-on-month growth",
        sources: [],
      }),
    relationships: () =>
      Promise.resolve([
        {
          relationshipId: RELATIONSHIP,
          kind: "INVESTOR_ORGANISATION",
          id: INVESTOR,
          name: "Ventures Fund",
          state: "CONNECTED",
        },
      ]),
    upcomingMeetings: (a) =>
      Promise.resolve(
        a.userId === FOUNDER
          ? [
              {
                meetingId: MEETING,
                relationshipId: RELATIONSHIP,
                startsAt: "2026-10-03T10:00:00.000Z",
                purpose: "Intro call",
              },
            ]
          : [],
      ),
  };
  let closeNext = false;
  const composer: RehearsalComposer = {
    persona: (_a, variables) => {
      seen.personaInputs.push(
        [
          variables.counterpartProfile,
          variables.theirMessages,
          variables.publicPresence,
          variables.previousProfile,
        ].join("|"),
      );
      return Promise.resolve(PERSONA);
    },
    turn: (_a, variables, image) => {
      seen.turnInputs.push({
        difficulty: variables.difficulty,
        cue: variables.cue,
        screen: image !== null,
        material: variables.meetingMaterial,
      });
      if (closeNext) {
        return Promise.resolve({
          line: "Let's pick this up when you have cohorts.",
          move: "CLOSE",
          mood: "NEUTRAL",
          intensity: "NORMAL",
          reaction: null,
          conclusion: "ADJOURNED",
        });
      }
      return Promise.resolve({
        line:
          variables.cue === "HAND_RAISED" ? "Go ahead." : "What's retention?",
        move: variables.cue === "HAND_RAISED" ? "YIELD" : "QUESTION",
        mood: variables.difficulty === "TOUGH" ? "ANGRY" : "SKEPTICAL",
        intensity: variables.difficulty === "TOUGH" ? "RAISED" : "NORMAL",
        reaction: variables.cue === "SILENCE" ? "SIGH" : null,
        conclusion: null,
      });
    },
    review: () =>
      Promise.resolve({
        overall: "Solid, but bring cohorts.",
        dimensions: [
          { name: "CLARITY", rating: "STRONG", note: "Clear story." },
          { name: "EVIDENCE", rating: "NEEDS_WORK", note: "No cohorts." },
        ],
        wentRight: [{ moment: "The opener", why: "Crisp" }],
        wentWrong: [
          {
            moment: "Retention",
            why: "Vague",
            better: "Bring the cohort chart.",
          },
        ],
        tips: ["Lead with retention for this fund."],
      }),
  };
  const store = memoryStore();
  const service = createRehearsalService({
    store,
    material,
    composer,
    now: () => new Date("2026-10-01T10:05:00Z"),
  });
  return {
    service,
    store,
    seen,
    closeNextTurn: () => {
      closeNext = true;
    },
  };
}

const startWith = async (
  service: ReturnType<typeof setup>["service"],
  userId = FOUNDER,
) => {
  const started = await service.start(actor(userId), {
    kind: "INVESTOR_ORGANISATION",
    id: INVESTOR,
    meetingId: MEETING,
  });
  if (started.kind !== "OK") throw new Error(started.kind);
  return started.rehearsal;
};

describe("rehearsals", () => {
  it("starts with the other person's opening line and the meeting it is for", async () => {
    const { service, seen } = setup();
    const rehearsal = await startWith(service);
    expect(rehearsal.counterpart.name).toBe("Ventures Fund");
    expect(rehearsal.turns).toHaveLength(1);
    expect(rehearsal.turns[0]?.from).toBe("THEM");
    expect(rehearsal.meetingId).toBe(MEETING);
    expect(seen.turnInputs[0]?.cue).toBe("OPENING");
    // Played investor asks from the founder's own deck.
    expect(seen.turnInputs[0]?.material).toContain("40% month-on-month");
  });

  it("keeps a meeting id only when the meeting is the person's own", async () => {
    const { service } = setup();
    const started = await service.start(actor(OTHER), {
      kind: "INVESTOR_ORGANISATION",
      id: INVESTOR,
      meetingId: MEETING,
    });
    expect(started.kind === "OK" && started.rehearsal.meetingId).toBeNull();
  });

  it("refuses a counterpart the person may not see, and a non-participant", async () => {
    const { service } = setup();
    expect(
      (
        await service.start(actor(FOUNDER), {
          kind: "INVESTOR_ORGANISATION",
          id: HIDDEN,
        })
      ).kind,
    ).toBe("NOT_FOUND");
    expect(
      (
        await service.start(actor(INVESTOR), {
          kind: "INVESTOR_ORGANISATION",
          id: INVESTOR,
        })
      ).kind,
    ).toBe("NOT_A_PARTICIPANT");
    // A founder does not rehearse with a company.
    expect(
      (await service.persona(actor(FOUNDER), "COMPANY", COMPANY)).kind,
    ).toBe("NOT_FOUND");
  });

  it("reuses the persona while its material is unchanged, refreshes it when it changes", async () => {
    let messages = "Kola: hi";
    const { service, store, seen } = setup({ messages: () => messages });
    await service.persona(actor(FOUNDER), "INVESTOR_ORGANISATION", INVESTOR);
    await service.persona(actor(FOUNDER), "INVESTOR_ORGANISATION", INVESTOR);
    expect(store.counts.personas).toBe(1);
    expect(seen.webReads).toBe(1);
    messages = "Kola: hi\nKola: send me your cohorts";
    const refreshed = await service.persona(
      actor(FOUNDER),
      "INVESTOR_ORGANISATION",
      INVESTOR,
    );
    expect(store.counts.personas).toBe(2);
    // The web is not read again within the week; its snippet is reused.
    expect(seen.webReads).toBe(1);
    expect(seen.personaInputs[1]).toContain("backs seed fintech");
    // Incremental: the previous reading is handed in.
    expect(seen.personaInputs[1]).toContain("A sharp seed investor");
    expect(refreshed.kind === "OK" && refreshed.persona.sources).toContainEqual(
      {
        kind: "PUBLIC_WEB",
        label: "Fund news",
        url: "https://example.com/news",
      },
    );
  });

  it("answers, yields to a raised hand, and never lets another person in", async () => {
    const { service, seen } = setup();
    const rehearsal = await startWith(service);
    const said = await service.say(actor(FOUNDER), rehearsal.id, {
      text: "We grow 40% a month.",
    });
    expect(
      said.kind === "OK" && said.rehearsal.turns.map((t) => t.from),
    ).toEqual(["THEM", "YOU", "THEM"]);
    const calls = seen.turnInputs.length;
    const hand = await service.say(actor(FOUNDER), rehearsal.id, {
      cue: "HAND_RAISED",
    });
    // A raised hand yields the floor by structure: no model turn, a short
    // line with no question, and the next line is theirs.
    expect(seen.turnInputs.length).toBe(calls);
    const yielded =
      hand.kind === "OK" ? hand.rehearsal.turns.at(-1) : undefined;
    expect(yielded?.from).toBe("THEM");
    expect(yielded?.text).toMatch(/go (ahead|on)\.$/i);
    expect(yielded?.text).not.toContain("?\u0020");
    expect(yielded?.mood).toBe("SKEPTICAL");
    const after = await service.say(actor(FOUNDER), rehearsal.id, {
      text: "Thanks. Our churn is 2% a month.",
    });
    expect(
      after.kind === "OK" && after.rehearsal.turns.slice(-2).map((t) => t.from),
    ).toEqual(["YOU", "THEM"]);
    expect(seen.turnInputs.at(-1)?.cue).toBe("NONE");
    // The voice line's token is a cue, never words.
    const spokenHand = await service.say(actor(FOUNDER), rehearsal.id, {
      text: "[hand-raised]",
    });
    expect(
      spokenHand.kind === "OK" &&
        spokenHand.rehearsal.turns.filter((t) => t.from === "YOU"),
    ).toHaveLength(2);
    expect(
      spokenHand.kind === "OK" && spokenHand.rehearsal.turns.at(-1)?.from,
    ).toBe("THEM");
    expect(
      (await service.say(actor(OTHER), rehearsal.id, { text: "hi" })).kind,
    ).toBe("NOT_FOUND");
  });

  it("keeps nothing of a reply the person spoke over", async () => {
    const { service } = setup();
    const rehearsal = await startWith(service);
    const controller = new AbortController();
    controller.abort();
    const said = await service.say(
      actor(FOUNDER),
      rehearsal.id,
      { text: "Well, so" },
      controller.signal,
    );
    expect(said.kind === "OK" && said.rehearsal.turns).toHaveLength(1);
  });

  it("shows a shared frame to the next turn only", async () => {
    const { service, seen } = setup();
    const rehearsal = await startWith(service);
    expect(
      await service.screen(actor(OTHER), rehearsal.id, {
        mediaType: "image/jpeg",
        dataBase64: "AAAA",
      }),
    ).toBe("NOT_FOUND");
    await service.screen(actor(FOUNDER), rehearsal.id, {
      mediaType: "image/jpeg",
      dataBase64: "AAAA",
    });
    const first = await service.say(actor(FOUNDER), rehearsal.id, {
      text: "This is our slide.",
    });
    await service.say(actor(FOUNDER), rehearsal.id, { text: "Next." });
    expect(seen.turnInputs.slice(-2).map((t) => t.screen)).toEqual([
      true,
      false,
    ]);
    expect(first.kind === "OK" && first.rehearsal.turns.at(-1)?.sawScreen).toBe(
      true,
    );
  });

  it("closes on the other person's conclusion, then reviews with a code-computed score", async () => {
    const { service, closeNextTurn } = setup();
    const rehearsal = await startWith(service);
    closeNextTurn();
    const closed = await service.say(actor(FOUNDER), rehearsal.id, {
      text: "We don't track cohorts yet.",
    });
    expect(closed.kind === "OK" && closed.rehearsal.outcome).toBe("ADJOURNED");
    expect(
      (await service.say(actor(FOUNDER), rehearsal.id, { text: "Wait" })).kind,
    ).toBe("FINISHED");
    const done = await service.finish(actor(FOUNDER), rehearsal.id);
    expect(done.kind).toBe("OK");
    if (done.kind !== "OK") return;
    expect(done.rehearsal.status).toBe("FINISHED");
    expect(done.rehearsal.review?.score).toBe(65);
    expect(done.rehearsal.review?.tips).toEqual([
      "Lead with retention for this fund.",
    ]);
  });

  it("leaving before saying anything has no review", async () => {
    const { service } = setup();
    const rehearsal = await startWith(service);
    const done = await service.finish(actor(FOUNDER), rehearsal.id);
    expect(done.kind === "OK" && done.rehearsal.outcome).toBe("LEFT_EARLY");
    expect(done.kind === "OK" && done.rehearsal.review).toBeNull();
  });

  it("lists partners with upcoming calls and the last rehearsal", async () => {
    const { service } = setup();
    const rehearsal = await startWith(service);
    const partners = await service.partners(actor(FOUNDER));
    expect(partners.role).toBe("FOUNDER");
    expect(partners.upcoming[0]?.counterpart.name).toBe("Ventures Fund");
    expect(partners.people[0]?.lastRehearsal?.id).toBe(rehearsal.id);
    expect(await service.meeting(actor(OTHER), MEETING)).toBeNull();
  });

  it("scores ratings by a fixed rule", () => {
    expect(scoreOf([])).toBeNull();
    expect(scoreOf([{ rating: "STRONG" }, { rating: "SOLID" }])).toBe(80);
  });
});

describe("rehearsal voice line", () => {
  it("speaks only as the person Q plays, and leaves other lines alone", async () => {
    const { service } = setup();
    const rehearsal = await startWith(service);
    const spoken: string[] = [];
    let fellBack = 0;
    const turn = createRehearsalAwareTurn({
      rehearsals: service,
      fallback: () => {
        fellBack += 1;
        return Promise.resolve({ kind: "NOTHING" });
      },
    });
    const speaker: VoiceSpeaker = {
      providerConversationId: "dg_x",
      isOpen: true,
      speak: (text) => {
        if (typeof text === "string") spoken.push(text);
        return Promise.resolve();
      },
      close: () => undefined,
    };
    const binding = (thread: object) =>
      ({ actor: actor(FOUNDER), thread }) as unknown as VoiceSessionBinding;
    await turn(
      binding({ rehearsal: { rehearsalId: rehearsal.id } }),
      [{ role: "user", content: "We grow fast." }],
      new AbortController().signal,
      speaker,
    );
    expect(spoken).toEqual(["What's retention?"]);
    await turn(
      binding({}),
      [{ role: "user", content: "hello Q" }],
      new AbortController().signal,
      speaker,
    );
    expect(fellBack).toBe(1);
  });
});

describe("rehearsal audit (2026-10-01)", () => {
  it("plays at the chosen difficulty, and the voice gets the line's mood", async () => {
    const { service, seen } = setup();
    const started = await service.start(actor(FOUNDER), {
      kind: "INVESTOR_ORGANISATION",
      id: INVESTOR,
      difficulty: "TOUGH",
    });
    if (started.kind !== "OK") throw new Error(started.kind);
    expect(started.rehearsal.difficulty).toBe("TOUGH");
    expect(seen.turnInputs.every((t) => t.difficulty === "TOUGH")).toBe(true);
    const said = await service.say(actor(FOUNDER), started.rehearsal.id, {
      text: "We have no revenue yet.",
    });
    const last = said.kind === "OK" ? said.rehearsal.turns.at(-1) : undefined;
    expect(last?.mood).toBe("ANGRY");
    expect(last?.intensity).toBe("RAISED");
  });

  it("reacts to silence once, with no words of theirs recorded", async () => {
    const { service, seen } = setup();
    const rehearsal = await startWith(service);
    const nudged = await service.say(actor(FOUNDER), rehearsal.id, {
      text: "[silence]",
    });
    expect(seen.turnInputs.at(-1)?.cue).toBe("SILENCE");
    expect(
      nudged.kind === "OK" &&
        nudged.rehearsal.turns.filter((t) => t.from === "YOU"),
    ).toHaveLength(0);
    expect(
      nudged.kind === "OK" && nudged.rehearsal.turns.at(-1)?.reaction,
    ).toBe("SIGH");
  });

  it("works from a thin record: no deck, no pitch, no public presence", async () => {
    const { service, seen } = setup({ messages: () => "" });
    const persona = await service.persona(
      actor(FOUNDER),
      "INVESTOR_ORGANISATION",
      INVESTOR,
    );
    expect(persona.kind).toBe("OK");
    // Absent material is said to be absent, never invented.
    expect(seen.personaInputs[0]).toContain("(none)");
  });

  it("counts the talking by code and keeps a very long answer bounded", async () => {
    const { service } = setup();
    const rehearsal = await startWith(service);
    const long = "word ".repeat(1_200).trim();
    const said = await service.say(actor(FOUNDER), rehearsal.id, {
      text: long,
    });
    if (said.kind !== "OK") throw new Error(said.kind);
    const yours = said.rehearsal.turns.find((t) => t.from === "YOU");
    expect(yours?.text.length).toBeLessThanOrEqual(4_000);
    expect(said.rehearsal.metrics.exchanges).toBe(1);
    expect(said.rehearsal.metrics.longestAnswerWords).toBeGreaterThan(500);
    expect(said.rehearsal.metrics.yourShareOfWords).toBeGreaterThan(90);
  });

  it("shows the previous score with the same person", async () => {
    const { service, closeNextTurn } = setup();
    const first = await startWith(service);
    await service.say(actor(FOUNDER), first.id, { text: "Hello" });
    await service.finish(actor(FOUNDER), first.id);
    const second = await startWith(service);
    closeNextTurn();
    await service.say(actor(FOUNDER), second.id, { text: "Hi again" });
    const done = await service.finish(actor(FOUNDER), second.id);
    expect(done.kind === "OK" && done.rehearsal.previousScore).toBe(65);
  });
});

describe("a persona longer than the screen's contract (live 2026-10-01)", () => {
  it("is shown within QRehearsalPersonaDto's bounds, cut at a sentence or a word", () => {
    const shown = shownPersona({
      summary: `${"A careful seed investor who reads the numbers first. ".repeat(20)}`,
      style: "Direct and brisk. ".repeat(40),
      priorities: Array.from(
        { length: 9 },
        (_, i) => `Priority ${String(i)} ${"x".repeat(250)}`,
      ),
    });
    const dto = QRehearsalPersonaDtoSchema.safeParse({
      counterpart: {
        kind: "COMPANY",
        id: "11111111-1111-4111-8111-111111111111",
        name: "Kazikit",
      },
      ...shown,
      grounding: "SOME",
      sources: [],
      refreshedAt: new Date().toISOString(),
    });
    expect(dto.success).toBe(true);
    expect(shown.priorities).toHaveLength(6);
    expect(shown.summary.endsWith(".")).toBe(true);
  });
});
