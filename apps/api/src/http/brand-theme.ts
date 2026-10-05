import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  ADMIN_BRAND_THEME_PATH,
  AdminBrandThemeRequestSchema,
  BRAND_THEME_PATH,
  BrandThemeDtoSchema,
  createProblemDetails,
  PROBLEM_CONTENT_TYPE,
  type KnownErrorCode,
} from "@capital-q/contracts";
import type {
  AdminGrant,
  AdminPermission,
  BrandThemeStore,
  PlatformAdmin,
} from "@capital-q/platform-admin";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * Brand theming (P5; K3 presets). Any signed-in person reads the preset and
 * colour in effect for their own tenant (how the app looks; nothing about anyone). Changing it
 * is a platform-console write: the platform admin service decides, with
 * the kill-switch permission (`flags.write`: platform owner or operator,
 * live step-up) because it changes the product for everyone at once. A
 * non-admin gets the same 404 as a path that does not exist; nothing the
 * client sends decides access.
 */

/** The console permission that may change the brand (see above). */
export const BRAND_WRITE_PERMISSION: AdminPermission = "flags.write";
export const BRAND_READ_PERMISSION: AdminPermission = "flags.read";

export type BrandThemeRoutesDependencies = ActorContextDependencies & {
  readonly admin: Pick<PlatformAdmin, "authorize">;
  readonly brand: BrandThemeStore;
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

export function registerBrandThemeRoutes(
  app: FastifyInstance,
  dependencies: BrandThemeRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const { admin, brand } = dependencies;

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
    await send(request, reply, "RESOURCE_NOT_FOUND", "Not found.");
    return null;
  }

  app.get(
    BRAND_THEME_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const { tenantId } = getActorContext(request);
      // Private: the colour can differ per tenant, so no shared cache keeps it.
      void reply.header("Cache-Control", "private, max-age=60");
      return BrandThemeDtoSchema.parse(await brand.effective(tenantId));
    },
  );

  app.get(
    ADMIN_BRAND_THEME_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, BRAND_READ_PERMISSION);
      if (grant === null) return reply;
      return BrandThemeDtoSchema.parse(await brand.platform());
    },
  );

  app.post(
    ADMIN_BRAND_THEME_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, BRAND_WRITE_PERMISSION);
      if (grant === null) return reply;
      const parsed = AdminBrandThemeRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return send(
          request,
          reply,
          "VALIDATION_FAILED",
          "Give a known preset and a colour as #rrggbb.",
        );
      }
      return BrandThemeDtoSchema.parse(
        await brand.setPlatform(grant, {
          presetKey: parsed.data.presetKey,
          primaryHex: parsed.data.primaryHex,
        }),
      );
    },
  );
}
