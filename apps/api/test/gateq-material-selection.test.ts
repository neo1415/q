import { describe, expect, it } from "vitest";

import { parseApiConfig } from "@capital-q/config/api";
import {
  GATEQ_APPLY_MATERIALS_SELECTION_PATH,
  GATEQ_APPLY_SESSION_HEADER,
} from "@capital-q/contracts";
import { IntakeRefusedError } from "@capital-q/gateq-intake";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
  type AuthenticatedPrincipal,
} from "@capital-q/security";

import { createApp, type ApiSecurityDependencies } from "../src/app.js";
import {
  createApplicationMaterialSelection,
  createApplicationMaterials,
  MaterialNotSharableError,
} from "../src/gateq/application-materials.js";

/**
 * Live defect 2026-11-14: a founder ticked two documents, resumed in a new
 * browser and sent the application with none. The ticks are now kept on the
 * server as a draft that shares nothing; Send is still the consent (ADR 0067
 * §5), and only Send attaches a document the investor can read.
 */

const PRINCIPAL: AuthenticatedPrincipal = {
  authUserId: AuthUserIdSchema.parse("a0000000-0000-4000-8000-000000000001"),
};
const actor = (n: string, org: string): ActorContext => ({
  userId: UserIdSchema.parse(`b0000000-0000-4000-8000-00000000000${n}`),
  tenantId: TenantIdSchema.parse(`c0000000-0000-4000-8000-00000000000${n}`),
  organisationId: OrganisationIdSchema.parse(
    `d0000000-0000-4000-8000-00000000000${org}`,
  ),
  membershipId: MembershipIdSchema.parse(
    `e0000000-0000-4000-8000-00000000000${n}`,
  ),
  actorType: "HUMAN",
});
const FOUNDER = actor("1", "1");
const STRANGER = actor("2", "2");
const DECK = "00000000-0000-4000-8000-0000000000d1";
const ACCOUNTS = "00000000-0000-4000-8000-0000000000d2";
const OTHERS = "00000000-0000-4000-8000-0000000000d9";
const TOKEN = `gqs_${"c".repeat(43)}`;
const OTHER_TOKEN = `gqs_${"e".repeat(43)}`;

/** The server's state: the only thing a fresh browser shares with the old. */
function world() {
  const applications = new Map([
    [TOKEN, { id: "app-1", tenantId: "t-investor", status: "IN_PROGRESS" }],
    [
      OTHER_TOKEN,
      { id: "app-2", tenantId: "t-investor", status: "IN_PROGRESS" },
    ],
  ]);
  // As the table holds it: one row per application, whole list, revision.
  const rows = new Map<
    string,
    { selectedByUserId: string; documentIds: string[]; revision: number }
  >();
  const attached: string[] = [];
  const owners = new Map([
    [DECK, FOUNDER.organisationId],
    [ACCOUNTS, FOUNDER.organisationId],
    [OTHERS, STRANGER.organisationId],
  ]);
  const authoriseGuest = (token: string) => {
    const application = applications.get(token);
    return application === undefined
      ? Promise.reject(new IntakeRefusedError("SESSION_INVALID"))
      : Promise.resolve({ application });
  };
  const ownDocument = (who: ActorContext, documentId: string) =>
    Promise.resolve(owners.get(documentId) === who.organisationId);
  const selection = createApplicationMaterialSelection({
    authoriseGuest,
    ownDocument,
    store: {
      read: ({ applicationId }) =>
        Promise.resolve(rows.get(applicationId) ?? null),
      write: ({ applicationId, userId, documentIds }) => {
        const held = rows.get(applicationId);
        if (held === undefined) {
          rows.set(applicationId, {
            selectedByUserId: userId,
            documentIds: [...documentIds],
            revision: 1,
          });
          return Promise.resolve(true);
        }
        if (held.selectedByUserId !== userId) return Promise.resolve(false);
        if (held.documentIds.join() !== documentIds.join())
          rows.set(applicationId, {
            ...held,
            documentIds: [...documentIds],
            revision: held.revision + 1,
          });
        return Promise.resolve(true);
      },
    },
  });
  const materials = createApplicationMaterials({
    authoriseGuest,
    ownDocument,
    attach: ({ documentId }) => {
      attached.push(documentId);
      return Promise.resolve();
    },
  });
  return { applications, rows, attached, selection, materials };
}

describe("the founder's draft document ticks", () => {
  it("survive a resume with no local state, and an untick persists", async () => {
    const server = world();
    // Browser A: tick both, then untick the accounts.
    await server.selection.write({
      actor: FOUNDER,
      sessionToken: TOKEN,
      documentIds: [DECK],
    });
    await server.selection.write({
      actor: FOUNDER,
      sessionToken: TOKEN,
      documentIds: [DECK, ACCOUNTS],
    });
    await server.selection.write({
      actor: FOUNDER,
      sessionToken: TOKEN,
      documentIds: [DECK],
    });
    // Browser B knows only the credential the account reopened.
    await expect(
      server.selection.read({ actor: FOUNDER, sessionToken: TOKEN }),
    ).resolves.toEqual({ documentIds: [DECK] });
  });

  it("says when nothing was ever chosen (null), apart from an empty choice", async () => {
    const server = world();
    await expect(
      server.selection.read({ actor: FOUNDER, sessionToken: TOKEN }),
    ).resolves.toEqual({ documentIds: null });
    await server.selection.write({
      actor: FOUNDER,
      sessionToken: TOKEN,
      documentIds: [],
    });
    await expect(
      server.selection.read({ actor: FOUNDER, sessionToken: TOKEN }),
    ).resolves.toEqual({ documentIds: [] });
  });

  it("is idempotent: a retried tick is the same row, not a new revision", async () => {
    const server = world();
    for (let i = 0; i < 3; i += 1)
      await server.selection.write({
        actor: FOUNDER,
        sessionToken: TOKEN,
        documentIds: [DECK, DECK],
      });
    expect(server.rows.get("app-1")).toEqual({
      selectedByUserId: FOUNDER.userId,
      documentIds: [DECK],
      revision: 1,
    });
  });

  it("shares nothing: no document is attached until Send", async () => {
    const server = world();
    await server.selection.write({
      actor: FOUNDER,
      sessionToken: TOKEN,
      documentIds: [DECK, ACCOUNTS],
    });
    // What the investor's pack reads is the attachment, and there is none.
    expect(server.attached).toEqual([]);
    // Send (after Review) is the only path that attaches.
    await server.materials.share({
      actor: FOUNDER,
      sessionToken: TOKEN,
      documentIds: [DECK],
    });
    expect(server.attached).toEqual([DECK]);
  });

  it("refuses another organisation's document and writes nothing", async () => {
    const server = world();
    await expect(
      server.selection.write({
        actor: FOUNDER,
        sessionToken: TOKEN,
        documentIds: [DECK, OTHERS],
      }),
    ).rejects.toBeInstanceOf(MaterialNotSharableError);
    expect(server.rows.size).toBe(0);
  });

  it("another founder can neither read nor overwrite it, even with the credential", async () => {
    const server = world();
    await server.selection.write({
      actor: FOUNDER,
      sessionToken: TOKEN,
      documentIds: [DECK],
    });
    await expect(
      server.selection.read({ actor: STRANGER, sessionToken: TOKEN }),
    ).resolves.toEqual({ documentIds: null });
    await expect(
      server.selection.write({
        actor: STRANGER,
        sessionToken: TOKEN,
        documentIds: [OTHERS],
      }),
    ).rejects.toBeInstanceOf(MaterialNotSharableError);
    expect(server.rows.get("app-1")?.documentIds).toEqual([DECK]);
  });

  it("a credential names its own application only; a forged one is refused", async () => {
    const server = world();
    await server.selection.write({
      actor: FOUNDER,
      sessionToken: TOKEN,
      documentIds: [DECK],
    });
    await expect(
      server.selection.read({ actor: FOUNDER, sessionToken: OTHER_TOKEN }),
    ).resolves.toEqual({ documentIds: null });
    await expect(
      server.selection.read({
        actor: FOUNDER,
        sessionToken: `gqs_${"z".repeat(43)}`,
      }),
    ).rejects.toBeInstanceOf(IntakeRefusedError);
  });

  it("drops a document that is no longer theirs instead of showing it", async () => {
    const server = world();
    server.rows.set("app-1", {
      selectedByUserId: FOUNDER.userId,
      documentIds: [DECK, OTHERS],
      revision: 1,
    });
    await expect(
      server.selection.read({ actor: FOUNDER, sessionToken: TOKEN }),
    ).resolves.toEqual({ documentIds: [DECK] });
  });

  it("is frozen once the application is sent", async () => {
    const server = world();
    const app1 = server.applications.get(TOKEN);
    if (app1 === undefined) throw new Error("fixture");
    server.applications.set(TOKEN, { ...app1, status: "SUBMITTED" });
    await expect(
      server.selection.write({
        actor: FOUNDER,
        sessionToken: TOKEN,
        documentIds: [DECK],
      }),
    ).rejects.toBeInstanceOf(MaterialNotSharableError);
  });
});

describe("the draft ticks over HTTP", () => {
  function build(who: ActorContext) {
    const server = world();
    const security: ApiSecurityDependencies = {
      authenticator: {
        authenticate: (request) =>
          Promise.resolve(
            request.headers.authorization === "Bearer signed-in"
              ? PRINCIPAL
              : null,
          ),
      },
      resolver: {
        resolveHumanContext: () =>
          Promise.resolve({ status: "RESOLVED", context: who }),
      },
      identities: { lookup: () => Promise.resolve(null) },
    };
    const { app } = createApp(parseApiConfig({ NODE_ENV: "test" }), security, {
      gateq: {} as never,
      gateqMaterialSelection: server.selection,
    });
    return { app, server };
  }
  const auth = { authorization: "Bearer signed-in" };

  it("PUT keeps the list; GET with the credential header returns it", async () => {
    const { app } = build(FOUNDER);
    const put = await app.inject({
      method: "PUT",
      url: GATEQ_APPLY_MATERIALS_SELECTION_PATH,
      headers: auth,
      payload: { sessionToken: TOKEN, documentIds: [DECK, ACCOUNTS] },
    });
    expect(put.statusCode).toBe(200);
    expect(put.headers["cache-control"]).toBe("no-store");
    const got = await app.inject({
      method: "GET",
      url: GATEQ_APPLY_MATERIALS_SELECTION_PATH,
      headers: { ...auth, [GATEQ_APPLY_SESSION_HEADER]: TOKEN },
    });
    expect(got.statusCode).toBe(200);
    expect(got.json()).toEqual({ documentIds: [DECK, ACCOUNTS] });
    await app.close();
  });

  it("another organisation's document, or a wrong credential, is one 404", async () => {
    const { app, server } = build(FOUNDER);
    const foreign = await app.inject({
      method: "PUT",
      url: GATEQ_APPLY_MATERIALS_SELECTION_PATH,
      headers: auth,
      payload: { sessionToken: TOKEN, documentIds: [OTHERS] },
    });
    expect(foreign.statusCode).toBe(404);
    const forged = await app.inject({
      method: "GET",
      url: GATEQ_APPLY_MATERIALS_SELECTION_PATH,
      headers: { ...auth, [GATEQ_APPLY_SESSION_HEADER]: "gqs_nope" },
    });
    expect(forged.statusCode).toBe(404);
    expect(server.rows.size).toBe(0);
    await app.close();
  });

  it("needs a signed-in founder", async () => {
    const { app } = build(FOUNDER);
    const anonymous = await app.inject({
      method: "PUT",
      url: GATEQ_APPLY_MATERIALS_SELECTION_PATH,
      payload: { sessionToken: TOKEN, documentIds: [DECK] },
    });
    expect(anonymous.statusCode).toBe(401);
    await app.close();
  });
});
