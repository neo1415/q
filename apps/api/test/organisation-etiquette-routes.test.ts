import { describe, expect, it } from "vitest";

import type { OrganisationEtiquettePort } from "@capital-q/app-actions";
import { parseApiConfig } from "@capital-q/config/api";
import type {
  OrganisationEtiquetteGuide,
  OrganisationEtiquetteOwner,
} from "@capital-q/q-runtime";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import { createApp } from "../src/app.js";

/**
 * Owner decision 112: "How Q speaks for us". Every member of the active
 * organisation reads its guide and history; only its owners and admins
 * (organisation.admin) save a new version, through the app action
 * organisation.etiquette_guide.save, refused by the API itself; the
 * organisation is always the session actor's own, never one a request
 * names.
 */

const TENANT = TenantIdSchema.parse("c0000000-0000-4000-8000-00000000000a");
const ORG = OrganisationIdSchema.parse("d0000000-0000-4000-8000-00000000000a");
const ADMIN: ActorContext = {
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000001"),
  tenantId: TENANT,
  organisationId: ORG,
  membershipId: MembershipIdSchema.parse(
    "e0000000-0000-4000-8000-000000000001",
  ),
  actorType: "HUMAN",
};
const MEMBER: ActorContext = {
  ...ADMIN,
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000002"),
};
const PERSONAL: ActorContext = {
  userId: ADMIN.userId,
  tenantId: TENANT,
  actorType: "HUMAN",
};

const TEXT = "Formal with investors. Sign as the Harbour team, never as I.";
const URL = "/v1/organisation/etiquette-guide";

function memory() {
  const saved: {
    readonly owner: OrganisationEtiquetteOwner;
    readonly by: string;
  }[] = [];
  const rows: OrganisationEtiquetteGuide[] = [];
  const port: OrganisationEtiquettePort = {
    read: () => Promise.resolve(rows.at(-1) ?? null),
    history: () =>
      Promise.resolve(
        [...rows].reverse().map((row) => ({
          version: row.version,
          sourceKind: row.sourceKind,
          fileName: row.fileName,
          savedAt: row.savedAt,
          savedBy: row.savedBy,
          characters: row.text.length,
        })),
      ),
    save: (owner, by, input) => {
      saved.push({ owner, by });
      const row: OrganisationEtiquetteGuide = {
        version: rows.length + 1,
        sourceKind: input.sourceKind,
        fileName: input.fileName,
        mediaType: input.mediaType,
        text: input.text,
        savedAt: "2026-11-21T12:00:00.000Z",
        savedBy: by,
      };
      rows.push(row);
      return Promise.resolve(row);
    },
    mayManage: (who) => Promise.resolve(who.userId === ADMIN.userId),
    house: () =>
      Promise.resolve({
        source: "BUILT_IN",
        title: "How Q conducts business",
        version: "built-in/v1",
      }),
  };
  return { port, saved };
}

type Memory = ReturnType<typeof memory>;

async function call(
  actor: ActorContext,
  stores: Memory,
  method: "GET" | "PUT",
  payload?: Record<string, unknown>,
) {
  const { app } = createApp(
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
          Promise.resolve({ status: "RESOLVED", context: actor }),
      },
      identities: { lookup: () => Promise.resolve(null) },
    },
    {
      etiquette: {
        guides: {
          read: () => Promise.resolve(null),
          save: () => Promise.reject(new Error("not used")),
          remove: () => Promise.resolve(false),
          house: stores.port.house,
        },
        organisation: stores.port,
      },
    },
  );
  const response = await app.inject({
    method,
    url: URL,
    headers: { authorization: "Bearer test" },
    ...(payload === undefined ? {} : { payload }),
  });
  await app.close();
  return response;
}

const SAVE = { sourceKind: "PASTE", text: TEXT };

describe("the organisation's guide", () => {
  it("an owner or admin saves versions, for their own organisation only", async () => {
    const stores = memory();
    expect((await call(ADMIN, stores, "PUT", SAVE)).statusCode).toBe(200);
    const second = await call(ADMIN, stores, "PUT", {
      sourceKind: "PASTE",
      text: `${TEXT} Version two.`,
    });
    expect(second.statusCode).toBe(200);
    const body = second.json<{
      guide: { version: number; text: string };
      versions: { version: number }[];
      canChange: boolean;
    }>();
    expect(body.guide.version).toBe(2);
    expect(body.versions.map((one) => one.version)).toEqual([2, 1]);
    expect(body.canChange).toBe(true);
    expect(stores.saved).toEqual([
      { owner: { tenantId: TENANT, organisationId: ORG }, by: ADMIN.userId },
      { owner: { tenantId: TENANT, organisationId: ORG }, by: ADMIN.userId },
    ]);
  });

  it("a member reads it and cannot change it: the API refuses, nothing is saved", async () => {
    const stores = memory();
    await call(ADMIN, stores, "PUT", SAVE);
    const read = await call(MEMBER, stores, "GET");
    expect(read.statusCode).toBe(200);
    const ours = read.json<{ canChange: boolean; guide: { text: string } }>();
    expect(ours.canChange).toBe(false);
    expect(ours.guide.text).toBe(TEXT);
    const write = await call(MEMBER, stores, "PUT", {
      sourceKind: "PASTE",
      text: `${TEXT} A member's change.`,
    });
    expect(write.statusCode).toBeGreaterThanOrEqual(400);
    expect(stores.saved).toHaveLength(1);
  });

  it("a person acting for no organisation has no organisation guide", async () => {
    const stores = memory();
    expect((await call(PERSONAL, stores, "GET")).statusCode).toBe(404);
    expect(
      (await call(PERSONAL, stores, "PUT", SAVE)).statusCode,
    ).toBeGreaterThanOrEqual(400);
    expect(stores.saved).toEqual([]);
  });

  it("refuses a guide too short to mean anything", async () => {
    const stores = memory();
    const response = await call(ADMIN, stores, "PUT", {
      sourceKind: "PASTE",
      text: "Be nice.",
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
    expect(stores.saved).toEqual([]);
  });
});
