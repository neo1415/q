import type { FastifyInstance } from "fastify";
import {
  ME_PATH,
  ME_PROFILE_PATH,
  MeResponseSchema,
  PersonProfileDtoSchema,
  UpdateMeRequestSchema,
  UpdatePersonProfileRequestSchema,
  parseContract,
  type MeResponse,
  type PersonProfileDto,
} from "@capital-q/contracts";
import {
  ActorContextDeniedError,
  ActorContextRequiredError,
  ActorContextResolutionError,
  ORGANISATION_CONTEXT_HEADER,
  parseOrganisationSelector,
  resolveHumanActorContext,
  type ActorContextResolver,
  type AuthenticatedPrincipal,
  type PersonProfile,
  type PersonProfileStore,
} from "@capital-q/security";
import type { ApplicationIdentityLookup } from "@capital-q/security/postgres";

import type { RequestAuthenticator } from "../security/actor-context.js";
import {
  getPrincipal,
  requireAuthenticationHook,
} from "../security/authentication.js";

export type MeRouteDependencies = {
  readonly authenticator: RequestAuthenticator;
  readonly resolver: ActorContextResolver;
  readonly identities: ApplicationIdentityLookup;
  /**
   * The person's own editable profile (BIZ-002): the same store Q's
   * approved `person.profile.update` executes through, so the page and Q
   * share one write path. Absent: the profile routes are not served and
   * `PATCH /v1/me` refuses.
   */
  readonly people?: PersonProfileStore | undefined;
};

function toPersonProfileDto(profile: PersonProfile): PersonProfileDto {
  return PersonProfileDtoSchema.parse({
    userId: profile.userId,
    displayName: profile.displayName,
    headline: profile.headline,
    version: profile.version,
    updatedAt: profile.updatedAt,
  });
}

/**
 * `GET /v1/me` -- the one place a client learns who the server thinks is
 * signed in and which organisation context, if any, it resolved.
 *
 * Authentication and context are answered separately on purpose:
 *
 *   no valid session            -> 401 (the hook)
 *   session, no Person record   -> 403, indistinguishable from "no access"
 *   Person, no context          -> 200 with CONTEXT_REQUIRED
 *   Person, selector refused    -> 403, indistinguishable from "does not exist"
 *   Person, context             -> 200 with the resolved ids
 *
 * A brand-new founder with no membership gets a 200. That is the state the
 * onboarding entry is built for, and turning it into an error would make
 * authentication look like a membership check.
 */
export function registerMeRoute(
  app: FastifyInstance,
  dependencies: MeRouteDependencies,
): void {
  const authenticated = requireAuthenticationHook({
    authenticator: dependencies.authenticator,
  });
  const people = dependencies.people;

  /**
   * The acting person's own profile. The user id comes from the verified
   * session and nowhere else; an absent, suspended or closed profile is
   * one answer, the same as "no access".
   */
  const ownProfile = async (
    principal: AuthenticatedPrincipal,
  ): Promise<{
    readonly store: PersonProfileStore;
    profile: PersonProfile;
  }> => {
    const identity = await dependencies.identities.lookup(principal);
    const profile =
      identity === null || people === undefined
        ? null
        : await people.read(identity.userId);
    if (profile === null || people === undefined) {
      throw new ActorContextDeniedError();
    }
    return { store: people, profile };
  };

  // `PATCH /v1/me` — what to call the person, as it always was: no
  // version, the latest request wins. Kept for the callers that predate
  // the profile route; it writes through the same store.
  app.patch(ME_PATH, { onRequest: authenticated }, async (request, reply) => {
    const parsed = UpdateMeRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        type: "about:blank",
        title: "Bad Request",
        status: 400,
        detail: "A display name between 1 and 80 characters is required.",
      });
    }
    const { store, profile } = await ownProfile(getPrincipal(request));
    await store.update({
      userId: profile.userId,
      expectedVersion: profile.version,
      changes: { displayName: parsed.data.displayName },
    });
    return reply.code(204).send();
  });

  if (people !== undefined) {
    app.get(
      ME_PROFILE_PATH,
      { onRequest: authenticated },
      async (request, reply) => {
        const { profile } = await ownProfile(getPrincipal(request));
        void reply.header("Cache-Control", "no-store");
        return toPersonProfileDto(profile);
      },
    );

    // Optimistic and idempotent: a stale version is VERSION_CONFLICT, and
    // a replay of a change that already landed answers with the profile as
    // it stands (the store's rule, shared with Q's approved action).
    app.patch(
      ME_PROFILE_PATH,
      { onRequest: authenticated },
      async (request, reply) => {
        const input = parseContract(
          UpdatePersonProfileRequestSchema,
          request.body,
          "The profile update is not valid.",
        );
        const { store, profile } = await ownProfile(getPrincipal(request));
        const updated = await store.update({
          userId: profile.userId,
          expectedVersion: input.expectedVersion,
          changes: {
            ...(input.displayName === undefined
              ? {}
              : { displayName: input.displayName }),
            ...(input.headline === undefined
              ? {}
              : { headline: input.headline }),
          },
        });
        void reply.header("Cache-Control", "no-store");
        return toPersonProfileDto(updated);
      },
    );
  }

  app.get(
    ME_PATH,
    { onRequest: authenticated },
    async (request, reply): Promise<MeResponse> => {
      const principal = getPrincipal(request);

      const identity = await dependencies.identities.lookup(principal);

      if (identity === null) {
        // Whether the profile was never created, is suspended or is closed
        // is not something the caller is told.
        throw new ActorContextDeniedError();
      }

      const rawSelector = request.headers[ORGANISATION_CONTEXT_HEADER];
      const selector = parseOrganisationSelector(
        typeof rawSelector === "string" ? rawSelector : undefined,
      );

      if (!selector.ok) {
        throw new ActorContextRequiredError(
          "The requested organisation context identifier is not valid.",
        );
      }

      const resolution = await resolveHumanActorContext(dependencies.resolver, {
        principal,
        selection: selector.selection,
      });

      let context: MeResponse["context"];

      switch (resolution.status) {
        case "RESOLVED": {
          const resolved = resolution.context;
          if (
            resolved.tenantId === undefined ||
            resolved.organisationId === undefined ||
            resolved.membershipId === undefined
          ) {
            throw new ActorContextResolutionError();
          }
          context = {
            status: "RESOLVED",
            tenantId: resolved.tenantId,
            organisationId: resolved.organisationId,
            membershipId: resolved.membershipId,
          };
          break;
        }
        case "CONTEXT_REQUIRED":
          context = { status: "CONTEXT_REQUIRED" };
          break;
        case "NO_APPLICATION_IDENTITY":
        case "CONTEXT_NOT_ACCESSIBLE":
          throw new ActorContextDeniedError();
        case "INVALID_CONTEXT":
          throw new ActorContextResolutionError();
      }

      // Session-dependent: never shared-cacheable, never stored by a proxy.
      void reply.header("Cache-Control", "no-store");

      // Validated on the way out so the wire shape is the contract, not
      // whatever the resolver happened to return.
      return MeResponseSchema.parse({
        user: { id: identity.userId, displayName: identity.displayName },
        context,
      });
    },
  );
}
