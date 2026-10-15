import { describe, expect, it } from "vitest";

import {
  EXTERNAL_REHEARSAL_LABEL,
  ExternalPersonSubjectSchema,
  type ExternalPersonSubject,
} from "@capital-q/contracts";
import { CounterpartPersonaStoredSchema } from "@capital-q/q-core";
import type { ActorContext } from "@capital-q/security";

import {
  buildExternalPersona,
  externalLiveInstructions,
  externalOpeningLine,
} from "../src/composition/external-persona.js";
import { scenarioFor } from "../src/composition/external-scenarios.js";
import {
  createRehearsalService,
  type PersonaRow,
  type RehearsalComposer,
  type RehearsalMaterial,
  type RehearsalRow,
  type RehearsalStore,
} from "../src/composition/rehearsals.js";

/**
 * R5: QInvest, AlRayan Investment and Alchemist Doha are canonical,
 * unclaimed investor organisations. A founder rehearses them through the
 * investor address; the played counterpart is the labelled, code-built
 * simulation with one distinct habit each. No provider or model is called.
 */

const TENANT = "11111111-1111-4111-8111-111111111111";
const FOUNDER = "22222222-2222-4222-8222-222222222222";
const INVESTOR_USER = "44444444-4444-4444-8444-444444444444";
const ORG = "b0075742-0000-4000-8000-0000000000c1";
const CLAIMED_ORG = "b0075742-0000-4000-8000-0000000000c9";
const HIDDEN_ORG = "b0075742-0000-4000-8000-0000000000c8";
const EXTERNAL = "0a0a5a19-7007-5711-864e-3c7d2beab5f2";

const actor = (userId: string) =>
  ({ tenantId: TENANT, userId, actorType: "HUMAN" }) as unknown as ActorContext;

const subject = (
  name: string,
  kind: "PERSON" | "ORGANIZATION",
  extra: Record<string, unknown> = {},
): ExternalPersonSubject =>
  ExternalPersonSubjectSchema.parse({
    externalPersonId: EXTERNAL,
    entityKind: kind,
    researchStatus: "PREPARED_PUBLIC_SEED",
    displayName: name,
    nameVariants: [name],
    profileUrl: null,
    role: kind === "PERSON" ? "Director of Investments" : null,
    organization: name,
    location: "Doha, Qatar",
    evidenceBundleId: null,
    briefVersion: 0,
    confidence: "STRONG",
    ...extra,
  });

const THREE = [
  { name: "QInvest LLC", kind: "ORGANIZATION" as const, key: "sharia_first" },
  {
    name: "AlRayan Investment",
    kind: "ORGANIZATION" as const,
    key: "sceptical_of_projections",
  },
  {
    name: "Muhannad Taslaq",
    kind: "PERSON" as const,
    key: "gcc_angle_and_one_metric",
  },
];

describe("the three prepared investors each have one distinct quirk", () => {
  it("has three different quirks, each in the persona, the live instructions and the opening line", () => {
    const keys = new Set<string>();
    for (const t of THREE) {
      const s = subject(t.name, t.kind);
      const built = buildExternalPersona({
        subject: s,
        brief: null,
        founder: { companyName: "Acme Freight", businessText: "freight" },
        readBy: 1,
      });
      const quirk = built.scenario.quirk;
      // The stored persona stays inside the schema limits the service checks.
      expect(
        CounterpartPersonaStoredSchema.safeParse(built.persona).success,
      ).toBe(true);
      expect(quirk?.key).toBe(t.key);
      keys.add(quirk?.key ?? "");
      // In the persona: asked first, and in the priorities and pushbacks.
      expect(built.persona.likelyQuestions[0]?.question).toBe(
        quirk?.earlyQuestion("Acme Freight"),
      );
      expect(built.persona.priorities[0]).toBe(quirk?.label);
      expect(built.persona.pushbacks).toContain(quirk?.interjections[0]);
      // On the call.
      const live = externalLiveInstructions({
        subject: s,
        built,
        founder: { companyName: "Acme Freight", businessText: "freight" },
      });
      expect(live).toContain(quirk?.behaviour ?? "never");
      // Built by code, and labelled as an AI simulation.
      const opening = externalOpeningLine({
        scenario: built.scenario,
        companyName: "Acme Freight",
      });
      expect(opening).toContain("AI rehearsal informed by public sources");
      expect(opening).toContain(quirk?.openingTail ?? "never");
      expect(built.label).toBe(EXTERNAL_REHEARSAL_LABEL);
      // Sourced research notes are in the sources, https only.
      expect(built.sources.length).toBeGreaterThan(0);
      expect(built.sources.every((x) => x.url.startsWith("https://"))).toBe(
        true,
      );
    }
    expect(keys.size).toBe(3);
  });

  it("shows the specific habit in words", () => {
    const q = scenarioFor({
      displayName: "QInvest LLC",
      nameVariants: [],
      entityKind: "ORGANIZATION",
    }).quirk;
    expect(q?.earlyQuestion("Acme")).toMatch(/riba/u);
    expect(q?.earlyQuestion("Acme")).toMatch(/gharar/u);
    expect(q?.earlyQuestion("Acme")).toMatch(/Islamic instrument/u);
    const m = scenarioFor({
      displayName: "Muhannad Taslaq",
      nameVariants: [],
      entityKind: "PERSON",
    }).quirk;
    expect(m?.interjections.join(" ")).toMatch(/Qatar \/ GCC angle/u);
    expect(m?.behaviour).toMatch(/ONE metric/u);
    const a = scenarioFor({
      displayName: "AlRayan Investment",
      nameVariants: [],
      entityKind: "ORGANIZATION",
    }).quirk;
    expect(a?.behaviour).toMatch(/audited/u);
  });
});

function setup() {
  const personas = new Map<string, PersonaRow>();
  const inserted: RehearsalRow[] = [];
  const store = {
    findPersona: (a: ActorContext, kind: string, id: string) =>
      Promise.resolve(personas.get(`${a.userId}:${kind}:${id}`) ?? null),
    savePersona: (
      a: ActorContext,
      input: {
        kind: string;
        id: string;
        name: string;
        profile: unknown;
        sources: unknown;
        signalDigest: string;
        webReadAt: Date | null;
      },
    ) => {
      const row: PersonaRow = {
        id: "99999999-9999-4999-8999-999999999999",
        subjectName: input.name,
        profile: input.profile,
        sources: input.sources,
        signalDigest: input.signalDigest,
        webReadAt: input.webReadAt,
        refreshedAt: new Date("2026-10-10T10:00:00Z"),
      };
      personas.set(`${a.userId}:${input.kind}:${input.id}`, row);
      return Promise.resolve(row);
    },
    insert: (
      _a: ActorContext,
      input: {
        id: string;
        kind: RehearsalRow["counterpartKind"];
        counterpartId: string;
        name: string;
        role: RehearsalRow["userRole"];
        persona: RehearsalRow["persona"];
        turns: RehearsalRow["turns"];
        meetingId: string | null;
        voice: RehearsalRow["voice"];
        difficulty: RehearsalRow["difficulty"];
      },
    ) => {
      const row: RehearsalRow = {
        id: input.id,
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
        createdAt: new Date("2026-10-10T10:00:00Z"),
        endedAt: null,
      };
      inserted.push(row);
      return Promise.resolve(row);
    },
    list: () => Promise.resolve([]),
  } as unknown as RehearsalStore;
  const counterpartAsked: string[] = [];
  const material = {
    viewer: (a: ActorContext) =>
      Promise.resolve(
        a.userId === FOUNDER
          ? { role: "FOUNDER" as const, organisationName: "Acme Freight" }
          : { role: "INVESTOR" as const, organisationName: "Some Fund" },
      ),
    // The Discover rule: the hidden investor is not visible to this person.
    counterpart: (_a: ActorContext, kind: string, id: string) => {
      counterpartAsked.push(`${kind}:${id}`);
      return Promise.resolve(
        kind === "INVESTOR_ORGANISATION" && id !== HIDDEN_ORG
          ? {
              name: "Real Fund",
              profile: "Name: Real Fund",
              relationshipId: null,
            }
          : null,
      );
    },
    ownMaterial: () => Promise.resolve({ text: "freight", sources: [] }),
    theirMessages: () => Promise.resolve(""),
    theirCalls: () => Promise.resolve(""),
    counterpartMaterial: () => Promise.resolve({ text: "", sources: [] }),
    publicWeb: () => Promise.resolve({ text: "", sources: [] }),
  } as unknown as RehearsalMaterial;
  const composerCalls = { persona: 0 };
  const composer = {
    personaVersion: 1,
    persona: () => {
      composerCalls.persona += 1;
      return Promise.resolve(null);
    },
  } as unknown as RehearsalComposer;
  const seed = subject("QInvest LLC", "ORGANIZATION", {
    investorOrganisationId: ORG,
  });
  const service = createRehearsalService({
    store,
    material,
    composer,
    external: {
      subjects: {
        latest: () => Promise.resolve({ subject: seed, brief: null }),
        save: () => Promise.resolve(),
      },
      resolve: () => Promise.resolve({ subject: seed, brief: null }),
      // Only the unclaimed organisation is linked.
      investorLink: (id: string) =>
        Promise.resolve(id === ORG || id === HIDDEN_ORG ? EXTERNAL : null),
    },
  });
  return { service, inserted, composerCalls, counterpartAsked };
}

describe("a founder rehearses an unclaimed investor through the investor address", () => {
  it("builds the labelled simulation, and tells the web which investor it is", async () => {
    const { service } = setup();
    const result = await service.persona(
      actor(FOUNDER),
      "INVESTOR_ORGANISATION",
      ORG,
    );
    if (result.kind !== "OK") throw new Error(result.kind);
    expect(result.persona.counterpart.kind).toBe("EXTERNAL_PERSON");
    expect(result.persona.simulation?.label).toBeDefined();
    expect(result.persona.simulation?.investorOrganisationId).toBe(ORG);
    expect(result.persona.simulation?.quirk).toBe("Sharia structure first");
    expect(result.persona.simulation?.disclaimer).toMatch(
      /AI rehearsal informed by public sources/u,
    );
  });

  it("opens by code with the quirk, and calls no model", async () => {
    const { service, inserted, composerCalls } = setup();
    const started = await service.start(actor(FOUNDER), {
      kind: "INVESTOR_ORGANISATION",
      id: ORG,
    });
    if (started.kind !== "OK") throw new Error(started.kind);
    expect(inserted[0]?.counterpartKind).toBe("EXTERNAL_PERSON");
    const first = started.rehearsal.turns[0];
    expect(first?.from).toBe("THEM");
    expect(first?.text).toMatch(/AI rehearsal informed by public sources/u);
    expect(first?.text).toMatch(/Sharia principles/u);
    expect(composerCalls.persona).toBe(0);
  });

  it("is not available to an investor viewer", async () => {
    const { service } = setup();
    const result = await service.persona(
      actor(INVESTOR_USER),
      "INVESTOR_ORGANISATION",
      ORG,
    );
    expect(result.kind).toBe("NOT_FOUND");
    const started = await service.start(actor(INVESTOR_USER), {
      kind: "INVESTOR_ORGANISATION",
      id: ORG,
    });
    expect(started.kind).toBe("NOT_FOUND");
  });

  it("still requires the investor to be visible to the founder", async () => {
    const { service } = setup();
    const result = await service.persona(
      actor(FOUNDER),
      "INVESTOR_ORGANISATION",
      HIDDEN_ORG,
    );
    expect(result.kind).toBe("NOT_FOUND");
  });

  it("never replaces a claimed investor: the real investor path runs", async () => {
    const { service, composerCalls } = setup();
    await service.persona(actor(FOUNDER), "INVESTOR_ORGANISATION", CLAIMED_ORG);
    // Not linked, so the ordinary investor persona is composed (the fake
    // composer returns nothing, which is "Q unavailable", never the seed).
    expect(composerCalls.persona).toBeGreaterThan(0);
  });
});
