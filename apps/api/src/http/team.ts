import type { FastifyInstance } from "fastify";

import {
  INVITATION_PREVIEW_PATH,
  INVITATION_TOKEN_HEADER,
  InvitationPreviewDtoSchema,
  InvitationTokenSchema,
  MY_ORGANISATIONS_PATH,
  MyOrganisationsDtoSchema,
  TEAM_PATH,
  TeamDtoSchema,
} from "@capital-q/contracts";
import type { TeamService } from "@capital-q/organisations";

import {
  getActorContext,
  requireActorContextHook,
} from "../security/actor-context.js";
import {
  getOnboardingActor,
  requireOnboardingActorHook,
  type OnboardingActorDependencies,
} from "../security/onboarding-actor.js";

/**
 * G1/G2: the team's reads. Every change is a declared app action
 * (`team.*`, generated in app-actions.ts); these are the pages' reads.
 *
 * - GET /v1/team: the caller's ACTIVE organisation as a team, resolved on
 *   the server. Another organisation is never named by the client.
 * - GET /v1/me/organisations: the switcher's list, for a person who may be
 *   mid-onboarding (no context yet), so it runs under the onboarding actor.
 * - GET /v1/invitations/preview: what an invitation link invites to, for
 *   whoever holds the link (signed in or not: a new user sees it before
 *   creating their account). The token travels in a header so it never
 *   lands in a URL the API logs; an unknown or malformed token is the one
 *   404, never a hint about which part was wrong.
 */
export type TeamRoutesDependencies = OnboardingActorDependencies & {
  readonly team: Pick<
    TeamService,
    "team" | "myOrganisations" | "previewInvitation"
  >;
};

export function registerTeamRoutes(
  app: FastifyInstance,
  dependencies: TeamRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const withPerson = requireOnboardingActorHook(dependencies);
  const { team } = dependencies;

  app.get(TEAM_PATH, { onRequest: withContext }, async (request, reply) => {
    const out = await team.team(getActorContext(request));
    if (!out.ok) {
      reply.callNotFound();
      return undefined;
    }
    void reply.header("Cache-Control", "no-store");
    return TeamDtoSchema.parse(out.value);
  });

  app.get(
    MY_ORGANISATIONS_PATH,
    { onRequest: withPerson },
    async (request, reply) => {
      const mine = await team.myOrganisations(
        getOnboardingActor(request).userId,
      );
      void reply.header("Cache-Control", "no-store");
      return MyOrganisationsDtoSchema.parse(mine);
    },
  );

  app.get(INVITATION_PREVIEW_PATH, async (request, reply) => {
    const raw = request.headers[INVITATION_TOKEN_HEADER];
    const token = InvitationTokenSchema.safeParse(
      typeof raw === "string" ? raw : undefined,
    );
    const out = token.success
      ? await team.previewInvitation(token.data)
      : null;
    if (out === null || !out.ok) {
      reply.callNotFound();
      return undefined;
    }
    void reply.header("Cache-Control", "no-store");
    return InvitationPreviewDtoSchema.parse(out.value);
  });
}
