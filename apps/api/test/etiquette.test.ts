import { describe, expect, it } from "vitest";

import type { EtiquetteGuidePort } from "@capital-q/app-actions";
import { parseApiConfig } from "@capital-q/config/api";
import {
  createPlatformAdmin,
  type AdminRole,
  type EtiquetteGuideAdminStore,
  type NewPlatformEtiquetteVersion,
  type PlatformEtiquetteVersion,
} from "@capital-q/platform-admin";
import type {
  EtiquetteGuideOwner,
  PersonalEtiquetteGuide,
} from "@capital-q/q-runtime";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@capital-q/security";

import { createApp } from "../src/app.js";

/**
 * ADR 0050: how Q conducts business. A person reads, saves and removes only
 * their own guide (the owner is the resolved actor, never the body); the
 * text is validated and bounded. The house guide is the console's: only a
 * platform admin with the write permission and a live step-up records or
 * switches it; everyone else gets the 404 of a missing path.
 */

const TENANT = TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001");
const STEP_UP_ID = "f0000000-0000-4000-8000-000000000001";
const NOBODY = "b0000000-0000-4000-8000-000000000001";
const ANALYST = "b0000000-0000-4000-8000-000000000002";
const OPERATOR_NO_STEP_UP = "b0000000-0000-4000-8000-000000000003";
const OPERATOR = "b0000000-0000-4000-8000-000000000004";
const SOMEONE_ELSE = "b0000000-0000-4000-8000-000000000009";

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

function memoryStores() {
  const personal = new Map<string, PersonalEtiquetteGuide[]>();
  const owners: EtiquetteGuideOwner[] = [];
  const key = (owner: EtiquetteGuideOwner) =>
    `${owner.tenantId}:${owner.userId}`;
  const versions: (PlatformEtiquetteVersion & { text: string })[] = [];
  let active: string | null = null;
  const adminStore: EtiquetteGuideAdminStore = {
    active: () => {
      const found = versions.find((version) => version.id === active);
      return Promise.resolve(
        found === undefined
          ? null
          : {
              versionId: found.id,
              version: found.version,
              title: found.title,
              text: found.text,
              updatedAt: "2026-10-05T09:00:00.000Z",
            },
      );
    },
    view: async () => ({
      active: await adminStore.active(),
      updatedAt: null,
      versions: [...versions].reverse().map(({ text: _text, ...rest }) => rest),
    }),
    record: (_grant, input: NewPlatformEtiquetteVersion) => {
      const id = `00000000-0000-4000-8000-${String(versions.length + 1).padStart(12, "0")}`;
      versions.push({
        id,
        version: versions.length + 1,
        title: input.title,
        sourceKind: input.sourceKind,
        fileName: input.fileName,
        mediaType: input.mediaType,
        characters: input.text.length,
        createdBy: "Ops",
        createdAt: "2026-10-05T09:00:00.000Z",
        text: input.text,
      });
      active = id;
      return Promise.resolve();
    },
    activate: (_grant, versionId) => {
      if (versionId !== null && !versions.some((v) => v.id === versionId)) {
        return Promise.resolve(false);
      }
      active = versionId;
      return Promise.resolve(true);
    },
  };
  const guides: EtiquetteGuidePort = {
    read: (owner) => {
      owners.push(owner);
      return Promise.resolve(personal.get(key(owner))?.at(-1) ?? null);
    },
    save: (owner, input) => {
      owners.push(owner);
      const list = personal.get(key(owner)) ?? [];
      const guide: PersonalEtiquetteGuide = {
        version: list.length + 1,
        sourceKind: input.sourceKind,
        fileName: input.fileName,
        mediaType: input.mediaType,
        text: input.text,
        savedAt: "2026-10-05T09:00:00.000Z",
      };
      personal.set(key(owner), [...list, guide]);
      return Promise.resolve(guide);
    },
    remove: (owner) => {
      owners.push(owner);
      return Promise.resolve(personal.delete(key(owner)));
    },
    house: async () => {
      const current = await adminStore.active();
      return current === null
        ? {
            source: "BUILT_IN",
            title: "How Q conducts business",
            version: "built-in/v1",
          }
        : {
            source: "UPLOADED",
            title: current.title,
            version: `platform/v${String(current.version)}`,
          };
    },
  };
  return { guides, adminStore, personal, owners, active: () => active };
}

type Stores = ReturnType<typeof memoryStores>;

function appFor(userId: string, stores: Stores) {
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
      etiquette: { guides: stores.guides, adminStore: stores.adminStore },
    },
  ).app;
}

async function call(
  userId: string,
  stores: Stores,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: Record<string, unknown>,
) {
  const app = appFor(userId, stores);
  const response = await app.inject({
    method,
    url,
    headers: { authorization: "Bearer test" },
    ...(payload === undefined ? {} : { payload }),
  });
  await app.close();
  return response;
}

const GUIDE = "Formal with investors. Sign off as 'Warm regards, Ada'.";

describe("a person's own guide", () => {
  it("is read, saved as a new version and removed, always as the signed-in person", async () => {
    const stores = memoryStores();
    const empty = await call(NOBODY, stores, "GET", "/v1/me/etiquette-guide");
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({
      guide: null,
      house: {
        source: "BUILT_IN",
        title: "How Q conducts business",
        version: "built-in/v1",
      },
    });
    const saved = await call(NOBODY, stores, "PUT", "/v1/me/etiquette-guide", {
      sourceKind: "PASTE",
      text: GUIDE,
    });
    expect(saved.statusCode).toBe(200);
    expect(
      saved.json<{ guide: { version: number; text: string } }>().guide,
    ).toMatchObject({ version: 1, text: GUIDE });
    const again = await call(NOBODY, stores, "PUT", "/v1/me/etiquette-guide", {
      sourceKind: "FILE",
      fileName: "how-i-write.docx",
      mediaType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      text: `${GUIDE} Never use exclamation marks.`,
    });
    expect(again.json<{ guide: { version: number } }>().guide.version).toBe(2);
    const removed = await call(
      NOBODY,
      stores,
      "DELETE",
      "/v1/me/etiquette-guide/versions",
    );
    expect(removed.statusCode).toBe(200);
    expect(removed.json<{ guide: null }>().guide).toBeNull();
    expect(
      stores.owners.every(
        (owner) => owner.userId === NOBODY && owner.tenantId === TENANT,
      ),
    ).toBe(true);
  });

  it("cannot name another person: the body is input, never identity", async () => {
    const stores = memoryStores();
    const response = await call(
      NOBODY,
      stores,
      "PUT",
      "/v1/me/etiquette-guide",
      { sourceKind: "PASTE", text: GUIDE, userId: SOMEONE_ELSE },
    );
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(stores.personal.size).toBe(0);
  });

  it.each([
    ["empty text", { sourceKind: "PASTE", text: "   \n  " }],
    ["over the size limit", { sourceKind: "PASTE", text: "a".repeat(20_001) }],
    ["control characters", { sourceKind: "PASTE", text: `${GUIDE}\u0000` }],
    ["a file without its name", { sourceKind: "FILE", text: GUIDE }],
    [
      "a path as the file name",
      {
        sourceKind: "FILE",
        fileName: "../../etc/passwd",
        mediaType: "text/plain",
        text: GUIDE,
      },
    ],
    [
      "an unsupported file type",
      {
        sourceKind: "FILE",
        fileName: "guide.html",
        mediaType: "text/html",
        text: GUIDE,
      },
    ],
  ])("refuses %s and saves nothing", async (_what, payload) => {
    const stores = memoryStores();
    const response = await call(
      NOBODY,
      stores,
      "PUT",
      "/v1/me/etiquette-guide",
      payload,
    );
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
    expect(stores.personal.size).toBe(0);
  });
});

describe("the house guide in the operations console", () => {
  const RECORD = {
    title: "Capital Q house style",
    sourceKind: "FILE",
    fileName: "house-style.pdf",
    mediaType: "application/pdf",
    text: "Always greet people warmly and by name. Never chase twice.",
  };

  it.each([
    ["a non-admin", NOBODY],
    ["an admin whose role cannot write", ANALYST],
  ])("%s cannot record one: 404, nothing changes", async (_who, userId) => {
    const stores = memoryStores();
    const response = await call(
      userId,
      stores,
      "POST",
      "/v1/admin/etiquette-guide",
      RECORD,
    );
    expect(response.statusCode).toBe(404);
    expect(stores.active()).toBeNull();
  });

  it("a non-admin cannot read the console view", async () => {
    const response = await call(
      NOBODY,
      memoryStores(),
      "GET",
      "/v1/admin/etiquette-guide",
    );
    expect(response.statusCode).toBe(404);
  });

  it("an operator must confirm it's them first", async () => {
    const stores = memoryStores();
    const response = await call(
      OPERATOR_NO_STEP_UP,
      stores,
      "POST",
      "/v1/admin/etiquette-guide",
      RECORD,
    );
    expect(response.statusCode).toBe(403);
    expect(response.json<{ code: string }>().code).toBe("STEP_UP_REQUIRED");
    expect(stores.active()).toBeNull();
  });

  it("an operator with a step-up records a version, which people then see as the house guide", async () => {
    const stores = memoryStores();
    const recorded = await call(
      OPERATOR,
      stores,
      "POST",
      "/v1/admin/etiquette-guide",
      RECORD,
    );
    expect(recorded.statusCode).toBe(200);
    const body = recorded.json<{
      activeVersionId: string;
      activeTitle: string;
      builtIn: { version: string; text: string };
      versions: { version: number; fileName: string }[];
    }>();
    expect(body.activeTitle).toBe("Capital Q house style");
    expect(body.builtIn.version).toBe("built-in/v1");
    expect(body.builtIn.text).toContain("Warmth before asks");
    expect(body.versions[0]).toMatchObject({
      version: 1,
      fileName: "house-style.pdf",
    });
    const mine = await call(NOBODY, stores, "GET", "/v1/me/etiquette-guide");
    expect(mine.json<{ house: unknown }>().house).toEqual({
      source: "UPLOADED",
      title: "Capital Q house style",
      version: "platform/v1",
    });
  });

  it("switches back to the built-in guide, and refuses an unknown version", async () => {
    const stores = memoryStores();
    await call(OPERATOR, stores, "POST", "/v1/admin/etiquette-guide", RECORD);
    const unknown = await call(
      OPERATOR,
      stores,
      "POST",
      "/v1/admin/etiquette-guide/active",
      { versionId: "00000000-0000-4000-8000-0000000000ff" },
    );
    expect(unknown.statusCode).toBe(404);
    expect(stores.active()).not.toBeNull();
    const reset = await call(
      OPERATOR,
      stores,
      "POST",
      "/v1/admin/etiquette-guide/active",
      { versionId: null },
    );
    expect(reset.statusCode).toBe(200);
    expect(reset.json<{ activeVersionId: null }>().activeVersionId).toBeNull();
    expect(stores.active()).toBeNull();
  });

  it("refuses an oversized or empty platform guide", async () => {
    const stores = memoryStores();
    for (const text of ["", "x".repeat(60_001)]) {
      const response = await call(
        OPERATOR,
        stores,
        "POST",
        "/v1/admin/etiquette-guide",
        { ...RECORD, text },
      );
      expect(response.statusCode).toBe(422);
    }
    expect(stores.active()).toBeNull();
  });
});
