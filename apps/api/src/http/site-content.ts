import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  ADMIN_SITE_PAGE_DRAFT_PATH,
  ADMIN_SITE_PAGE_PATH,
  ADMIN_SITE_PAGE_PUBLISH_PATH,
  ADMIN_SITE_PAGE_RESTORE_PATH,
  ADMIN_SITE_PAGE_UNPUBLISH_PATH,
  ADMIN_SITE_PAGE_VERSION_PATH,
  ADMIN_SITE_PAGES_PATH,
  ADMIN_SITE_SETTINGS_PATH,
  AdminSitePageDetailDtoSchema,
  AdminSitePageListDtoSchema,
  AdminSiteVersionDtoSchema,
  createProblemDetails,
  parseSiteBlocks,
  PROBLEM_CONTENT_TYPE,
  PublicSiteImageDtoSchema,
  PublicSiteLandingDtoSchema,
  PublicSitePageDtoSchema,
  PublishSitePageRequestSchema,
  PublishSitePageResultDtoSchema,
  RestoreSiteVersionRequestSchema,
  SaveSiteDraftRequestSchema,
  SaveSiteDraftResultDtoSchema,
  SITE_IMAGE_PATH,
  SITE_LANDING_PATH,
  SITE_PAGE_PATH,
  SiteChangedDtoSchema,
  SiteSlugSchema,
  UnpublishSitePageRequestSchema,
  UpdateSiteSettingsRequestSchema,
  UuidSchema,
  type KnownErrorCode,
} from "@capital-q/contracts";
import type {
  AdminGrant,
  AdminPermission,
  PlatformAdmin,
  SiteContentStore,
  SiteImageAsset,
} from "@capital-q/platform-admin";
import type { ActorContext } from "@capital-q/security";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * The site content editor (decision 107).
 *
 * Public reads carry no credential and answer only from published
 * versions: lawyer notes stripped and placeholders resolved by the store.
 * An unknown, unpublished or malformed slug is the same 404.
 *
 * Console routes follow the rest of the console (ADR 0033): the role comes
 * from identity.platform_admins via `authorize`, someone without the
 * permission gets the 404 of a path that does not exist, a write needs a
 * live step-up, and every publish, unpublish, restore and settings change
 * is recorded in platform_ops.admin_actions. Nothing the client sends
 * decides access; block JSON arrives as unknown and is sanitised, then
 * validated, here.
 */

export type SiteContentRoutesDependencies = ActorContextDependencies & {
  readonly admin: Pick<PlatformAdmin, "authorize">;
  readonly content: SiteContentStore;
  /**
   * The admin's own upload, as the scanned image version a page may show,
   * or null (not theirs, not an image, not scanned clean). Absent: image
   * blocks cannot be published.
   */
  readonly ownImage?:
    | ((
        actor: ActorContext,
        documentId: string,
      ) => Promise<SiteImageAsset | null>)
    | undefined;
  /** A one-minute link to an image a live page shows. Absent: no images served. */
  readonly imageLink?:
    | ((
        asset: SiteImageAsset,
      ) => Promise<{ readonly url: string; readonly expiresAt: string } | null>)
    | undefined;
};

function send(
  request: FastifyRequest,
  reply: FastifyReply,
  code: KnownErrorCode,
  detail: string,
) {
  const problem = createProblemDetails({ code, requestId: request.id, detail });
  return reply
    .status(problem.status)
    .type(PROBLEM_CONTENT_TYPE)
    .header("Cache-Control", "no-store")
    .send(problem);
}

function slugOf(request: FastifyRequest): string | null {
  const parsed = SiteSlugSchema.safeParse(
    (request.params as Record<string, unknown>)["slug"],
  );
  return parsed.success ? parsed.data : null;
}

export function registerSiteContentRoutes(
  app: FastifyInstance,
  dependencies: SiteContentRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const { admin, content } = dependencies;
  const notFound = (request: FastifyRequest, reply: FastifyReply) =>
    send(request, reply, "RESOURCE_NOT_FOUND", "Not found.");
  const stale = (request: FastifyRequest, reply: FastifyReply) =>
    send(
      request,
      reply,
      "VERSION_CONFLICT",
      "This page changed in another window. Reload to see the latest draft.",
    );

  async function guard(
    request: FastifyRequest,
    reply: FastifyReply,
    permission: AdminPermission,
  ): Promise<AdminGrant | null> {
    const access = await admin.authorize(
      getActorContext(request).userId,
      permission,
    );
    if (access.kind === "GRANTED") {
      void reply.header("Cache-Control", "no-store");
      return access.grant;
    }
    if (access.kind === "STEP_UP_REQUIRED") {
      await send(
        request,
        reply,
        "STEP_UP_REQUIRED",
        "Confirm your password to continue.",
      );
      return null;
    }
    await notFound(request, reply);
    return null;
  }

  async function body<T>(
    request: FastifyRequest,
    reply: FastifyReply,
    schema: {
      readonly safeParse: (
        value: unknown,
      ) => { success: true; data: T } | { success: false };
    },
  ): Promise<T | null> {
    const parsed = schema.safeParse(request.body ?? {});
    if (parsed.success) return parsed.data;
    await send(
      request,
      reply,
      "VALIDATION_FAILED",
      "Check the page and try again.",
    );
    return null;
  }

  // --- public ---------------------------------------------------------------

  app.get(SITE_PAGE_PATH, async (request, reply) => {
    const slug = slugOf(request);
    const page = slug === null ? null : await content.publicPage(slug);
    if (page === null) return notFound(request, reply);
    void reply.header("Cache-Control", "public, max-age=60");
    return PublicSitePageDtoSchema.parse(page);
  });

  app.get(SITE_LANDING_PATH, async (_request, reply) => {
    void reply.header("Cache-Control", "public, max-age=60");
    return PublicSiteLandingDtoSchema.parse(await content.publicLanding());
  });

  app.get(SITE_IMAGE_PATH, async (request, reply) => {
    const id = UuidSchema.safeParse(
      (request.params as Record<string, unknown>)["documentId"],
    );
    if (!id.success || dependencies.imageLink === undefined) {
      return notFound(request, reply);
    }
    const asset = await content.publicImage(id.data);
    const link =
      asset === null
        ? null
        : await dependencies.imageLink(asset).catch(() => null);
    if (link === null) return notFound(request, reply);
    // A signed link expires in a minute: no shared cache may keep it.
    void reply.header("Cache-Control", "no-store");
    return PublicSiteImageDtoSchema.parse(link);
  });

  // --- console --------------------------------------------------------------

  app.get(
    ADMIN_SITE_PAGES_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "content.read");
      if (grant === null) return reply;
      return AdminSitePageListDtoSchema.parse(await content.listPages(grant));
    },
  );

  app.get(
    ADMIN_SITE_PAGE_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "content.read");
      if (grant === null) return reply;
      const slug = slugOf(request);
      const detail =
        slug === null ? null : await content.pageDetail(grant, slug);
      if (detail === null) return notFound(request, reply);
      return AdminSitePageDetailDtoSchema.parse(detail);
    },
  );

  app.get(
    ADMIN_SITE_PAGE_VERSION_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "content.read");
      if (grant === null) return reply;
      const slug = slugOf(request);
      const number = Number(
        (request.params as Record<string, unknown>)["versionNumber"],
      );
      if (slug === null || !Number.isInteger(number) || number < 1) {
        return notFound(request, reply);
      }
      const version = await content.version(grant, slug, number);
      if (version === null) return notFound(request, reply);
      return AdminSiteVersionDtoSchema.parse(version);
    },
  );

  app.put(
    ADMIN_SITE_PAGE_DRAFT_PATH,
    { onRequest: withContext, bodyLimit: 2 * 1024 * 1024 },
    async (request, reply) => {
      const grant = await guard(request, reply, "content.write");
      if (grant === null) return reply;
      const slug = slugOf(request);
      if (slug === null) return notFound(request, reply);
      const input = await body(request, reply, SaveSiteDraftRequestSchema);
      if (input === null) return reply;
      let blocks;
      try {
        blocks = parseSiteBlocks(input.blocks);
      } catch {
        return send(
          request,
          reply,
          "VALIDATION_FAILED",
          "One of the blocks isn't valid. Check links use a site path, #anchor, https or mailto, and prices are numbers.",
        );
      }
      const saved = await content.saveDraft(grant, slug, {
        title: input.title,
        summary: input.summary,
        blocks,
        expectedRevision: input.expectedRevision,
      });
      if (saved.kind === "NOT_FOUND") return notFound(request, reply);
      if (saved.kind === "STALE") return stale(request, reply);
      return SaveSiteDraftResultDtoSchema.parse({
        revision: saved.revision,
        updatedAt: saved.updatedAt,
      });
    },
  );

  app.post(
    ADMIN_SITE_PAGE_PUBLISH_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "content.write");
      if (grant === null) return reply;
      const slug = slugOf(request);
      if (slug === null) return notFound(request, reply);
      const input = await body(request, reply, PublishSitePageRequestSchema);
      if (input === null) return reply;
      const actor = getActorContext(request);
      const ownImage = dependencies.ownImage;
      const outcome = await content.publish(grant, slug, input, async (ids) => {
        if (ownImage === undefined) return null;
        const assets: SiteImageAsset[] = [];
        for (const id of ids) {
          const asset = await ownImage(actor, id).catch(() => null);
          if (asset === null) return null;
          assets.push(asset);
        }
        return assets;
      });
      switch (outcome.kind) {
        case "NOT_FOUND":
          return notFound(request, reply);
        case "STALE":
          return stale(request, reply);
        case "NEEDS_LEGAL_CONFIRMATION":
          return send(
            request,
            reply,
            "RESOURCE_CONFLICT",
            "Confirm a lawyer has approved this text before it goes live.",
          );
        case "IMAGE_NOT_ALLOWED":
          return send(
            request,
            reply,
            "RESOURCE_CONFLICT",
            "An image isn't ready: use a PNG or JPEG you uploaded here, once its scan has finished clean.",
          );
        case "PUBLISHED":
          return PublishSitePageResultDtoSchema.parse({
            versionNumber: outcome.versionNumber,
            publishedAt: outcome.publishedAt,
          });
      }
    },
  );

  app.post(
    ADMIN_SITE_PAGE_UNPUBLISH_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "content.write");
      if (grant === null) return reply;
      const slug = slugOf(request);
      if (slug === null) return notFound(request, reply);
      const input = await body(request, reply, UnpublishSitePageRequestSchema);
      if (input === null) return reply;
      const outcome = await content.unpublish(grant, slug, input.reason);
      if (outcome === "NOT_FOUND") return notFound(request, reply);
      if (outcome === "NOT_LIVE") {
        return send(
          request,
          reply,
          "RESOURCE_CONFLICT",
          "This page isn't live.",
        );
      }
      return SiteChangedDtoSchema.parse({ ok: true });
    },
  );

  app.post(
    ADMIN_SITE_PAGE_RESTORE_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "content.write");
      if (grant === null) return reply;
      const slug = slugOf(request);
      if (slug === null) return notFound(request, reply);
      const input = await body(request, reply, RestoreSiteVersionRequestSchema);
      if (input === null) return reply;
      const outcome = await content.restore(grant, slug, input);
      if (outcome.kind === "NOT_FOUND") return notFound(request, reply);
      if (outcome.kind === "STALE") return stale(request, reply);
      return SiteChangedDtoSchema.parse({ ok: true });
    },
  );

  app.post(
    ADMIN_SITE_SETTINGS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, "content.write");
      if (grant === null) return reply;
      const input = await body(request, reply, UpdateSiteSettingsRequestSchema);
      if (input === null) return reply;
      const outcome = await content.updateSettings(grant, input);
      if (outcome === "STALE") return stale(request, reply);
      return SiteChangedDtoSchema.parse({ ok: true });
    },
  );
}
