import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  importSiteMarkdown,
  type ImportedSitePage,
  type SiteBlock,
} from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
  type TransactionManager,
} from "@capital-q/database";

import {
  createPlatformAdmin,
  createSiteContentStore,
  seedSiteContent,
  SiteContentGrantError,
  type AdminGrant,
} from "../src/index.js";

/**
 * The site content store (decision 107) against local Postgres with the
 * migrations applied. Every case runs in one transaction that is rolled
 * back, so nothing here outlives the test.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const DEFAULTS = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "content",
  "defaults",
);
const PAGES: ImportedSitePage[] = readdirSync(DEFAULTS)
  .filter((file) => file.endsWith(".md") && file !== "README.md")
  .sort()
  .map((file) =>
    importSiteMarkdown(readFileSync(join(DEFAULTS, file), "utf8")),
  );

class Rollback extends Error {}

const inOne = (tx: TransactionContext): TransactionManager => ({
  run: (work) => work(tx),
});

async function person(tx: TransactionContext, email: string) {
  const auth = randomUUID();
  await tx.sql`insert into auth.users (id, email) values (${auth}, ${email})`;
  const [row] = await tx.sql<{ id: string }[]>`
    select id from identity.user_profiles where auth_user_id = ${auth}`;
  if (row === undefined) throw new Error("profile trigger missing");
  return { id: row.id, auth };
}

describe("site content store against local Postgres", () => {
  let db: RequestDatabase;

  beforeAll(() => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "2",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
      }),
    );
  });

  afterAll(async () => {
    await db.close();
  });

  async function scenario(
    body: (ctx: {
      readonly tx: TransactionContext;
      readonly store: ReturnType<typeof createSiteContentStore>;
      readonly admin: ReturnType<typeof createPlatformAdmin>;
      readonly owner: string;
      readonly analyst: string;
      readonly member: string;
      readonly write: () => Promise<AdminGrant>;
      readonly read: () => Promise<AdminGrant>;
    }) => Promise<void>,
  ) {
    try {
      await db.transactions.run(async (tx) => {
        const tag = randomUUID().slice(0, 8);
        const owner = await person(tx, `cms-owner-${tag}@example.invalid`);
        const analyst = await person(tx, `cms-analyst-${tag}@example.invalid`);
        const member = await person(tx, `cms-member-${tag}@example.invalid`);
        await tx.sql`delete from identity.platform_admins`;
        await tx.sql`insert into identity.platform_admins (user_id, role) values
          (${owner.id}, 'platform_owner'), (${analyst.id}, 'analyst')`;
        // A clean store inside this transaction only.
        await tx.sql`alter table site_content.page_versions disable trigger page_versions_immutable`;
        await tx.sql`alter table site_content.publish_events disable trigger publish_events_append_only`;
        await tx.sql`delete from site_content.publish_events`;
        await tx.sql`delete from site_content.published_pointers`;
        await tx.sql`delete from site_content.page_drafts`;
        await tx.sql`delete from site_content.page_versions`;
        await tx.sql`delete from site_content.pages`;
        await tx.sql`alter table site_content.page_versions enable trigger page_versions_immutable`;
        await tx.sql`alter table site_content.publish_events enable trigger publish_events_append_only`;
        const admin = createPlatformAdmin({
          sql: tx.sql,
          transactions: inOne(tx),
        });
        const store = createSiteContentStore({
          sql: tx.sql,
          transactions: inOne(tx),
        });
        const grantFor = async (
          permission: "content.read" | "content.write",
        ) => {
          const access = await admin.authorize(owner.id, permission);
          if (access.kind !== "GRANTED")
            throw new Error(`not granted: ${access.kind}`);
          return access.grant;
        };
        await body({
          tx,
          store,
          admin,
          owner: owner.id,
          analyst: analyst.id,
          member: member.id,
          read: () => grantFor("content.read"),
          write: async () => {
            await admin.recordStepUp({
              userId: owner.id,
              freshAuthUserId: owner.auth,
              authentication: {
                method: "password",
                at: Math.floor(Date.now() / 1000),
              },
            });
            return grantFor("content.write");
          },
        });
        throw new Rollback();
      });
    } catch (error: unknown) {
      if (!(error instanceof Rollback)) throw error;
    }
  }

  it("seeds every default once: non-legal pages live, legal pages pending review, a re-run changes nothing", async () => {
    await scenario(async ({ tx, store }) => {
      const first = await seedSiteContent(inOne(tx), PAGES);
      expect(first.created).toHaveLength(PAGES.length);
      expect(first.published).toEqual(
        PAGES.filter((p) => p.kind !== "legal").map((p) => p.slug),
      );
      const second = await seedSiteContent(inOne(tx), PAGES);
      expect(second.created).toEqual([]);
      expect(second.skipped).toHaveLength(PAGES.length);
      const [counts] = await tx.sql<{ versions: number; events: number }[]>`
        select (select count(*)::int from site_content.page_versions) as versions,
               (select count(*)::int from site_content.publish_events) as events`;
      expect(counts?.versions).toBe(PAGES.length);
      expect(counts?.events).toBe(first.published.length);

      expect(await store.publicPage("terms")).toBeNull();
      const legal = await tx.sql<{ status: string }[]>`
        select distinct status from site_content.pages where kind = 'legal'`;
      expect(legal.map((r) => r.status)).toEqual([
        "DRAFT_PENDING_LEGAL_REVIEW",
      ]);

      const pricing = await store.publicPage("pricing");
      expect(pricing?.versionNumber).toBe(1);
      expect(pricing?.blocks.some((b) => b.type === "pricing")).toBe(true);
      const faq = await store.publicPage("faq");
      // Placeholders resolve from the settings record, never raw braces.
      expect(JSON.stringify(faq)).not.toContain("{{");
      expect(JSON.stringify(faq)).toContain("Capital Q");
      const landing = await store.publicLanding();
      expect(landing.sections[0]?.slug).toBe("landing-nav");
      expect(landing.sections.map((s) => s.slug)).toContain("landing-hero");
    });
  });

  it("serves only published versions: a draft never reaches the public", async () => {
    await scenario(async ({ tx, store, write }) => {
      await seedSiteContent(inOne(tx), PAGES);
      const grant = await write();
      const detail = await store.pageDetail(grant, "faq");
      if (detail === null) throw new Error("no faq");
      const blocks: SiteBlock[] = [
        { type: "heading", id: "x1", level: 2, text: "Unreleased words" },
        ...detail.draft.blocks,
      ];
      const saved = await store.saveDraft(grant, "faq", {
        title: detail.draft.title,
        summary: detail.draft.summary,
        blocks,
        expectedRevision: detail.draft.revision,
      });
      expect(saved.kind).toBe("SAVED");
      expect(JSON.stringify(await store.publicPage("faq"))).not.toContain(
        "Unreleased words",
      );
      // A stale tab cannot overwrite.
      expect(
        (
          await store.saveDraft(grant, "faq", {
            title: "x",
            summary: "",
            blocks: [],
            expectedRevision: detail.draft.revision,
          })
        ).kind,
      ).toBe("STALE");
    });
  });

  it("publishes as a new immutable version, restores an old one to the draft, and republishes it as a restore", async () => {
    await scenario(async ({ tx, store, write }) => {
      await seedSiteContent(inOne(tx), PAGES);
      const grant = await write();
      const v1 = await store.pageDetail(grant, "faq");
      if (v1 === null) throw new Error("no faq");
      const saved = await store.saveDraft(grant, "faq", {
        title: "Questions, answered",
        summary: v1.draft.summary,
        blocks: v1.draft.blocks.slice(1),
        expectedRevision: v1.draft.revision,
      });
      if (saved.kind !== "SAVED") throw new Error(saved.kind);
      const none = () => Promise.resolve(null);
      const published = await store.publish(
        grant,
        "faq",
        { expectedRevision: saved.revision, reason: "Shorter FAQ" },
        none,
      );
      expect(published).toMatchObject({ kind: "PUBLISHED", versionNumber: 2 });
      const live = await store.publicPage("faq");
      expect(live?.title).toBe("Questions, answered");
      expect(live?.blocks).toHaveLength(v1.draft.blocks.length - 1);

      // Publishing again without changes reuses the version.
      const again = await store.pageDetail(grant, "faq");
      expect(
        await store.publish(
          grant,
          "faq",
          { expectedRevision: again?.draft.revision ?? 0 },
          none,
        ),
      ).toMatchObject({ kind: "PUBLISHED", versionNumber: 2 });

      const restored = await store.restore(grant, "faq", {
        versionNumber: 1,
        expectedRevision: again?.draft.revision ?? 0,
      });
      if (restored.kind !== "RESTORED") throw new Error(restored.kind);
      // Restore changes the draft only.
      expect((await store.publicPage("faq"))?.versionNumber).toBe(2);
      const v3 = await store.publish(
        grant,
        "faq",
        { expectedRevision: restored.revision },
        none,
      );
      expect(v3).toMatchObject({ kind: "PUBLISHED", versionNumber: 3 });
      const detail = await store.pageDetail(grant, "faq");
      expect(detail?.versions[0]).toMatchObject({
        versionNumber: 3,
        source: "RESTORE",
        restoredFrom: 1,
        live: true,
      });
      expect(detail?.history.map((e) => e.action)).toEqual([
        "PUBLISH",
        "RESTORE_TO_DRAFT",
        "PUBLISH",
        "PUBLISH",
        "PUBLISH",
      ]);
      const audited = await tx.sql<{ action_type: string }[]>`
        select action_type from platform_ops.admin_actions
         where resource_type = 'site_page' order by occurred_at, id`;
      expect(audited.map((a) => a.action_type)).toEqual([
        "site_content.publish",
        "site_content.publish",
        "site_content.restore",
        "site_content.publish",
      ]);
    });
  });

  it("never rewrites a version or the publish history", async () => {
    await scenario(async ({ tx }) => {
      await seedSiteContent(inOne(tx), PAGES);
      await expect(
        tx.sql`savepoint s1`.then(
          () => tx.sql`update site_content.page_versions set title = 'changed'`,
        ),
      ).rejects.toThrow(/immutable/u);
      await tx.sql`rollback to savepoint s1`;
      await tx.sql`savepoint s2`;
      await expect(
        tx.sql`delete from site_content.page_versions`,
      ).rejects.toThrow(/immutable/u);
      await tx.sql`rollback to savepoint s2`;
      await tx.sql`savepoint s3`;
      await expect(
        tx.sql`update site_content.publish_events set reason = 'rewritten'`,
      ).rejects.toThrow(/immutable/u);
      await tx.sql`rollback to savepoint s3`;
    });
  });

  it("keeps legal pages pending until a lawyer's approval is confirmed, and never shows lawyer notes", async () => {
    await scenario(async ({ tx, store, write }) => {
      await seedSiteContent(inOne(tx), PAGES);
      const grant = await write();
      const draft = await store.pageDetail(grant, "terms");
      expect(draft?.page.lawyerNotes).toBeGreaterThan(0);
      const revision = draft?.draft.revision ?? 0;
      expect(
        await store.publish(
          grant,
          "terms",
          { expectedRevision: revision },
          () => Promise.resolve(null),
        ),
      ).toEqual({ kind: "NEEDS_LEGAL_CONFIRMATION" });
      expect(await store.publicPage("terms")).toBeNull();
      expect(
        await store.publish(
          grant,
          "terms",
          {
            expectedRevision: revision,
            confirmLegalReview: true,
            reason: "Lawyer approved",
          },
          () => Promise.resolve(null),
        ),
      ).toMatchObject({ kind: "PUBLISHED", versionNumber: 1 });
      const live = await store.publicPage("terms");
      const text = JSON.stringify(live);
      expect(text).not.toMatch(/FCCPA 2018/u); // only in a LAWYER note
      expect(
        live?.blocks.every(
          (b) => b.type !== "legalClause" || b.lawyerNote === null,
        ),
      ).toBe(true);
      expect(text).toContain("[Registered company name]");
    });
  });

  it("sanitises rich text: a script stays text and a javascript: link is dropped", async () => {
    await scenario(async ({ tx, store, write }) => {
      await seedSiteContent(inOne(tx), PAGES);
      const grant = await write();
      const draft = await store.pageDetail(grant, "faq");
      const hostile: unknown = [
        {
          type: "richText",
          id: "evil",
          content: [
            {
              kind: "paragraph",
              spans: [
                { text: "<script>alert(1)</script>" },
                { text: "click", href: "javascript:alert(1)" },
                { text: "‮gnp.exe" },
              ],
            },
          ],
        },
      ];
      const saved = await store.saveDraft(grant, "faq", {
        title: "FAQ",
        summary: "",
        blocks: hostile as SiteBlock[],
        expectedRevision: draft?.draft.revision ?? 0,
      });
      expect(saved.kind).toBe("SAVED");
      const [row] = await tx.sql<{ blocks: unknown }[]>`
        select d.blocks from site_content.page_drafts d
          join site_content.pages p on p.id = d.page_id where p.slug = 'faq'`;
      expect(row?.blocks).toEqual([
        {
          type: "richText",
          id: "evil",
          content: [
            {
              kind: "paragraph",
              spans: [
                { text: "<script>alert(1)</script>" },
                { text: "click" },
                { text: "gnp.exe" },
              ],
            },
          ],
        },
      ]);
    });
  });

  it("refuses non-admins, read-only roles and grants without the permission", async () => {
    await scenario(async ({ admin, store, analyst, member, owner, read }) => {
      expect((await admin.authorize(member, "content.read")).kind).toBe(
        "NOT_FOUND",
      );
      expect((await admin.authorize(member, "content.write")).kind).toBe(
        "NOT_FOUND",
      );
      expect((await admin.authorize(analyst, "content.read")).kind).toBe(
        "NOT_FOUND",
      );
      // An owner without a live step-up cannot write.
      expect((await admin.authorize(owner, "content.write")).kind).toBe(
        "STEP_UP_REQUIRED",
      );
      const readOnly = await read();
      await expect(
        store.saveDraft(readOnly, "faq", {
          title: "x",
          summary: "",
          blocks: [],
          expectedRevision: 1,
        }),
      ).rejects.toBeInstanceOf(SiteContentGrantError);
      await expect(
        store.publish(readOnly, "faq", { expectedRevision: 1 }, () =>
          Promise.resolve(null),
        ),
      ).rejects.toBeInstanceOf(SiteContentGrantError);
    });
  });

  it("serves an image only while a live version shows it", async () => {
    await scenario(async ({ tx, store, write }) => {
      await seedSiteContent(inOne(tx), PAGES);
      const grant = await write();
      const documentId = randomUUID();
      const asset = {
        documentId,
        tenantId: randomUUID(),
        versionId: randomUUID(),
      };
      const draft = await store.pageDetail(grant, "faq");
      const saved = await store.saveDraft(grant, "faq", {
        title: "FAQ",
        summary: "",
        blocks: [
          { type: "image", id: "img", documentId, alt: "A chart", caption: "" },
        ],
        expectedRevision: draft?.draft.revision ?? 0,
      });
      if (saved.kind !== "SAVED") throw new Error(saved.kind);
      expect(await store.publicImage(documentId)).toBeNull();
      // An image that does not resolve to the admin's own scanned upload blocks publish.
      expect(
        await store.publish(
          grant,
          "faq",
          { expectedRevision: saved.revision },
          () => Promise.resolve(null),
        ),
      ).toEqual({ kind: "IMAGE_NOT_ALLOWED" });
      await store.publish(
        grant,
        "faq",
        { expectedRevision: saved.revision },
        () => Promise.resolve([asset]),
      );
      expect(await store.publicImage(documentId)).toEqual(asset);
      await store.unpublish(grant, "faq", "Taking it down");
      expect(await store.publicImage(documentId)).toBeNull();
      expect(await store.publicPage("faq")).toBeNull();
      void tx;
    });
  });
});
