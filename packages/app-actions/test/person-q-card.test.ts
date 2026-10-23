import { describe, expect, it } from "vitest";

import { CorrelationIdSchema } from "@capital-q/contracts";
import { PersonQCardNotYoursError } from "@capital-q/public-identity";
import {
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@capital-q/security";

import {
  APP_ACTIONS,
  type AppActionContext,
  type AppActionPorts,
} from "../src/index.js";

/**
 * A person's own Q Card through the card page's routes (owner 2026-10-23:
 * every user has their own card). The subject is always the signed-in
 * person's own id; another person's id is refused (403) before the
 * service is asked; Q's organisation tools can never name a PERSON card.
 */

const ME = UserIdSchema.parse("00000000-0000-4000-8000-00000000d002");
const SOMEONE_ELSE = "00000000-0000-4000-8000-00000000d009";

const context: AppActionContext = {
  actor: {
    userId: ME,
    tenantId: TenantIdSchema.parse("00000000-0000-4000-8000-0000000000a3"),
    organisationId: OrganisationIdSchema.parse(
      "00000000-0000-4000-8000-0000000000a4",
    ),
    membershipId: MembershipIdSchema.parse(
      "00000000-0000-4000-8000-0000000000e2",
    ),
    actorType: "HUMAN",
  },
  idempotencyKey: "k",
  correlationId: CorrelationIdSchema.parse(
    "cor_00000000-0000-4000-8000-00000000c0de",
  ),
  surface: "SCREEN",
};

const action = (name: string) => {
  const found = APP_ACTIONS.find((a) => a.name === name);
  if (found === undefined) throw new Error(`no ${name}`);
  return found;
};

/** A card service that records what it was asked. */
function cards() {
  const calls: { method: string; subject: unknown }[] = [];
  const record =
    (method: string) =>
    (input: { readonly subject: unknown }): Promise<unknown> => {
      calls.push({ method, subject: input.subject });
      return Promise.resolve({ handle: "me", version: 1 });
    };
  const ports = {
    publicIdentity: {
      claimHandle: record("claimHandle"),
      updateCard: record("updateCard"),
      getCard: record("getCard"),
    },
  } as unknown as AppActionPorts;
  return { ports, calls };
}

const claim = action("q_card.handle.claim");
const update = action("q_card.update");

const input = (subjectId: string, rest: Record<string, unknown>) =>
  claim.input.parse({
    subject: { subjectType: "PERSON", subjectId },
    ...rest,
  });

describe("a person's own Q Card", () => {
  it("claims a handle for the signed-in person, with the session's id as the subject", async () => {
    const { ports, calls } = cards();
    await claim.run(
      ports,
      context,
      input(ME, { input: { handle: "daniel-oyeniyi" } }),
    );
    expect(calls).toEqual([
      {
        method: "claimHandle",
        subject: { subjectType: "PERSON", subjectId: ME },
      },
    ]);
  });

  it("refuses another person's id with 403, and never asks the service", async () => {
    const { ports, calls } = cards();
    await expect(
      claim.run(
        ports,
        context,
        input(SOMEONE_ELSE, { input: { handle: "not-mine" } }),
      ),
    ).rejects.toBeInstanceOf(PersonQCardNotYoursError);
    await expect(
      update.run(
        ports,
        context,
        update.input.parse({
          subject: { subjectType: "PERSON", subjectId: SOMEONE_ELSE },
          input: { indexable: true, expectedVersion: 1 },
        }),
      ),
    ).rejects.toBeInstanceOf(PersonQCardNotYoursError);
    expect(calls).toEqual([]);
  });

  it("changes the person's own card under the session's id", async () => {
    const { ports, calls } = cards();
    await update.run(
      ports,
      context,
      update.input.parse({
        subject: { subjectType: "PERSON", subjectId: ME },
        input: { indexable: false, expectedVersion: 1 },
        atLatest: true,
      }),
    );
    expect(calls.map((c) => c.subject)).toEqual([
      { subjectType: "PERSON", subjectId: ME },
      { subjectType: "PERSON", subjectId: ME },
    ]);
  });

  it("an organisation action can never name a PERSON card", () => {
    for (const a of [claim, update]) {
      const tool = a.tool;
      expect(tool).toBeDefined();
      const parsed = tool?.input.safeParse({
        subject: "PERSON",
        handle: "x-handle",
        indexable: true,
      });
      expect(parsed?.success, a.name).toBe(false);
    }
  });
});
