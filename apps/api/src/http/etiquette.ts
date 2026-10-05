import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  toMyEtiquetteDto,
  type EtiquetteGuidePort,
} from "@capital-q/app-actions";
import {
  ADMIN_ETIQUETTE_GUIDE_ACTIVE_PATH,
  ADMIN_ETIQUETTE_GUIDE_PATH,
  AdminEtiquetteGuideActiveRequestSchema,
  AdminEtiquetteGuideDtoSchema,
  AdminEtiquetteGuideRequestSchema,
  createProblemDetails,
  ME_ETIQUETTE_GUIDE_PATH,
  PROBLEM_CONTENT_TYPE,
  type AdminEtiquetteGuideDto,
  type KnownErrorCode,
} from "@capital-q/contracts";
import type {
  AdminGrant,
  AdminPermission,
  EtiquetteGuideAdminStore,
  PlatformAdmin,
} from "@capital-q/platform-admin";
import {
  BUILT_IN_ETIQUETTE_GUIDE,
  BUILT_IN_ETIQUETTE_TITLE,
  BUILT_IN_ETIQUETTE_VERSION,
} from "@capital-q/q-core";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * How Q conducts business (ADR 0050).
 *
 * A person reads their own guide (the save and remove routes are the app
 * actions `settings.etiquette_guide.*`, generated with their Q tools). The
 * platform's house guide is the operations console's: reading it needs
 * `flags.read`, recording or switching it `flags.write` with live step-up
 * (platform owner or operator), because it changes how Q speaks for
 * everyone at once -- the same rule as the brand colour. A non-admin gets
 * the 404 any unknown path gets; nothing the client sends decides access.
 */

export const ETIQUETTE_READ_PERMISSION: AdminPermission = "flags.read";
export const ETIQUETTE_WRITE_PERMISSION: AdminPermission = "flags.write";

export type EtiquetteRoutesDependencies = ActorContextDependencies & {
  readonly guides: EtiquetteGuidePort;
  /** Absent: the console's routes do not register. */
  readonly admin?:
    | {
        readonly platform: Pick<PlatformAdmin, "authorize">;
        readonly store: EtiquetteGuideAdminStore;
      }
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

/** The console's view, with the built-in guide beside the recorded ones. */
export async function adminEtiquetteDto(
  store: EtiquetteGuideAdminStore,
): Promise<AdminEtiquetteGuideDto> {
  const view = await store.view();
  return AdminEtiquetteGuideDtoSchema.parse({
    activeVersionId: view.active?.versionId ?? null,
    activeText: view.active?.text ?? BUILT_IN_ETIQUETTE_GUIDE,
    activeTitle: view.active?.title ?? BUILT_IN_ETIQUETTE_TITLE,
    updatedAt: view.updatedAt,
    builtIn: {
      version: BUILT_IN_ETIQUETTE_VERSION,
      title: BUILT_IN_ETIQUETTE_TITLE,
      text: BUILT_IN_ETIQUETTE_GUIDE,
    },
    versions: view.versions,
  });
}

export function registerEtiquetteRoutes(
  app: FastifyInstance,
  dependencies: EtiquetteRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const { guides } = dependencies;

  app.get(
    ME_ETIQUETTE_GUIDE_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const [guide, house] = await Promise.all([
        guides.read({ tenantId: actor.tenantId, userId: actor.userId }),
        guides.house(),
      ]);
      void reply.header("Cache-Control", "no-store");
      return toMyEtiquetteDto({ guide, house });
    },
  );

  if (dependencies.admin === undefined) return;
  const admin = dependencies.admin;

  async function guard(
    request: FastifyRequest,
    reply: FastifyReply,
    permission: AdminPermission,
  ): Promise<AdminGrant | null> {
    const access = await admin.platform.authorize(
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
    ADMIN_ETIQUETTE_GUIDE_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, ETIQUETTE_READ_PERMISSION);
      if (grant === null) return reply;
      return adminEtiquetteDto(admin.store);
    },
  );

  app.post(
    ADMIN_ETIQUETTE_GUIDE_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, ETIQUETTE_WRITE_PERMISSION);
      if (grant === null) return reply;
      const parsed = AdminEtiquetteGuideRequestSchema.safeParse(
        request.body ?? {},
      );
      if (!parsed.success) {
        return send(
          request,
          reply,
          "VALIDATION_FAILED",
          parsed.error.issues[0]?.message ??
            "Give the guide a title and its text.",
        );
      }
      await admin.store.record(grant, parsed.data);
      return adminEtiquetteDto(admin.store);
    },
  );

  app.post(
    ADMIN_ETIQUETTE_GUIDE_ACTIVE_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const grant = await guard(request, reply, ETIQUETTE_WRITE_PERMISSION);
      if (grant === null) return reply;
      const parsed = AdminEtiquetteGuideActiveRequestSchema.safeParse(
        request.body ?? {},
      );
      if (!parsed.success) {
        return send(
          request,
          reply,
          "VALIDATION_FAILED",
          "Choose a recorded version, or the built-in guide.",
        );
      }
      const done = await admin.store.activate(grant, parsed.data.versionId);
      if (!done) {
        return send(request, reply, "RESOURCE_NOT_FOUND", "Not found.");
      }
      return adminEtiquetteDto(admin.store);
    },
  );
}
