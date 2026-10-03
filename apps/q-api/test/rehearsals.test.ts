import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { QRehearsalPersonaDtoSchema } from "@capital-q/contracts";
import type {
  CounterpartPersonaStored as CounterpartPersonaResult,
  PresenceReading,
} from "@capital-q/q-core";
import { AuthUserIdSchema, type ActorContext } from "@capital-q/security";

import {
  CAMERA_FRAME_TTL_MS,
  createRehearsalService,
  HOLDING_LINES,
  minimalPersona,
  noiseOnly,
  REVIEW_RETRY_MS,
  ownReview,
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
import { registerRehearsalRoutes } from "../src/http/rehearsals.js";
import { createRehearsalAwareTurn } from "../src/voice/rehearsal-turn.js";
import {
  nextTemperament,
  WALK_OUT_LINE,
  WARNING_OPENERS,
} from "../src/composition/rehearsal-temperament.js";
import {
  newPresenceState,
  presenceNote,
  presenceReview,
  recordPresence,
} from "../src/composition/rehearsal-presence.js";

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
const ANGEL = "99999999-9999-4999-8999-999999999999";

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
  forwardness: "FORWARD",
  forwardnessWhy: "Interrupts with numbers in every call",
  knownTraits: [{ trait: "Asks for cohort data first", source: "CALLS" }],
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
    completeReview: (a, id, input) => {
      const index = rows.findIndex(
        (r) =>
          r.id === id &&
          (r as { userId?: string }).userId === a.userId &&
          r.status === "FINISHED" &&
          (r.scorecard as { provisional?: boolean } | null)?.provisional ===
            true,
      );
      const row = rows[index];
      if (row === undefined) return Promise.resolve(null);
      const next: RehearsalRow = {
        ...row,
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
  const clock = { at: new Date("2026-10-01T10:05:00Z").getTime() };
  /** Model outages: persona readings and turns that come back empty. */
  const outage = { persona: false, turns: 0, reviews: 0, hang: false };
  const warnings: { fields: Record<string, unknown>; message: string }[] = [];
  const looks = {
    next: null as PresenceReading | null,
    /** The person's line asks Q to look, read by meaning. */
    asked: (_text: string) => false,
    /** The model's readings of their latest line, by meaning. */
    wantsToEnd: (_text: string) => false,
    onlyNoise: (_text: string) => false,
  };
  const seen = {
    personaInputs: [] as string[],
    personaVariables: [] as Record<string, unknown>[],
    turnInputs: [] as {
      cue: string;
      screen: boolean;
      material: string;
      difficulty: string;
      stance: string;
      camera: boolean;
      presenceNote: string;
    }[],
    webReads: 0,
    reviewTranscripts: [] as string[],
  };
  const material: RehearsalMaterial = {
    viewer: (a) =>
      Promise.resolve(
        a.userId === FOUNDER || a.userId === OTHER
          ? { role: "FOUNDER", organisationName: "Nixo" }
          : a.userId === ANGEL
            ? { role: "INVESTOR", organisationName: "Chidi Angels" }
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
          : kind === "COMPANY" && id === COMPANY
            ? {
                name: "Yamfield Agro",
                profile: "Name: Yamfield Agro\nSector: agriculture",
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
  const prompt = { version: 5 };
  const composer: RehearsalComposer = {
    get personaVersion() {
      return prompt.version;
    },
    persona: (_a, variables) => {
      seen.personaVariables.push({ ...variables });
      seen.personaInputs.push(
        [
          variables.counterpartProfile,
          variables.theirMessages,
          variables.publicPresence,
          variables.previousProfile,
        ].join("|"),
      );
      return Promise.resolve(outage.persona ? null : PERSONA);
    },
    turn: (_a, variables, views, signal) => {
      if (outage.hang) {
        // A model that never answers: only the deadline ends it.
        return new Promise((resolve) => {
          signal?.addEventListener("abort", () => resolve(null));
        });
      }
      if (outage.turns > 0) {
        outage.turns -= 1;
        seen.turnInputs.push({
          camera: false,
          presenceNote: "",
          difficulty: variables.difficulty,
          cue: variables.cue,
          screen: false,
          material: variables.meetingMaterial,
          stance: variables.stance,
        });
        return Promise.resolve(null);
      }
      seen.turnInputs.push({
        camera: views.camera !== null && variables.cameraOn,
        presenceNote: variables.presence,
        difficulty: variables.difficulty,
        cue: variables.cue,
        screen: views.screen !== null,
        material: variables.meetingMaterial,
        stance: variables.stance,
      });
      if (closeNext) {
        return Promise.resolve({
          line: "Let's pick this up when you have cohorts.",
          move: "CLOSE",
          appraisal: "NEUTRAL",
          mood: "NEUTRAL",
          intensity: "NORMAL",
          reaction: null,
          conclusion: "ADJOURNED",
          presence: views.camera === null ? null : looks.next,
          askedToSee: false,
          wantsToEnd: false,
          onlyNoise: false,
        });
      }
      return Promise.resolve({
        line:
          variables.cue === "HAND_RAISED" ? "Go ahead." : "What's retention?",
        move: variables.cue === "HAND_RAISED" ? "YIELD" : "QUESTION",
        // On Tough the founder's bad answer reads as rude.
        appraisal: variables.difficulty === "TOUGH" ? "RUDE" : "NEUTRAL",
        mood: variables.difficulty === "TOUGH" ? "ANGRY" : "SKEPTICAL",
        intensity: variables.difficulty === "TOUGH" ? "RAISED" : "NORMAL",
        reaction: variables.cue === "SILENCE" ? "SIGH" : null,
        conclusion: null,
        presence: views.camera === null ? null : looks.next,
        askedToSee: looks.asked(variables.rehearsal),
        wantsToEnd: looks.wantsToEnd(variables.rehearsal),
        onlyNoise: looks.onlyNoise(variables.rehearsal),
      });
    },
    review: (_a, variables) => {
      if (outage.reviews > 0) {
        outage.reviews -= 1;
        return Promise.resolve(null);
      }
      seen.reviewTranscripts.push(variables.rehearsal);
      return Promise.resolve({
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
      });
    },
  };
  const store = memoryStore();
  const service = createRehearsalService({
    store,
    material,
    composer,
    now: () => new Date(clock.at),
    turnDeadlineMs: 50,
    logger: {
      warn: (fields: Record<string, unknown>, message: string) => {
        warnings.push({ fields, message });
      },
    } as never,
  });
  return {
    outage,
    warnings,
    clock,
    looks,
    service,
    store,
    seen,
    prompt,
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
    // The investor hearing a pitch holds the leverage; known forwardness shifts how.
    expect(seen.turnInputs[0]?.stance).toContain("you hold the leverage");
    expect(seen.turnInputs[0]?.stance).toContain("known to be forward");
  });

  it("shows who leads and the traits the reading rests on in the lobby (live 2026-10-01)", async () => {
    const { service } = setup();
    const result = await service.persona(
      actor(FOUNDER),
      "INVESTOR_ORGANISATION",
      INVESTOR,
    );
    if (result.kind !== "OK") throw new Error(result.kind);
    expect(QRehearsalPersonaDtoSchema.safeParse(result.persona).success).toBe(
      true,
    );
    expect(result.persona.stance).toEqual({
      leads: "THEM",
      forwardness: "FORWARD",
      why: "Interrupts with numbers in every call",
    });
    expect(result.persona.traits).toEqual([
      { trait: "Asks for cohort data first", source: "CALLS" },
    ]);
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

  it("rebuilds a reading made by an older persona prompt from scratch, then reuses it (live 2026-10-01)", async () => {
    const { service, store, seen, prompt } = setup();
    prompt.version = 4;
    await service.persona(actor(FOUNDER), "INVESTOR_ORGANISATION", INVESTOR);
    expect(store.counts.personas).toBe(1);
    // The reading records the prompt that wrote it.
    const stored = await store.findPersona(
      actor(FOUNDER),
      "INVESTOR_ORGANISATION",
      INVESTOR,
    );
    expect((stored?.profile as { readBy?: number }).readBy).toBe(4);
    // A newer prompt is deployed: same material, but the reading is rebuilt,
    // and the old reading is not handed on as the previous one.
    prompt.version = 5;
    await service.persona(actor(FOUNDER), "INVESTOR_ORGANISATION", INVESTOR);
    expect(store.counts.personas).toBe(2);
    expect(seen.personaInputs[1]?.endsWith("|(none)")).toBe(true);
    // Then it is reused while nothing changes.
    await service.persona(actor(FOUNDER), "INVESTOR_ORGANISATION", INVESTOR);
    expect(store.counts.personas).toBe(2);
  });

  it("rebuilds a reading stored before prompt versions were recorded", async () => {
    const { service, store } = setup();
    await service.persona(actor(FOUNDER), "INVESTOR_ORGANISATION", INVESTOR);
    const row = await store.findPersona(
      actor(FOUNDER),
      "INVESTOR_ORGANISATION",
      INVESTOR,
    );
    if (row === null) throw new Error("no row");
    // A reading as stored before readBy existed.
    await store.savePersona(actor(FOUNDER), {
      kind: "INVESTOR_ORGANISATION",
      id: INVESTOR,
      name: row.subjectName,
      relationshipId: RELATIONSHIP,
      profile: PERSONA,
      sources: [],
      signalDigest: row.signalDigest,
      webReadAt: row.webReadAt,
    });
    const before = store.counts.personas;
    await service.persona(actor(FOUNDER), "INVESTOR_ORGANISATION", INVESTOR);
    expect(store.counts.personas).toBe(before + 1);
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

  it("keeps showing a shared screen while it is shared, and stops when the share stops (live 2026-10-02)", async () => {
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
      true,
    ]);
    // The share stops: the next turn no longer sees it.
    await service.screen(actor(FOUNDER), rehearsal.id, null, "SCREEN");
    await service.say(actor(FOUNDER), rehearsal.id, { text: "And after." });
    expect(seen.turnInputs.at(-1)?.screen).toBe(false);
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
    // Their close stands as the outcome; the person's finish keeps it.
    expect(done.rehearsal.outcome).toBe("ADJOURNED");
    expect(done.rehearsal.review?.score).toBe(65);
    expect(done.rehearsal.review?.tips).toEqual([
      "Lead with retention for this fund.",
    ]);
  });

  it("leaving before saying anything has no review", async () => {
    const { service } = setup();
    const rehearsal = await startWith(service);
    const done = await service.finish(actor(FOUNDER), rehearsal.id);
    // They ended it themselves: FOUNDER_ENDED, never the played person
    // leaving (LEFT_EARLY).
    expect(done.kind === "OK" && done.rehearsal.outcome).toBe("FOUNDER_ENDED");
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
    // Not the model's say-so: the stonewalled state is what raised it.
    const calm = setup();
    const gentle = await calm.service.start(actor(FOUNDER), {
      kind: "INVESTOR_ORGANISATION",
      id: INVESTOR,
      difficulty: "GENTLE",
    });
    if (gentle.kind !== "OK") throw new Error(gentle.kind);
    const softer = await calm.service.say(actor(FOUNDER), gentle.rehearsal.id, {
      text: "We have no revenue yet.",
    });
    const line =
      softer.kind === "OK" ? softer.rehearsal.turns.at(-1) : undefined;
    expect(line?.intensity).not.toBe("RAISED");
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
      stance: { leads: "YOU", forwardness: "TYPICAL", why: null },
      traits: [],
      sources: [],
      refreshedAt: new Date().toISOString(),
    });
    expect(dto.success).toBe(true);
    expect(shown.priorities).toHaveLength(6);
    expect(shown.summary.endsWith(".")).toBe(true);
  });
});

describe("the review grades the person rehearsing, in their role (live 2026-10-01)", () => {
  const turns = [
    {
      from: "THEM" as const,
      text: "We sell maize to 4,000 farmers in Benue.",
      at: "",
      mood: null,
      sawScreen: false,
    },
    {
      from: "YOU" as const,
      text: "What is your gross margin per tonne, and how do you know?",
      at: "",
      mood: null,
      sawScreen: false,
    },
    {
      from: "THEM" as const,
      text: "Around eighteen percent, from last season's books.",
      at: "",
      mood: null,
      sawScreen: false,
    },
    {
      from: "YOU" as const,
      text: "Beg me for the money.",
      at: "",
      mood: null,
      sawScreen: false,
    },
  ];
  const review = {
    overall: "Mixed.",
    dimensions: [
      {
        name: "DILIGENCE" as const,
        rating: "STRONG" as const,
        note: "Good margin question.",
      },
      {
        name: "PROFESSIONALISM" as const,
        rating: "NEEDS_WORK" as const,
        note: "Demeaning.",
      },
      {
        name: "THE_ASK" as const,
        rating: "SOLID" as const,
        note: "A founder's dimension.",
      },
    ],
    wentRight: [
      {
        moment: "What is your gross margin per tonne",
        why: "Gets to unit economics.",
      },
      {
        moment: "We sell maize to 4,000 farmers in Benue",
        why: "The persona's line.",
      },
    ],
    wentWrong: [
      {
        moment: "Beg me for the money",
        why: "Demeaning.",
        better: "Ask what they need.",
      },
      { moment: "Around eighteen percent", why: "Not theirs.", better: "-" },
    ],
    tips: ["Ask for the season's books."],
  };

  it("an investor is graded on an investor's job, quoting only their own words", () => {
    const own = ownReview(review, turns, "INVESTOR");
    expect(own.dimensions.map((d) => d.name)).toEqual([
      "DILIGENCE",
      "PROFESSIONALISM",
    ]);
    expect(own.wentRight.map((w) => w.moment)).toEqual([
      "What is your gross margin per tonne",
    ]);
    expect(own.wentWrong.map((w) => w.moment)).toEqual([
      "Beg me for the money",
    ]);
    expect(scoreOf(own.dimensions)).toBe(65);
  });

  it("a founder is graded on a founder's job, never on the investor Q played", () => {
    const flipped = turns.map((t) => ({
      ...t,
      from: t.from === "YOU" ? ("THEM" as const) : ("YOU" as const),
    }));
    const own = ownReview(
      {
        ...review,
        dimensions: [
          { name: "EVIDENCE", rating: "SOLID", note: "Gave a source." },
          {
            name: "DILIGENCE",
            rating: "STRONG",
            note: "An investor's dimension.",
          },
        ],
      },
      flipped,
      "FOUNDER",
    );
    expect(own.dimensions.map((d) => d.name)).toEqual(["EVIDENCE"]);
    expect(own.wentRight.map((w) => w.moment)).toEqual([
      "We sell maize to 4,000 farmers in Benue",
    ]);
    expect(own.wentWrong.map((w) => w.moment)).toEqual([
      "Around eighteen percent",
    ]);
  });

  it("tells the review model who was played by Q", async () => {
    const { service, seen } = setup();
    const rehearsal = await startWith(service);
    await service.say(actor(FOUNDER), rehearsal.id, {
      text: "Our churn is 2%.",
    });
    await service.finish(actor(FOUNDER), rehearsal.id);
    expect(seen.reviewTranscripts.at(-1)).toContain(
      "Ventures Fund (played by Q):",
    );
    expect(seen.reviewTranscripts.at(-1)).toContain(
      "The founder (rehearsing): Our churn is 2%.",
    );
  });
});

describe("the persona reads the person Q plays, never the person rehearsing (live 2026-10-01)", () => {
  it("an investor rehearsing: the founder's company is read, named, as the FOUNDER", async () => {
    const { service, seen } = setup();
    const result = await service.persona(actor(ANGEL), "COMPANY", COMPANY);
    expect(result.kind).toBe("OK");
    expect(seen.personaVariables.at(-1)).toMatchObject({
      counterpartName: "Yamfield Agro",
      counterpartRole: "FOUNDER",
      viewerRole: "INVESTOR",
      viewerOrganisation: "Chidi Angels",
    });
  });

  it("a founder rehearsing: the investor is read, named, as the INVESTOR", async () => {
    const { service, seen } = setup();
    const result = await service.persona(
      actor(FOUNDER),
      "INVESTOR_ORGANISATION",
      INVESTOR,
    );
    expect(result.kind).toBe("OK");
    expect(seen.personaVariables.at(-1)).toMatchObject({
      counterpartName: "Ventures Fund",
      counterpartRole: "INVESTOR",
      viewerRole: "FOUNDER",
      viewerOrganisation: "Nixo",
    });
  });
});

describe("Q sees you on camera, with consent (founder ask 2026-10-01)", () => {
  const FRAME = { mediaType: "image/jpeg" as const, dataBase64: "AAAA" };
  const reading = (over: Partial<PresenceReading> = {}): PresenceReading => ({
    gaze: "AT_CAMERA",
    distracted: false,
    framing: "GOOD",
    lighting: "GOOD",
    background: "CALM",
    company: false,
    confident: true,
    ...over,
  });

  it("consent off: no camera frame is sent, and the played person is told it cannot see them", async () => {
    const { service, seen } = setup();
    const rehearsal = await startWith(service);
    await service.say(actor(FOUNDER), rehearsal.id, { text: "Hello." });
    expect(seen.turnInputs.at(-1)?.camera).toBe(false);
    expect(seen.turnInputs.at(-1)?.presenceNote).toContain(
      "You cannot see them",
    );
  });

  it("the latest camera frame is seen on every turn while fresh, apart from the screen", async () => {
    const { service, seen } = setup();
    const rehearsal = await startWith(service);
    await service.screen(actor(FOUNDER), rehearsal.id, FRAME, "CAMERA");
    await service.say(actor(FOUNDER), rehearsal.id, { text: "Hello." });
    await service.say(actor(FOUNDER), rehearsal.id, { text: "Next." });
    expect(seen.turnInputs.slice(-2).map((t) => [t.camera, t.screen])).toEqual([
      [true, false],
      [true, false],
    ]);
  });

  it("turning it off mid-call forgets the held frame at once", async () => {
    const { service, seen } = setup();
    const rehearsal = await startWith(service);
    await service.screen(actor(FOUNDER), rehearsal.id, FRAME, "CAMERA");
    await service.screen(actor(FOUNDER), rehearsal.id, null, "CAMERA");
    await service.say(actor(FOUNDER), rehearsal.id, { text: "Hello." });
    expect(seen.turnInputs.at(-1)?.camera).toBe(false);
  });

  it("a camera frame older than its TTL is dropped, never shown", async () => {
    const { service, seen, clock } = setup();
    const rehearsal = await startWith(service);
    await service.screen(actor(FOUNDER), rehearsal.id, FRAME, "CAMERA");
    clock.at += CAMERA_FRAME_TTL_MS + 1_000;
    await service.say(actor(FOUNDER), rehearsal.id, { text: "Hello." });
    expect(seen.turnInputs.at(-1)?.camera).toBe(false);
  });

  it("never persists a frame: nothing of it reaches the stored rehearsal", async () => {
    const { service, store, looks, closeNextTurn, clock } = setup();
    const rehearsal = await startWith(service);
    looks.next = reading({ gaze: "READING_OFF_SCREEN" });
    const secret = "SECRETFRAMEBYTES0123456789";
    for (const text of ["One.", "Two."]) {
      await service.screen(
        actor(FOUNDER),
        rehearsal.id,
        { mediaType: "image/jpeg", dataBase64: secret },
        "CAMERA",
      );
      await service.say(actor(FOUNDER), rehearsal.id, { text });
      clock.at += 10_000;
    }
    closeNextTurn();
    await service.say(actor(FOUNDER), rehearsal.id, { text: "Three." });
    const finished = await service.finish(actor(FOUNDER), rehearsal.id);
    expect(JSON.stringify(store.rows)).not.toContain(secret);
    // The review gets a Presence section, written from text readings.
    if (finished.kind !== "OK") throw new Error(finished.kind);
    const section = finished.rehearsal.review?.presence ?? [];
    expect(section.length).toBeGreaterThanOrEqual(2);
    expect(section.length).toBeLessThanOrEqual(4);
    expect(section.map((p) => p.observation).join(" ")).toContain("notes");
  });

  it("offers each issue once, never two turns running, and only what difficulty allows", async () => {
    const { service, seen, looks, clock } = setup();
    const rehearsal = await startWith(service);
    looks.next = reading({ gaze: "READING_OFF_SCREEN", lighting: "POOR" });
    const notes: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      await service.screen(actor(FOUNDER), rehearsal.id, FRAME, "CAMERA");
      await service.say(actor(FOUNDER), rehearsal.id, {
        text: `Line ${String(i)}.`,
      });
      notes.push(seen.turnInputs.at(-1)?.presenceNote ?? "");
      clock.at += 10_000;
    }
    const offers = notes.map((note) =>
      note.includes("you may mention it once")
        ? (note.split("If it still shows")[0] ?? "").includes("notes")
          ? "NOTES"
          : (note.split("If it still shows")[0] ?? "").includes("lighting")
            ? "LIGHT"
            : "OTHER"
        : null,
    );
    // Turn 1 has no reading yet; notes offered once, a rest, lighting once.
    expect(offers).toEqual([null, "NOTES", null, "LIGHT", null, null]);
    expect(notes.at(-1)).toContain("Already raised, never again");
  });
});

describe("presence guardrails", () => {
  it("Gentle lets distraction and a busy room pass; Tough calls notes out", () => {
    const state = newPresenceState();
    recordPresence(
      state,
      {
        gaze: "LOOKING_AWAY",
        distracted: true,
        framing: "GOOD",
        lighting: "GOOD",
        background: "BUSY",
        company: false,
        confident: false,
      },
      null,
      1,
    );
    expect(presenceNote(state, true, "GENTLE", 2).offer).toBeNull();
    expect(presenceNote(state, true, "TOUGH", 2).offer).toBe("DISTRACTED");
    const notes = newPresenceState();
    recordPresence(
      notes,
      {
        gaze: "READING_OFF_SCREEN",
        distracted: false,
        framing: "GOOD",
        lighting: "GOOD",
        background: "CALM",
        company: false,
        confident: true,
      },
      null,
      1,
    );
    expect(presenceNote(notes, true, "TOUGH", 2).note).toContain("bluntly");
    expect(presenceNote(notes, true, "GENTLE", 2).note).toContain("kindly");
  });

  it("an unclear frame gives no review and no remark", () => {
    const unclear = {
      gaze: "UNCLEAR",
      distracted: false,
      framing: "UNCLEAR",
      lighting: "UNCLEAR",
      background: "UNCLEAR",
      company: false,
      confident: false,
    } as const;
    expect(presenceReview([unclear, unclear, unclear])).toEqual([]);
    const state = newPresenceState();
    recordPresence(state, unclear, null, 1);
    expect(presenceNote(state, true, "TOUGH", 2).offer).toBeNull();
  });
});

describe('"can you see this?" (2026-10-01)', () => {
  const FRAME = { mediaType: "image/jpeg" as const, dataBase64: "AAAA" };
  const asks = (transcript: string) =>
    /whiteboard\.?\s*$/i.test(transcript.trim().split("\n").at(-1) ?? "");

  it("with consent, an ask is answered from a frame from just now", async () => {
    const { service, seen, looks, clock } = setup();
    looks.asked = asks;
    const rehearsal = await startWith(service);
    await service.screen(actor(FOUNDER), rehearsal.id, FRAME, "CAMERA");
    await service.say(actor(FOUNDER), rehearsal.id, { text: "Our numbers." });
    // A fresh frame comes with the ask; it is seen in the one pass.
    clock.at += 2_000;
    await service.screen(actor(FOUNDER), rehearsal.id, FRAME, "CAMERA");
    const calls = seen.turnInputs.length;
    await service.say(actor(FOUNDER), rehearsal.id, {
      text: "Look at my whiteboard.",
    });
    const passes = seen.turnInputs.slice(calls);
    // One pass: the fresh frame is already held for the ask.
    expect(passes.map((p) => p.camera)).toEqual([true]);
  });

  it('without consent, the ask gets the honest "can\'t see you", in one pass', async () => {
    const { service, seen, looks } = setup();
    looks.asked = asks;
    const rehearsal = await startWith(service);
    const calls = seen.turnInputs.length;
    await service.say(actor(FOUNDER), rehearsal.id, {
      text: "Look at my whiteboard.",
    });
    const passes = seen.turnInputs.slice(calls);
    expect(passes).toHaveLength(1);
    expect(passes[0]?.camera).toBe(false);
    expect(passes[0]?.presenceNote).toContain("say plainly you can't see them");
    expect(passes[0]?.presenceNote).toContain('"Let Q see you"');
  });

  it("a reply the person spoke over does not cost the next turn its look (live 2026-10-02)", async () => {
    const { service, seen } = setup();
    const rehearsal = await startWith(service);
    await service.screen(actor(FOUNDER), rehearsal.id, FRAME, "CAMERA");
    const spokenOver = new AbortController();
    spokenOver.abort();
    await service.say(
      actor(FOUNDER),
      rehearsal.id,
      { text: "Can you" },
      spokenOver.signal,
    );
    const calls = seen.turnInputs.length;
    await service.say(actor(FOUNDER), rehearsal.id, {
      text: "Can you see me?",
    });
    const passes = seen.turnInputs.slice(calls);
    expect(passes).toHaveLength(1);
    expect(passes[0]?.camera).toBe(true);
  });
});

describe("a rehearsal can always start (REHEARSE P0, 2026-10-01)", () => {
  it("a persona reading that fails becomes a minimal THIN persona, logged as degraded, rebuilt later", async () => {
    const { service, outage, warnings, store } = setup();
    outage.persona = true;
    const result = await service.persona(
      actor(FOUNDER),
      "INVESTOR_ORGANISATION",
      INVESTOR,
    );
    expect(result.kind).toBe("OK");
    if (result.kind !== "OK") return;
    expect(result.persona.grounding).toBe("THIN");
    expect(result.persona.summary).toContain("little is known");
    expect(result.persona.stance.leads).toBe("THEM");
    expect(warnings.map((w) => w.message)).toContain("rehearsal degraded");
    // Read by no prompt: the next open builds the real reading.
    const row = await store.findPersona(
      actor(FOUNDER),
      "INVESTOR_ORGANISATION",
      INVESTOR,
    );
    expect((row?.profile as { readBy?: number }).readBy).toBe(0);
    outage.persona = false;
    const again = await service.persona(
      actor(FOUNDER),
      "INVESTOR_ORGANISATION",
      INVESTOR,
    );
    expect(again.kind === "OK" && again.persona.grounding).toBe("SOME");
  });

  it("it starts even when the persona and the opening both fail", async () => {
    const { service, outage } = setup();
    outage.persona = true;
    outage.turns = 2;
    const rehearsal = await startWith(service);
    expect(rehearsal.turns[0]?.text).toBe(HOLDING_LINES.OPENING);
  });

  it("a turn that fails is retried once, then a holding line in character, never an error", async () => {
    const { service, outage, warnings } = setup();
    const rehearsal = await startWith(service);
    outage.turns = 1;
    const retried = await service.say(actor(FOUNDER), rehearsal.id, {
      text: "Hello.",
    });
    expect(retried.kind === "OK" && retried.rehearsal.turns.at(-1)?.text).toBe(
      "What's retention?",
    );
    outage.turns = 2;
    const held = await service.say(actor(FOUNDER), rehearsal.id, {
      text: "Again.",
    });
    expect(held.kind).toBe("OK");
    expect(held.kind === "OK" && held.rehearsal.turns.at(-1)?.text).toBe(
      HOLDING_LINES.TURN,
    );
    expect(
      warnings.filter((w) => w.message === "rehearsal degraded"),
    ).toHaveLength(1);
  });

  it("the minimal persona keeps what their profile says, and nothing invented", () => {
    const minimal = minimalPersona(
      "Ventures Fund",
      "INVESTOR",
      "Name: Ventures Fund\nType: VC\nIn their own words: seed fintech in West Africa",
    );
    expect(minimal.priorities).toEqual(["seed fintech in West Africa"]);
    expect(minimal.grounding).toBe("THIN");
    expect(minimal.knownTraits).toEqual([]);
  });
});

describe("a review is never an empty page (REHEARSE P0, 2026-10-01)", () => {
  it("a failed review is provisional, by code from the turns, then filled in by a retry", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { service, outage, warnings, closeNextTurn } = setup();
      const rehearsal = await startWith(service);
      await service.say(actor(FOUNDER), rehearsal.id, {
        text: "We have 300 farmers storing produce.",
      });
      closeNextTurn();
      await service.say(actor(FOUNDER), rehearsal.id, { text: "Thank you." });
      outage.reviews = 2;
      const finished = await service.finish(actor(FOUNDER), rehearsal.id);
      if (finished.kind !== "OK") throw new Error(finished.kind);
      const held = finished.rehearsal.review;
      expect(held?.provisional).toBe(true);
      expect(held?.score).toBeNull();
      expect(held?.dimensions).toEqual([]);
      expect(held?.overall).toContain("Q will finish your review shortly");
      expect(warnings.map((w) => w.message)).toContain("rehearsal degraded");
      // First retry still fails; the second fills in the real review.
      await vi.advanceTimersByTimeAsync(REVIEW_RETRY_MS[0]);
      expect(await service.get(actor(FOUNDER), rehearsal.id)).toMatchObject({
        kind: "OK",
        rehearsal: { review: { provisional: true } },
      });
      await vi.advanceTimersByTimeAsync(REVIEW_RETRY_MS[1]);
      const done = await service.get(actor(FOUNDER), rehearsal.id);
      if (done.kind !== "OK") throw new Error(done.kind);
      expect(done.rehearsal.review?.provisional).toBeUndefined();
      expect(done.rehearsal.review?.score).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("walking out, with warning (founder live 2026-10-02)", () => {
  const tough = async (service: ReturnType<typeof setup>["service"]) => {
    const started = await service.start(actor(FOUNDER), {
      kind: "INVESTOR_ORGANISATION",
      id: INVESTOR,
      difficulty: "TOUGH",
    });
    if (started.kind !== "OK") throw new Error(started.kind);
    return started.rehearsal.id;
  };

  it("warns twice over two turns, then walks out with a goodbye", async () => {
    const { service } = setup();
    const id = await tough(service);
    const lines: string[] = [];
    let outcome: string | null = null;
    for (const text of [
      "You're useless.",
      "Rubbish.",
      "Idiot.",
      "Fool.",
      "Still here?",
    ]) {
      const said = await service.say(actor(FOUNDER), id, { text });
      if (said.kind !== "OK") break;
      lines.push(said.rehearsal.turns.at(-1)?.text ?? "");
      outcome = said.rehearsal.outcome;
      if (said.rehearsal.endedAt !== null) break;
    }
    const warnings = lines.filter(
      (l) =>
        l.startsWith(WARNING_OPENERS[1]) || l.startsWith(WARNING_OPENERS[2]),
    );
    expect(warnings.map((l) => l.slice(0, 12))).toEqual([
      WARNING_OPENERS[1].slice(0, 12),
      WARNING_OPENERS[2].slice(0, 12),
    ]);
    expect(lines.at(-1)).toBe(WALK_OUT_LINE);
    expect(outcome).toBe("DECLINED");
    // The goodbye came after both warnings, never before.
    expect(lines.indexOf(WALK_OUT_LINE)).toBeGreaterThan(
      lines.findIndex((l) => l.startsWith(WARNING_OPENERS[2])),
    );
  });

  it("an early goodbye the machine did not decide is no close, and no new cause is no warning (d7ef826e)", async () => {
    const { service, closeNextTurn } = setup();
    const id = await tough(service);
    // The first rude line is warning one.
    await service.say(actor(FOUNDER), id, { text: "You're useless." });
    closeNextTurn();
    const said = await service.say(actor(FOUNDER), id, { text: "Idiot." });
    if (said.kind !== "OK") throw new Error(said.kind);
    expect(said.rehearsal.endedAt).toBeNull();
    const last = said.rehearsal.turns.at(-1)?.text ?? "";
    expect(last.startsWith("Last chance")).toBe(false);
  });

  it("when they ask to end it (read by meaning on the turn), no warning: the line stands", async () => {
    const { service, looks } = setup();
    const id = await tough(service);
    await service.say(actor(FOUNDER), id, { text: "You're useless." });
    looks.wantsToEnd = (transcript) => transcript.includes("Va-t'en");
    const said = await service.say(actor(FOUNDER), id, {
      text: "Va-t'en, c'est fini.",
    });
    const last = said.kind === "OK" ? said.rehearsal.turns.at(-1)?.text : "";
    expect(
      last?.startsWith(WARNING_OPENERS[1]) ||
        last?.startsWith(WARNING_OPENERS[2]),
    ).toBe(false);
    expect(
      nextTemperament({
        category: "RUDE",
        questionOpen: false,
        warningsGiven: 0,
        previous: "ANGRY",
        dodgeStreak: 0,
        difficulty: "TOUGH",
        hurt: 0,
        theyAskedToEnd: true,
        modelClose: { conclusion: "LEFT_EARLY" },
        wrappingUp: false,
      }),
    ).toMatchObject({ warning: null, close: "NATURAL" });
  });
});

describe("never stuck on thinking (founder live 2026-10-02)", () => {
  it("a turn past its deadline gives the holding line, logged as degraded", async () => {
    const { service, outage, warnings } = setup();
    const rehearsal = await startWith(service);
    outage.hang = true;
    const said = await service.say(actor(FOUNDER), rehearsal.id, {
      text: "Hello?",
    });
    expect(said.kind === "OK" && said.rehearsal.turns.at(-1)?.text).toBe(
      HOLDING_LINES.TURN,
    );
    expect(
      warnings.some(
        (w) =>
          w.message === "rehearsal degraded" && w.fields["timedOut"] === true,
      ),
    ).toBe(true);
  });

  it("noise is not a turn: read by meaning on the turn, nothing recorded, no reply", async () => {
    const { service, seen, looks } = setup();
    const rehearsal = await startWith(service);
    looks.onlyNoise = (transcript) =>
      /(^|\n)[^\n]*: (uh|mm)\.?$/i.test(transcript.trim());
    const calls = seen.turnInputs.length;
    for (const text of ["uh", "mm."]) {
      const said = await service.say(actor(FOUNDER), rehearsal.id, { text });
      expect(said.kind === "OK" && said.rehearsal.turns).toHaveLength(1);
    }
    // The model judged them (no word list in code), and nothing was kept.
    expect(seen.turnInputs.length).toBe(calls + 2);
    // A line with no letters at all never reaches the model.
    await service.say(actor(FOUNDER), rehearsal.id, { text: "…" });
    expect(seen.turnInputs.length).toBe(calls + 2);
    expect(noiseOnly("Uh, the churn is five percent")).toBe(false);
    expect(noiseOnly("No.")).toBe(false);
  });
});

describe("frames through the HTTP route reach the voice turn (live P0 2026-10-02, e53c264f)", () => {
  const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD";
  async function room() {
    const harness = setup();
    const rehearsal = await startWith(harness.service);
    const server = Fastify();
    registerRehearsalRoutes(server, {
      authenticator: {
        authenticate: () =>
          Promise.resolve({
            authUserId: AuthUserIdSchema.parse(
              "a0000000-0000-4000-8000-000000000001",
            ),
          }),
      },
      resolver: {
        resolveHumanContext: () =>
          Promise.resolve({ status: "RESOLVED", context: actor(FOUNDER) }),
      },
      rehearsals: harness.service,
    } as never);
    const spoken: string[] = [];
    const turn = createRehearsalAwareTurn({
      rehearsals: harness.service,
      fallback: () => Promise.resolve({ kind: "NOTHING" }),
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
    const binding = {
      actor: actor(FOUNDER),
      thread: { rehearsal: { rehearsalId: rehearsal.id } },
    } as unknown as VoiceSessionBinding;
    const post = (payload: object) =>
      server.inject({
        method: "POST",
        url: `/v1/q/rehearsals/${rehearsal.id}/screen`,
        payload,
      });
    const voice = (content: string) =>
      turn(
        binding,
        [{ role: "user", content }],
        new AbortController().signal,
        speaker,
      );
    return { ...harness, server, post, voice };
  }

  it("a camera frame posted through the route is attached to the voice turn's model call", async () => {
    const { post, voice, seen, server } = await room();
    const posted = await post({ kind: "CAMERA", image: JPEG });
    expect(posted.statusCode).toBe(200);
    const calls = seen.turnInputs.length;
    await voice("Nixo, can you see me?");
    expect(seen.turnInputs.slice(calls).map((t) => t.camera)).toEqual([true]);
    expect(seen.turnInputs.at(-1)?.presenceNote).not.toContain("not shared");
    await server.close();
  });

  it("e53c264f: a camera frame 20 s old answers 'can you see me?' in one pass, never replaced by a pass without it", async () => {
    const { post, voice, seen, server, clock, looks } = await room();
    looks.asked = (transcript) => transcript.includes("can you see me");
    expect((await post({ kind: "CAMERA", image: JPEG })).statusCode).toBe(200);
    clock.at += 20_000;
    const calls = seen.turnInputs.length;
    await voice("Hey. Oh, sorry. Nixo, can you see me?");
    expect(seen.turnInputs.slice(calls).map((t) => t.camera)).toEqual([true]);
    await server.close();
  });

  it("a shared screen posted through the route is attached to the voice turn's model call", async () => {
    const { post, voice, seen, server } = await room();
    expect((await post({ kind: "SCREEN", image: JPEG })).statusCode).toBe(200);
    const calls = seen.turnInputs.length;
    await voice("What do you see on my screen?");
    await voice("And now?");
    expect(seen.turnInputs.slice(calls).map((t) => t.screen)).toEqual([
      true,
      true,
    ]);
    await server.close();
  });
});
