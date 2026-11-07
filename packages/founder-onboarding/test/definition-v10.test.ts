import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { validateOnboardingManifest } from "@capital-q/onboarding";

import {
  createFounderWriteTargets,
  FOUNDER_DEFINITION_CURRENT,
  FOUNDER_DEFINITION_V10,
  FOUNDER_DEFINITION_V9,
  FOUNDER_STEPS,
  FOUNDER_V10_STEPS,
  renderOnboardingDefinitionMigration,
} from "../src/index.js";

/**
 * Founder v10 (DECISIONS 79, batch 7): the city, founding year and one-line
 * summary the profile shows are asked, and mandatory.
 */
const MIGRATION = fileURLToPath(
  new URL(
    "../../../supabase/migrations/20261231460000_founder_onboarding_definition_v10.sql",
    import.meta.url,
  ),
);

const ORG = "e0000000-0000-4000-8000-0000000000f1";
const COMPANY = "f0000000-0000-4000-8000-0000000000f1";

const keys = FOUNDER_DEFINITION_V10.steps.map((s) => s.stepKey);

async function basics(stepKey: string, value: unknown) {
  const updates: unknown[] = [];
  const handler = createFounderWriteTargets({
    outbox: {} as never,
    audit: {} as never,
    services: () =>
      ({
        companies: {
          getCompany: () =>
            Promise.resolve({
              version: 3,
              headquartersCity: null,
              foundedDate: null,
              shortDescription: "Old line",
            }),
          updateCompany: (command: { input: unknown }) => {
            updates.push(command.input);
            return Promise.resolve({});
          },
        },
      }) as never,
  }).find((target) => target.targetKey === "company.basics");
  await handler?.apply(
    {
      tx: {} as never,
      actor: {
        context: { organisationId: ORG, userId: "u", tenantId: "t" },
      } as never,
      session: {
        id: "a1000000-0000-4000-8000-0000000000f1",
        organisationId: ORG,
        subject: { subjectType: "COMPANY", subjectId: COMPANY },
      } as never,
      step: {} as never,
      correlationId: "cor_test_v10",
      currentResponses: new Map() as never,
      bindContext: () => Promise.reject(new Error("not used")),
    },
    { stepKey, value, note: null } as never,
  );
  return updates;
}

describe("founder definition v10", () => {
  it("is valid and current", () => {
    expect(() =>
      validateOnboardingManifest(FOUNDER_DEFINITION_V10),
    ).not.toThrow();
    expect(FOUNDER_DEFINITION_CURRENT.version).toBe(10);
  });

  it("asks the city and founding year with the country, and the one line after what the company does, all mandatory", () => {
    expect(keys.indexOf(FOUNDER_V10_STEPS.city)).toBe(
      keys.indexOf(FOUNDER_STEPS.country) + 1,
    );
    expect(keys.indexOf(FOUNDER_V10_STEPS.foundedYear)).toBe(
      keys.indexOf(FOUNDER_STEPS.country) + 2,
    );
    expect(keys.indexOf(FOUNDER_V10_STEPS.oneLine)).toBe(
      keys.indexOf(FOUNDER_STEPS.description) + 1,
    );
    for (const key of Object.values(FOUNDER_V10_STEPS)) {
      expect(
        FOUNDER_DEFINITION_V10.steps.find((s) => s.stepKey === key),
      ).toMatchObject({
        required: true,
        writesTo: [{ targetKey: "company.basics" }],
      });
    }
  });

  it("changes nothing else: every v9 step keeps its key, order, type, branch and target", () => {
    const added = new Set<string>(Object.values(FOUNDER_V10_STEPS));
    const rest = FOUNDER_DEFINITION_V10.steps.filter(
      (s) => !added.has(s.stepKey),
    );
    expect(rest.map((s) => s.stepKey)).toEqual(
      FOUNDER_DEFINITION_V9.steps.map((s) => s.stepKey),
    );
    FOUNDER_DEFINITION_V9.steps.forEach((before, index) => {
      expect(rest[index]?.required).toBe(before.required);
      expect(rest[index]?.writesTo).toEqual(before.writesTo);
    });
  });

  it("writes the city, the year as its first day, and the one line to the company", async () => {
    expect(
      await basics(FOUNDER_V10_STEPS.city, { type: "TEXT", text: "Lublin" }),
    ).toEqual([{ expectedVersion: 3, headquartersCity: "Lublin" }]);
    expect(
      await basics(FOUNDER_V10_STEPS.foundedYear, {
        type: "RANGE",
        value: "2021",
      }),
    ).toEqual([{ expectedVersion: 3, foundedDate: "2021-01-01" }]);
    expect(
      await basics(FOUNDER_V10_STEPS.oneLine, {
        type: "TEXT",
        text: "Grain stock tracking for farming co-ops.",
      }),
    ).toEqual([
      {
        expectedVersion: 3,
        shortDescription: "Grain stock tracking for farming co-ops.",
      },
    ]);
  });

  it('"I don\'t know" leaves each unknown, and a year to come is refused', async () => {
    expect(
      await basics(FOUNDER_V10_STEPS.oneLine, {
        type: "TEXT",
        text: "I don't know",
      }),
    ).toEqual([{ expectedVersion: 3, shortDescription: null }]);
    expect(
      await basics(FOUNDER_V10_STEPS.city, {
        type: "TEXT",
        text: "I don't know",
      }),
    ).toEqual([]);
    await expect(
      basics(FOUNDER_V10_STEPS.foundedYear, {
        type: "RANGE",
        value: String(new Date().getUTCFullYear() + 1),
      }),
    ).rejects.toThrow();
  });

  it("is committed exactly as rendered, publishing v10 for new sessions", () => {
    const rendered = renderOnboardingDefinitionMigration(
      FOUNDER_DEFINITION_V10,
      { packet: "OWNER-PROFILE-FIELDS" },
    );
    expect(readFileSync(MIGRATION, "utf8").endsWith(rendered)).toBe(true);
    expect(rendered).toContain("set current_version = 10");
  });
});
