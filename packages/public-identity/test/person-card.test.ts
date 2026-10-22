import { describe, expect, it } from "vitest";

import type { MaterialActionAuditWriter } from "@capital-q/audit";
import type { PublicCardDto } from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { ActorContext, AuthorizationService } from "@capital-q/security";

import {
  createPublicIdentityService,
  createSubjectDirectory,
  DEFAULT_FIELD_SCOPES,
  fitFieldScopes,
  personFocus,
  projectCardFields,
  type PublicIdentityRepository,
  type SubjectDirectoryPorts,
} from "../src/index.js";

/**
 * A person's own Q Card (owner 2026-10-22): theirs alone, never their
 * organisation's to manage, and its "what they're looking for" never shows
 * more than their organisation's own card shows the same audience.
 */

const ME = "11111111-1111-4111-8111-111111111111";
const SOMEONE_ELSE = "22222222-2222-4222-8222-222222222222";
const FIRM = "33333333-3333-4333-8333-333333333333";

function firmCard(audience: "PUBLIC" | "PARTICIPANT"): PublicCardDto {
  return {
    kind: "CARD",
    handle: "savanna",
    subjectType: "INVESTOR_ORGANISATION",
    name: "Savanna Ventures",
    fields: [
      {
        key: "mandateStages",
        value: "Seed; Series A",
        scope: "public_external",
      },
      ...(audience === "PARTICIPANT"
        ? [
            {
              key: "mandateLookFor" as const,
              value: "Repeat founders",
              scope: "network_visible" as const,
            },
          ]
        : []),
    ],
    verified: [],
    demoAttested: [],
    audience,
    indexable: false,
  };
}

const PORTS: SubjectDirectoryPorts = {
  findCompany: () => Promise.resolve(null),
  findInvestor: () => Promise.resolve(null),
  companyVerification: () =>
    Promise.resolve({ organisation: false, founderIdentity: false }),
  findPerson: (userId) =>
    Promise.resolve(
      userId === ME
        ? {
            displayName: "Wanjiku Kamau",
            headline: "Backing East African logistics",
            countryCode: "KE",
            affiliation: {
              subjectType: "INVESTOR_ORGANISATION",
              subjectId: FIRM,
              tenantId: "tenant",
              organisationId: "org",
              name: "Savanna Ventures",
              roleTitle: "Managing Partner",
            },
          }
        : null,
    ),
  affiliationCard: ({ audience }) => Promise.resolve(firmCard(audience)),
  personVerification: () =>
    Promise.resolve({ organisation: true, founderIdentity: false }),
};

describe("the person directory read", () => {
  it("reads the person's own basics and role, with no organisation as owner", async () => {
    const facts = await createSubjectDirectory(PORTS).find({
      subjectType: "PERSON",
      subjectId: ME,
    });
    expect(facts?.organisationId).toBeNull();
    expect(facts?.tenantId).toBeNull();
    expect(facts?.facts).toMatchObject({
      displayName: "Wanjiku Kamau",
      roleTitle: "Managing Partner",
      affiliation: "Savanna Ventures",
      countryCode: "KE",
    });
    expect(facts?.verified.organisation).toBe(true);
  });

  it("is not found for an unknown person, and survives a failing focus read", async () => {
    const directory = createSubjectDirectory({
      ...PORTS,
      affiliationCard: () => Promise.reject(new Error("down")),
    });
    expect(
      await directory.find({ subjectType: "PERSON", subjectId: SOMEONE_ELSE }),
    ).toBeNull();
    const me = await directory.find({ subjectType: "PERSON", subjectId: ME });
    expect(me?.facts["personFocus"]).toBeNull();
  });
});

describe("what a person is looking for", () => {
  it("never shows more than the firm's own card shows the same audience", async () => {
    const facts = await createSubjectDirectory(PORTS).find({
      subjectType: "PERSON",
      subjectId: ME,
    });
    const scopes = {
      ...DEFAULT_FIELD_SCOPES.PERSON,
      personFocus: "public_external",
    } as const;
    const anon = projectCardFields(
      "PERSON",
      scopes,
      facts?.facts ?? {},
      "PUBLIC",
      facts?.details,
    ).find((field) => field.key === "personFocus");
    expect(anon?.detail).toMatchObject({
      kind: "FOCUS",
      side: "INVESTOR",
      organisationHandle: "savanna",
      fields: [{ key: "mandateStages", value: "Seed; Series A" }],
    });

    const members = projectCardFields(
      "PERSON",
      { ...DEFAULT_FIELD_SCOPES.PERSON, personFocus: "network_visible" },
      facts?.facts ?? {},
      "PARTICIPANT",
      facts?.details,
    ).find((field) => field.key === "personFocus");
    expect(
      members?.detail?.kind === "FOCUS"
        ? members.detail.fields.map((f) => f.key)
        : [],
    ).toEqual(["mandateStages", "mandateLookFor"]);
  });

  it("drops a members-only firm fact from the public focus, even if a public projection carried it", () => {
    const leaky = firmCard("PARTICIPANT");
    const focus = personFocus({
      side: "INVESTOR",
      publicCard: leaky,
      memberCard: leaky,
    });
    expect(
      focus.details.public_external?.kind === "FOCUS"
        ? focus.details.public_external.fields.map((f) => f.key)
        : [],
    ).toEqual(["mandateStages"]);
  });

  it("is absent when the organisation's card shows nothing", () => {
    const focus = personFocus({
      side: "FOUNDER",
      publicCard: null,
      memberCard: null,
    });
    expect(focus.value).toBeNull();
    expect(focus.details).toEqual({
      public_external: null,
      network_visible: null,
    });
  });
});

describe("person card scopes", () => {
  it("accepts only person fields on a person card", () => {
    expect(fitFieldScopes("PERSON", { headline: "public_external" }).ok).toBe(
      true,
    );
    expect(
      fitFieldScopes("PERSON", { tractionMetrics: "public_external" }),
    ).toEqual({ ok: false, fields: ["tractionMetrics"] });
    expect(fitFieldScopes("COMPANY", { headline: "public_external" })).toEqual({
      ok: false,
      fields: ["headline"],
    });
  });
});

describe("who may manage a person card", () => {
  const actor = (userId: string): ActorContext =>
    ({
      actorType: "HUMAN",
      userId,
      tenantId: "tenant",
      organisationId: "org",
    }) as unknown as ActorContext;

  function service() {
    let capabilityChecks = 0;
    const repository = Object.assign({} as PublicIdentityRepository, {
      findCard: () => Promise.resolve(null),
      findActiveForSubject: () => Promise.resolve(null),
    });
    const created = createPublicIdentityService({
      sql: {} as DatabaseExecutor,
      transactions: {} as TransactionManager,
      authorization: {
        requireCapability: () => {
          capabilityChecks += 1;
          return Promise.resolve();
        },
      } as unknown as AuthorizationService,
      audit: {} as MaterialActionAuditWriter,
      subjects: createSubjectDirectory(PORTS),
      repository,
    });
    return { service: created, checks: () => capabilityChecks };
  }

  it("lets the person read their own card without any organisation capability", async () => {
    const { service: s, checks } = service();
    await expect(
      s.getCard({
        actor: actor(ME),
        subject: { subjectType: "PERSON", subjectId: ME },
      }),
    ).resolves.toBeNull();
    expect(checks()).toBe(0);
  });

  it("answers 'not found' to anyone else, an organisation admin included", async () => {
    const { service: s } = service();
    const notMine = { subjectType: "PERSON", subjectId: ME } as const;
    await expect(
      s.getCard({ actor: actor(SOMEONE_ELSE), subject: notMine }),
    ).rejects.toThrow();
    await expect(
      s.claimHandle({
        actor: actor(SOMEONE_ELSE),
        subject: notMine,
        handle: "wanjiku",
        correlationId: "corr",
      }),
    ).rejects.toThrow();
    await expect(
      s.updateCard({
        actor: actor(SOMEONE_ELSE),
        subject: notMine,
        input: { expectedVersion: 1, indexable: true },
        correlationId: "corr",
      }),
    ).rejects.toThrow();
  });
});

describe("a person card's organisation claim", () => {
  function resolver(fieldScopes: unknown) {
    const repository = Object.assign({} as PublicIdentityRepository, {
      findLive: () =>
        Promise.resolve({
          id: "h",
          handle: "wanjiku",
          subjectType: "PERSON" as const,
          subjectId: ME,
          status: "ACTIVE" as const,
          holdUntil: null,
        }),
      findCard: () =>
        Promise.resolve({
          id: "card",
          tenantId: "tenant",
          organisationId: null,
          subjectType: "PERSON" as const,
          subjectId: ME,
          publicCode: "abcdefghij",
          fieldScopes,
          indexable: false,
          status: "ACTIVE" as const,
          version: 1,
          updatedAt: new Date(0).toISOString(),
        }),
    });
    return createPublicIdentityService({
      sql: {} as DatabaseExecutor,
      transactions: {} as TransactionManager,
      authorization: {} as AuthorizationService,
      audit: {} as MaterialActionAuditWriter,
      subjects: createSubjectDirectory(PORTS),
      repository,
    });
  }

  it("is stated only to an audience the card tells who the organisation is", async () => {
    const hidden = await resolver({
      headline: "public_external",
    }).resolveHandle({
      handle: "wanjiku",
      audience: "PUBLIC",
    });
    expect(hidden?.kind === "CARD" ? hidden.verified : null).toEqual([]);

    const membersOnly = resolver({ affiliation: "network_visible" });
    const anon = await membersOnly.resolveHandle({
      handle: "wanjiku",
      audience: "PUBLIC",
    });
    expect(anon?.kind === "CARD" ? anon.verified : null).toEqual([]);
    const member = await membersOnly.resolveHandle({
      handle: "wanjiku",
      audience: "PARTICIPANT",
    });
    expect(member?.kind === "CARD" ? member.verified : null).toEqual([
      "ORGANISATION_VERIFIED",
    ]);
  });
});
