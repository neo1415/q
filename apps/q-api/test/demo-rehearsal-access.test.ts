import { describe, expect, it } from "vitest";

import {
  ExternalPersonSubjectSchema,
  type ExternalPersonSubject,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  createDemoRehearsalAccess,
  type DemoRehearsalAccess,
  type DemoRehearsalEntity,
} from "../src/composition/demo-rehearsal-access.js";
import {
  scenarioFor,
  simulationTitle,
} from "../src/composition/external-scenarios.js";
import {
  createRehearsalService,
  type PersonaRow,
  type RehearsalComposer,
  type RehearsalMaterial,
  type RehearsalRow,
  type RehearsalStore,
} from "../src/composition/rehearsals.js";

/**
 * Demo rehearsal access: an entitled tenant rehearses a prepared public
 * entity without a connection and without the Discover visibility check;
 * without a live grant nothing changes. No model or provider is called.
 */

const ENTITLED_TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "55555555-5555-4555-8555-555555555555";
const FOUNDER = "22222222-2222-4222-8222-222222222222";
const INVESTOR_USER = "44444444-4444-4444-8444-444444444444";
const HIDDEN_ORG = "b0075742-0000-4000-8000-0000000000c1";
const LINKED_PERSON = "0a0a5a19-7007-5711-864e-3c7d2beab5f2";
const INVEST_QATAR = "ea3eef8e-952e-5a7e-8291-d790c5ff0e62";

const actor = (tenantId: string, userId: string) =>
  ({ tenantId, userId, actorType: "HUMAN" }) as unknown as ActorContext;

const subject = (
  id: string,
  name: string,
  kind: "PERSON" | "ORGANIZATION" | "GOVERNMENT_AGENCY",
): ExternalPersonSubject =>
  ExternalPersonSubjectSchema.parse({
    externalPersonId: id,
    entityKind: kind,
    researchStatus: "PREPARED_PUBLIC_SEED",
    displayName: name,
    nameVariants: [name],
    profileUrl: null,
    role: null,
    organization: name,
    location: "Doha, Qatar",
    evidenceBundleId: null,
    briefVersion: 0,
    confidence: "STRONG",
  });

const ENTITIES: readonly DemoRehearsalEntity[] = [
  {
    externalPersonId: LINKED_PERSON,
    investorOrganisationId: HIDDEN_ORG,
    displayName: "QInvest LLC",
    nameVariants: ["QInvest"],
    entityKind: "ORGANIZATION",
  },
  {
    externalPersonId: INVEST_QATAR,
    investorOrganisationId: null,
    displayName: "Invest Qatar",
    nameVariants: ["InvestQatar"],
    entityKind: "GOVERNMENT_AGENCY",
  },
];

function setup(access: DemoRehearsalAccess | undefined) {
  const inserted: RehearsalRow[] = [];
  const personas = new Map<string, PersonaRow>();
  const touched: string[] = [];
  const store = {
    findPersona: (a: ActorContext, kind: string, id: string) =>
      Promise.resolve(personas.get(`${a.userId}:${kind}:${id}`) ?? null),
    savePersona: (
      a: ActorContext,
      input: { kind: string; id: string; name: string; profile: unknown },
    ) => {
      const row = {
        id: "99999999-9999-4999-8999-999999999999",
        subjectName: input.name,
        profile: input.profile,
        sources: [],
        signalDigest: "d",
        webReadAt: null,
        refreshedAt: new Date("2026-10-11T10:00:00Z"),
      } as PersonaRow;
      personas.set(`${a.userId}:${input.kind}:${input.id}`, row);
      return Promise.resolve(row);
    },
    insert: (
      _a: ActorContext,
      input: Record<string, unknown> & { id: string; relationshipId: unknown },
    ) => {
      touched.push(`relationshipId:${String(input.relationshipId)}`);
      const row = {
        id: input.id,
        counterpartKind: input["kind"],
        counterpartId: input["counterpartId"],
        counterpartName: input["name"],
        userRole: input["role"],
        persona: input["persona"],
        turns: input["turns"],
        asked: 0,
        status: "ACTIVE",
        outcome: null,
        score: null,
        scorecard: null,
        meetingId: null,
        voice: input["voice"],
        difficulty: input["difficulty"],
        createdAt: new Date("2026-10-11T10:00:00Z"),
        endedAt: null,
      } as unknown as RehearsalRow;
      inserted.push(row);
      return Promise.resolve(row);
    },
    list: () => Promise.resolve([]),
  } as unknown as RehearsalStore;
  const material = {
    viewer: (a: ActorContext) =>
      Promise.resolve(
        a.userId === FOUNDER
          ? { role: "FOUNDER" as const, organisationName: "Acme Freight" }
          : { role: "INVESTOR" as const, organisationName: "Some Fund" },
      ),
    // The Discover rule: nothing is visible to this founder.
    counterpart: () => {
      touched.push("discover-visibility");
      return Promise.resolve(null);
    },
    relationships: () => Promise.resolve([]),
    upcomingMeetings: () => Promise.resolve([]),
    ownMaterial: () => Promise.resolve({ text: "freight", sources: [] }),
  } as unknown as RehearsalMaterial;
  const composer = {
    personaVersion: 1,
    persona: () => Promise.resolve(null),
  } as unknown as RehearsalComposer;
  const records = new Map<string, ExternalPersonSubject>([
    [LINKED_PERSON, subject(LINKED_PERSON, "QInvest LLC", "ORGANIZATION")],
    [INVEST_QATAR, subject(INVEST_QATAR, "Invest Qatar", "GOVERNMENT_AGENCY")],
  ]);
  const service = createRehearsalService({
    store,
    material,
    composer,
    external: {
      subjects: {
        latest: (_a: unknown, id: string) => {
          const s = records.get(id);
          return Promise.resolve(
            s === undefined ? null : { subject: s, brief: null },
          );
        },
        save: () => Promise.resolve(),
      },
      resolve: (_a, id) => {
        const s = records.get(id);
        return Promise.resolve(
          s === undefined ? null : { subject: s, brief: null },
        );
      },
      investorLink: (id: string) =>
        Promise.resolve(id === HIDDEN_ORG ? LINKED_PERSON : null),
      demoAccess: access,
    },
  });
  return { service, inserted, touched };
}

// A tenant-scoped fake of the entitlement: live grants per tenant.
const grants = (
  live: Record<string, readonly string[]>,
): DemoRehearsalAccess => ({
  holds: (a, id) => Promise.resolve((live[a.tenantId] ?? []).includes(id)),
  list: (a) =>
    Promise.resolve(
      ENTITIES.filter((e) =>
        (live[a.tenantId] ?? []).includes(e.externalPersonId),
      ),
    ),
});

describe("demo rehearsal access", () => {
  const live = grants({
    [ENTITLED_TENANT]: [LINKED_PERSON, INVEST_QATAR],
  });

  it("lets an entitled founder open and start an investor the Discover rule hides, with no relationship", async () => {
    const { service, inserted, touched } = setup(live);
    const persona = await service.persona(
      actor(ENTITLED_TENANT, FOUNDER),
      "INVESTOR_ORGANISATION",
      HIDDEN_ORG,
    );
    if (persona.kind !== "OK") throw new Error(persona.kind);
    expect(persona.persona.counterpart.kind).toBe("EXTERNAL_PERSON");
    expect(persona.persona.simulation?.label).toBeDefined();
    const started = await service.start(actor(ENTITLED_TENANT, FOUNDER), {
      kind: "INVESTOR_ORGANISATION",
      id: HIDDEN_ORG,
    });
    expect(started.kind).toBe("OK");
    expect(inserted[0]?.counterpartKind).toBe("EXTERNAL_PERSON");
    // Entitlement is not a connection: no relationship, and the Discover
    // check was never needed.
    expect(touched).toEqual(["relationshipId:null"]);
  });

  it("changes nothing without a live grant (other tenant, or none at all)", async () => {
    for (const access of [live, undefined]) {
      const { service } = setup(access);
      const asked = access === undefined ? ENTITLED_TENANT : OTHER_TENANT;
      expect(
        (
          await service.persona(
            actor(asked, FOUNDER),
            "INVESTOR_ORGANISATION",
            HIDDEN_ORG,
          )
        ).kind,
      ).toBe("NOT_FOUND");
      expect(
        (
          await service.start(actor(asked, FOUNDER), {
            kind: "INVESTOR_ORGANISATION",
            id: HIDDEN_ORG,
          })
        ).kind,
      ).toBe("NOT_FOUND");
    }
  });

  it("treats a failing entitlement read as no entitlement", async () => {
    const { service } = setup({
      holds: () => Promise.reject(new Error("db down")),
      list: () => Promise.reject(new Error("db down")),
    });
    const a = actor(ENTITLED_TENANT, FOUNDER);
    expect(
      (await service.persona(a, "INVESTOR_ORGANISATION", HIDDEN_ORG)).kind,
    ).toBe("NOT_FOUND");
    expect((await service.partners(a)).researched).toEqual([]);
  });

  it("does not give an investor viewer the rehearsal", async () => {
    const { service } = setup(live);
    const a = actor(ENTITLED_TENANT, INVESTOR_USER);
    expect(
      (await service.persona(a, "INVESTOR_ORGANISATION", HIDDEN_ORG)).kind,
    ).toBe("NOT_FOUND");
    expect((await service.partners(a)).researched).toEqual([]);
  });

  it("lists the entitled entities as researched rehearsals, Invest Qatar as an investment-promotion officer", async () => {
    const { service } = setup(live);
    const home = await service.partners(actor(ENTITLED_TENANT, FOUNDER));
    expect(home.people).toEqual([]);
    const names = (home.researched ?? []).map((r) => r.name);
    expect(names).toEqual(["QInvest LLC", "Invest Qatar"]);
    const agency = home.researched?.find((r) => r.name === "Invest Qatar");
    expect(agency?.roleLine).toBe("Invest Qatar investment-promotion officer");
    expect(agency?.investorOrganisationId).toBeNull();
    const none = await service.partners(actor(OTHER_TENANT, FOUNDER));
    expect(none.researched).toEqual([]);
  });

  it("plays Invest Qatar as an investment-promotion representative, never a VC mandate", async () => {
    const { service } = setup(live);
    const started = await service.start(actor(ENTITLED_TENANT, FOUNDER), {
      kind: "EXTERNAL_PERSON",
      id: INVEST_QATAR,
    });
    if (started.kind !== "OK") throw new Error(started.kind);
    const scenario = scenarioFor({
      displayName: "Invest Qatar",
      nameVariants: [],
      entityKind: "GOVERNMENT_AGENCY",
    });
    expect(scenario.id).toBe("INVEST_QATAR");
    expect(simulationTitle(scenario, "Invest Qatar", null)).toMatch(
      /investment-promotion officer \(not a real employee\)/u,
    );
    const said = started.rehearsal.turns.map((t) => t.text).join(" ");
    expect(said).not.toMatch(
      /\b(fund|portfolio|cheque|check size|term sheet)\b/iu,
    );
  });
});

describe("the entitlement adapter", () => {
  it("asks for the caller's own tenant, live grants and prepared seeds only", async () => {
    const seen: { text: string; values: unknown[] }[] = [];
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      seen.push({ text: strings.join("?"), values });
      return Promise.resolve([]);
    }) as never;
    const access = createDemoRehearsalAccess(sql);
    expect(
      await access.holds({ tenantId: ENTITLED_TENANT }, INVEST_QATAR),
    ).toBe(false);
    expect(await access.list({ tenantId: ENTITLED_TENANT })).toEqual([]);
    for (const call of seen) {
      expect(call.values[0]).toBe(ENTITLED_TENANT);
      expect(call.text).toMatch(/revoked_at is null/u);
      expect(call.text).toMatch(/PREPARED_PUBLIC_SEED/u);
      expect(call.text).not.toMatch(/relationship|mandate|message/iu);
    }
  });
});
