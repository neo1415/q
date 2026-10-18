import { z } from "zod";

import {
  ME_PATH,
  ME_PROFILE_PATH,
  PersonProfileDtoSchema,
  UpdateMeRequestSchema,
  UpdatePersonProfileRequestSchema,
} from "@capital-q/contracts";
import {
  ActorContextDeniedError,
  UserIdSchema,
  type PersonProfile,
} from "@capital-q/security";

import {
  definePersonAction,
  portMissing,
  type AnyPersonAction,
  type PersonActionContext,
} from "../define.js";
import type { AppActionPorts } from "../ports.js";

/**
 * The person's own profile on the screen (BIZ-002): what to call them and
 * their headline. Person-scoped (ADR 0040): served to someone who may have
 * no organisation yet, under the onboarding actor. Q changes the same
 * record through update_my_profile (`person.profile.update`, the same
 * store); these are the profile page's two routes.
 */

const people = (ports: AppActionPorts) => ports.people ?? portMissing("people");

/** Their own active profile; none (suspended, closed) is not theirs to edit. */
async function ownProfile(
  ports: AppActionPorts,
  context: PersonActionContext,
): Promise<PersonProfile> {
  const profile = await people(ports).read(
    UserIdSchema.parse(context.person.userId),
  );
  if (profile === null) throw new ActorContextDeniedError();
  return profile;
}

const toDto = (profile: PersonProfile) =>
  PersonProfileDtoSchema.parse({
    userId: profile.userId,
    displayName: profile.displayName,
    headline: profile.headline,
    version: profile.version,
    updatedAt: profile.updatedAt,
  });

const Name = z.object({ input: UpdateMeRequestSchema }).strict();

/** `PATCH /v1/me`: no version, the latest request wins (older callers). */
const NAME = definePersonAction<z.infer<typeof Name>, PersonProfile>({
  name: "person.name.set",
  short: "change what to call me",
  area: "records",
  classification: "CONSEQUENTIAL",
  does: "Changes what Capital Q calls them, as the account menu does.",
  input: Name,
  output: z.custom<PersonProfile>(),
  run: async (ports, context, input) => {
    const profile = await ownProfile(ports, context);
    return people(ports).update({
      userId: profile.userId,
      expectedVersion: profile.version,
      changes: { displayName: input.input.displayName },
    });
  },
  http: {
    method: "PATCH",
    path: ME_PATH,
    fromRequest: (_params, body) => ({ input: body }),
    status: 204,
    respond: () => undefined,
  },
  legacyTool: "update_my_profile",
});

const Profile = z.object({ input: UpdatePersonProfileRequestSchema }).strict();

/**
 * `PATCH /v1/me/profile`: optimistic and idempotent; a stale version is a
 * conflict, and a replay of a change that already landed answers with the
 * profile as it stands (the store's rule, shared with Q's approved action).
 */
const PROFILE = definePersonAction<z.infer<typeof Profile>, PersonProfile>({
  name: "person.profile.edit",
  short: "edit my name or headline",
  area: "records",
  classification: "CONSEQUENTIAL",
  does: "Changes their name or headline on their profile page.",
  input: Profile,
  output: z.custom<PersonProfile>(),
  run: async (ports, context, input) => {
    const profile = await ownProfile(ports, context);
    return people(ports).update({
      userId: profile.userId,
      expectedVersion: input.input.expectedVersion,
      changes: {
        ...(input.input.displayName === undefined
          ? {}
          : { displayName: input.input.displayName }),
        ...(input.input.headline === undefined
          ? {}
          : { headline: input.input.headline }),
      },
    });
  },
  http: {
    method: "PATCH",
    path: ME_PROFILE_PATH,
    fromRequest: (_params, body) => ({ input: body }),
    respond: toDto,
  },
  legacyTool: "update_my_profile",
});

export const ME_ACTIONS: readonly AnyPersonAction[] = [NAME, PROFILE];
