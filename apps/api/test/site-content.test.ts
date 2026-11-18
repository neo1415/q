import { describe, expect, it } from "vitest";

import { parseApiConfig } from "@capital-q/config/api";
import type { PublicSitePageDto } from "@capital-q/contracts";
import {
  createPlatformAdmin,
  type AdminRole,
  type SiteContentStore,
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
 * Decision 107, the site content routes. Anyone may read a PUBLISHED page
 * with no credential; drafts, versions and every write belong to platform
 * admins holding the permission, and writes need a live step-up. Everyone
 * else gets the 404 of a missing path and the store is never asked to
 * write. The real platform-admin service decides.
 */

const TENANT = TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001");
const STEP_UP_ID = "f0000000-0000-4000-8000-000000000001";
const NOBODY = "b0000000-0000-4000-8000-000000000001";
const ANALYST = "b0000000-0000-4000-8000-000000000002";
const OPERATOR_NO_STEP_UP = "b0000000-0000-4000-8000-000000000003";
const OPERATOR = "b0000000-0000-4000-8000-000000000004";
const TRUST = "b0000000-0000-4000-8000-000000000005";

type Person = { readonly role: AdminRole; readonly stepUp: boolean };
const PEOPLE: ReadonlyMap<string, Person> = new Map([
  [ANALYST, { role: "analyst", stepUp: true }],
  [TRUST, { role: "trust_and_safety", stepUp: true }],
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

const LIVE: PublicSitePageDto = {
  slug: "faq",
  kind: "faq",
  title: "FAQ",
  summary: "",
  effectiveDate: null,
  versionNumber: 2,
  publishedAt: "2026-11-18T09:00:00.000Z",
  blocks: [{ type: "heading", id: "h", level: 2, text: "Published words" }],
};

function memoryStore() {
  const calls: string[] = [];
  const saved: unknown[] = [];
  const store: SiteContentStore = {
    publicPage: (slug) => {
      calls.push(`publicPage:${slug}`);
      return Promise.resolve(slug === "faq" ? LIVE : null);
    },
    publicLanding: () => Promise.resolve({ sections: [] }),
    publicImage: () => Promise.resolve(null),
    listPages: () => {
      calls.push("listPages");
      return Promise.resolve({
        pages: [],
        settings: {
          settings: {
            companyName: "Capital Q",
            legalEntity: null,
            registeredAddress: null,
            contactEmail: null,
            governingLawCity: null,
          },
          revision: 1,
          updatedAt: "2026-11-18T09:00:00.000Z",
        },
      });
    },
    pageDetail: () => {
      calls.push("pageDetail");
      return Promise.resolve(null);
    },
    version: () => Promise.resolve(null),
    saveDraft: (_grant, _slug, input) => {
      calls.push("saveDraft");
      saved.push(input.blocks);
      return Promise.resolve({
        kind: "SAVED" as const,
        revision: input.expectedRevision + 1,
        updatedAt: "2026-11-18T09:01:00.000Z",
      });
    },
    publish: () => {
      calls.push("publish");
      return Promise.resolve({ kind: "NEEDS_LEGAL_CONFIRMATION" as const });
    },
    unpublish: () => {
      calls.push("unpublish");
      return Promise.resolve("UNPUBLISHED" as const);
    },
    restore: () => {
      calls.push("restore");
      return Promise.resolve({ kind: "RESTORED" as const, revision: 2 });
    },
    readSettings: () => Promise.reject(new Error("unused")),
    updateSettings: () => {
      calls.push("updateSettings");
      return Promise.resolve("CHANGED" as const);
    },
  };
  return { store, calls, saved };
}

function appFor(userId: string, content: SiteContentStore) {
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
      siteContent: { content },
    },
  ).app;
}

async function call(
  userId: string | null,
  content: SiteContentStore,
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: Record<string, unknown>,
) {
  const app = appFor(userId ?? NOBODY, content);
  const response = await app.inject({
    method,
    url,
    ...(userId === null ? {} : { headers: { authorization: "Bearer test" } }),
    ...(payload === undefined ? {} : { payload }),
  });
  await app.close();
  return response;
}

const DRAFT = {
  title: "FAQ",
  summary: "",
  blocks: [{ type: "heading", id: "h", level: 2, text: "Draft words" }],
  expectedRevision: 3,
};

describe("site content routes", () => {
  it("anyone reads a published page with no credential, and an unpublished or malformed slug is one 404", async () => {
    const { store } = memoryStore();
    const live = await call(null, store, "GET", "/v1/site/pages/faq");
    expect(live.statusCode).toBe(200);
    expect(live.json()).toMatchObject({ slug: "faq", versionNumber: 2 });
    expect(live.headers["cache-control"]).toBe("public, max-age=60");
    for (const url of [
      "/v1/site/pages/terms",
      "/v1/site/pages/Not_A_Slug",
      "/v1/site/images/not-a-uuid",
    ]) {
      expect((await call(null, store, "GET", url)).statusCode).toBe(404);
    }
  });

  it.each([
    ["a person who is not an admin", NOBODY],
    ["an analyst", ANALYST],
    ["trust and safety", TRUST],
  ])("%s cannot read drafts or the page list", async (_who, userId) => {
    const { store, calls } = memoryStore();
    expect(
      (await call(userId, store, "GET", "/v1/admin/site/pages")).statusCode,
    ).toBe(404);
    expect(
      (await call(userId, store, "GET", "/v1/admin/site/pages/faq")).statusCode,
    ).toBe(404);
    expect(
      (await call(userId, store, "GET", "/v1/admin/site/pages/faq/versions/1"))
        .statusCode,
    ).toBe(404);
    expect(calls).toEqual([]);
  });

  it.each([
    ["a person who is not an admin", NOBODY],
    ["an analyst", ANALYST],
  ])(
    "%s cannot save, publish, restore, unpublish or change settings",
    async (_who, userId) => {
      const { store, calls } = memoryStore();
      const writes = [
        ["PUT", "/v1/admin/site/pages/faq/draft", DRAFT],
        ["POST", "/v1/admin/site/pages/faq/publish", { expectedRevision: 3 }],
        [
          "POST",
          "/v1/admin/site/pages/faq/restore",
          { versionNumber: 1, expectedRevision: 3 },
        ],
        [
          "POST",
          "/v1/admin/site/pages/faq/unpublish",
          { reason: "Taking it down" },
        ],
        [
          "POST",
          "/v1/admin/site/settings",
          {
            settings: {
              companyName: "X",
              legalEntity: null,
              registeredAddress: null,
              contactEmail: null,
              governingLawCity: null,
            },
            expectedRevision: 1,
          },
        ],
      ] as const;
      for (const [method, url, body] of writes) {
        const response = await call(userId, store, method, url, body);
        expect(response.statusCode).toBe(404);
      }
      expect(calls).toEqual([]);
    },
  );

  it("an operator without a live step-up is asked to confirm, and nothing is written", async () => {
    const { store, calls } = memoryStore();
    const response = await call(
      OPERATOR_NO_STEP_UP,
      store,
      "PUT",
      "/v1/admin/site/pages/faq/draft",
      DRAFT,
    );
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "STEP_UP_REQUIRED" });
    expect(calls).toEqual([]);
    // Reading the list needs no step-up.
    expect(
      (await call(OPERATOR_NO_STEP_UP, store, "GET", "/v1/admin/site/pages"))
        .statusCode,
    ).toBe(200);
  });

  it("an operator with a step-up saves; a script in text stays text and an unsafe link is dropped before the store sees it", async () => {
    const { store, saved } = memoryStore();
    const response = await call(
      OPERATOR,
      store,
      "PUT",
      "/v1/admin/site/pages/faq/draft",
      {
        ...DRAFT,
        blocks: [
          {
            type: "richText",
            id: "r",
            content: [
              {
                kind: "paragraph",
                spans: [
                  { text: "<script>alert(1)</script>" },
                  { text: "x", href: "javascript:alert(1)" },
                ],
              },
            ],
          },
        ],
      },
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      revision: 4,
      updatedAt: "2026-11-18T09:01:00.000Z",
    });
    expect(saved[0]).toEqual([
      {
        type: "richText",
        id: "r",
        content: [
          {
            kind: "paragraph",
            spans: [{ text: "<script>alert(1)</script>" }, { text: "x" }],
          },
        ],
      },
    ]);
  });

  it("refuses blocks that are not the block model", async () => {
    const { store, calls } = memoryStore();
    const response = await call(
      OPERATOR,
      store,
      "PUT",
      "/v1/admin/site/pages/faq/draft",
      {
        ...DRAFT,
        blocks: [
          { type: "html", id: "x", html: "<img src=x onerror=alert(1)>" },
        ],
      },
    );
    expect(response.statusCode).toBe(422);
    expect(calls).toEqual([]);
  });

  it("a legal page does not go live without the lawyer's approval confirmed", async () => {
    const { store } = memoryStore();
    const response = await call(
      OPERATOR,
      store,
      "POST",
      "/v1/admin/site/pages/terms/publish",
      { expectedRevision: 1 },
    );
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "RESOURCE_CONFLICT" });
  });
});
