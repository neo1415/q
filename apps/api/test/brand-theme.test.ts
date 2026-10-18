import { describe, expect, it } from "vitest";

import { parseApiConfig } from "@capital-q/config/api";
import {
  createPlatformAdmin,
  isBrandReset,
  type AdminRole,
  type BrandTheme,
  type BrandThemeStore,
} from "@capital-q/platform-admin";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@capital-q/security";

import { createApp } from "../src/app.js";

/**
 * P5 brand theming: anyone signed in reads the colour in effect for their
 * tenant; only a platform admin holding the write permission, with a live
 * step-up, changes it. Everyone else gets the 404 of a missing path and the
 * colour does not change. The real platform-admin service decides.
 */

const TENANT = TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001");
const STEP_UP_ID = "f0000000-0000-4000-8000-000000000001";
const NOBODY = "b0000000-0000-4000-8000-000000000001";
const ANALYST = "b0000000-0000-4000-8000-000000000002";
const OPERATOR_NO_STEP_UP = "b0000000-0000-4000-8000-000000000003";
const OPERATOR = "b0000000-0000-4000-8000-000000000004";

type Person = { readonly role: AdminRole; readonly stepUp: boolean };
const PEOPLE: ReadonlyMap<string, Person> = new Map([
  [ANALYST, { role: "analyst", stepUp: true }],
  [OPERATOR_NO_STEP_UP, { role: "operator", stepUp: false }],
  [OPERATOR, { role: "operator", stepUp: true }],
]);

function fakeSql() {
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("from identity.platform_admins where user_id")) {
      const person = PEOPLE.get(String(values[0]));
      return Promise.resolve(
        person === undefined ? [] : [{ role: person.role }],
      );
    }
    if (text.includes("from platform_ops.step_ups")) {
      const person = PEOPLE.get(String(values[0]));
      return Promise.resolve(
        person?.stepUp === true
          ? [{ id: STEP_UP_ID, expires_at: new Date(Date.now() + 600_000) }]
          : [],
      );
    }
    return Promise.resolve([]);
  };
  return Object.assign(sql, { json: (value: unknown) => value }) as never;
}

function memoryBrand() {
  const initial: BrandTheme = {
    presetKey: "black_gold",
    primaryHex: null,
    updatedAt: null,
  };
  let current = initial;
  const asked: (string | null)[] = [];
  const store: BrandThemeStore = {
    effective: (tenantId) => {
      asked.push(tenantId);
      return Promise.resolve(current);
    },
    platform: () => Promise.resolve(current),
    setPlatform: (_grant, change) => {
      current = isBrandReset(change)
        ? initial
        : {
            presetKey: change.presetKey ?? current.presetKey,
            primaryHex: change.primaryHex,
            updatedAt: "2026-10-05T09:00:00.000Z",
          };
      return Promise.resolve(current);
    },
  };
  return { store, asked, now: () => current };
}

function appFor(userId: string, brand: BrandThemeStore) {
  const sql = fakeSql();
  return createApp(
    parseApiConfig({ NODE_ENV: "test" }),
    {
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
          Promise.resolve({
            status: "RESOLVED",
            context: {
              userId: UserIdSchema.parse(userId),
              tenantId: TENANT,
              organisationId: OrganisationIdSchema.parse(
                "d0000000-0000-4000-8000-000000000001",
              ),
              membershipId: MembershipIdSchema.parse(
                "e0000000-0000-4000-8000-000000000001",
              ),
              actorType: "HUMAN",
            },
          }),
      },
      identities: { lookup: () => Promise.resolve(null) },
    },
    {
      admin: createPlatformAdmin({
        sql,
        transactions: { run: (work) => work({ sql }) },
      }),
      brand,
    },
  ).app;
}

async function call(
  userId: string,
  brand: BrandThemeStore,
  method: "GET" | "POST",
  url: string,
  payload?: Record<string, unknown>,
) {
  const app = appFor(userId, brand);
  const response = await app.inject({
    method,
    url,
    headers: { authorization: "Bearer test" },
    ...(payload === undefined ? {} : { payload }),
  });
  await app.close();
  return response;
}

describe("brand theme routes", () => {
  it("any signed-in person reads the theme for their own tenant (black and gold by default)", async () => {
    const brand = memoryBrand();
    const response = await call(NOBODY, brand.store, "GET", "/v1/brand-theme");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      presetKey: "black_gold",
      primaryHex: null,
      updatedAt: null,
    });
    expect(brand.asked).toEqual([TENANT]);
  });

  it.each([
    ["a non-admin", NOBODY],
    ["an admin whose role cannot write", ANALYST],
  ])("%s is refused with a 404 and nothing changes", async (_who, userId) => {
    const brand = memoryBrand();
    const response = await call(
      userId,
      brand.store,
      "POST",
      "/v1/admin/brand-theme",
      { primaryHex: "#0f766e" },
    );
    expect(response.statusCode).toBe(404);
    expect(brand.now().primaryHex).toBeNull();
  });

  it("a non-admin cannot read the console view either", async () => {
    const response = await call(
      NOBODY,
      memoryBrand().store,
      "GET",
      "/v1/admin/brand-theme",
    );
    expect(response.statusCode).toBe(404);
  });

  it("an operator must confirm it's them first", async () => {
    const brand = memoryBrand();
    const response = await call(
      OPERATOR_NO_STEP_UP,
      brand.store,
      "POST",
      "/v1/admin/brand-theme",
      { primaryHex: "#0f766e" },
    );
    expect(response.statusCode).toBe(403);
    expect(response.json<{ code: string }>().code).toBe("STEP_UP_REQUIRED");
    expect(brand.now().primaryHex).toBeNull();
  });

  it("an operator with a step-up sets and resets the colour", async () => {
    const brand = memoryBrand();
    const set = await call(
      OPERATOR,
      brand.store,
      "POST",
      "/v1/admin/brand-theme",
      { primaryHex: "#0f766e" },
    );
    expect(set.statusCode).toBe(200);
    expect(set.json<{ primaryHex: string }>().primaryHex).toBe("#0f766e");
    const reset = await call(
      OPERATOR,
      brand.store,
      "POST",
      "/v1/admin/brand-theme",
      { primaryHex: null },
    );
    expect(reset.statusCode).toBe(200);
    expect(brand.now().primaryHex).toBeNull();
  });

  it("an operator switches preset back to classic blue and on to black and gold, keeping or dropping a colour", async () => {
    const brand = memoryBrand();
    const blue = await call(
      OPERATOR,
      brand.store,
      "POST",
      "/v1/admin/brand-theme",
      {
        presetKey: "classic_blue",
        primaryHex: null,
      },
    );
    expect(blue.statusCode).toBe(200);
    expect(brand.now()).toMatchObject({
      presetKey: "classic_blue",
      primaryHex: null,
    });
    // A colour alone keeps the preset.
    await call(OPERATOR, brand.store, "POST", "/v1/admin/brand-theme", {
      primaryHex: "#0f766e",
    });
    expect(brand.now()).toMatchObject({
      presetKey: "classic_blue",
      primaryHex: "#0f766e",
    });
    await call(OPERATOR, brand.store, "POST", "/v1/admin/brand-theme", {
      presetKey: "black_gold",
      primaryHex: null,
    });
    expect(brand.now()).toMatchObject({
      presetKey: "black_gold",
      primaryHex: null,
    });
  });

  it.each(["neon", "", "BLACK_GOLD", "black_gold;}"])(
    "refuses an unknown preset %s",
    async (presetKey) => {
      const brand = memoryBrand();
      const response = await call(
        OPERATOR,
        brand.store,
        "POST",
        "/v1/admin/brand-theme",
        {
          presetKey,
          primaryHex: null,
        },
      );
      expect(response.statusCode).toBe(422);
      expect(brand.now().presetKey).toBe("black_gold");
    },
  );

  it.each(["red", "#0F766E", "#fff", "#0f766e;}</style>"])(
    "refuses %s: only a lowercase #rrggbb is stored",
    async (primaryHex) => {
      const brand = memoryBrand();
      const response = await call(
        OPERATOR,
        brand.store,
        "POST",
        "/v1/admin/brand-theme",
        { primaryHex },
      );
      expect(response.statusCode).toBe(422);
      expect(brand.now().primaryHex).toBeNull();
    },
  );
});
