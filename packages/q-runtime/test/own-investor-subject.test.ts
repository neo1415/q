import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { QSubjectRef } from "@capital-q/contracts";
import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import { createCreateQRun } from "../src/application/create-run.js";
import type { QRuntimeDependencies } from "../src/application/dependencies.js";

/**
 * An investor asking about a company carries their own firm as context
 * (CQ-QX-007): added on the server from their membership, verified as
 * theirs, never taken from the request, and never added where the turn is
 * about something else.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG = "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0";
const OTHER_ORG = "b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0";
const COMPANY = "c0000000-0000-4000-8000-000000000001";
const OWN_INVESTOR = "11111111-0000-4000-8000-000000000013";

const investor = ActorContextSchema.parse({
  userId: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  tenantId: TENANT,
  organisationId: ORG,
  membershipId: "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
  actorType: "HUMAN",
});

function harness(options: {
  readonly own: string | null;
  /** Who the resolver says owns the investor organisation. */
  readonly investorOwner?: string;
  readonly withLookup?: boolean;
}) {
  const runs: { subjects: readonly QSubjectRef[] }[] = [];
  const lookups: ActorContext[] = [];
  const dependencies = {
    sql: {} as never,
    transactions: {
      run: (work: (tx: unknown) => unknown) => work({ sql: {} }),
    },
    subjects: {
      supports: () => true,
      resolve: (_actor: ActorContext, ref: QSubjectRef) =>
        Promise.resolve({
          ref,
          tenantId: TENANT,
          organisationId:
            ref.kind === "INVESTOR_ORGANISATION"
              ? (options.investorOwner ?? ORG)
              : OTHER_ORG,
        }),
    },
    repositories: {
      runCreationRequests: {
        lock: () => Promise.resolve(),
        find: () => Promise.resolve(null),
        record: () => Promise.resolve(),
      },
      conversations: {
        insert: (_tx: unknown, input: { subjects: readonly QSubjectRef[] }) =>
          Promise.resolve({ id: randomUUID(), ...input }),
        setSubjects: () => Promise.resolve(),
      },
      runs: {
        insert: (
          _tx: unknown,
          input: { subjects: readonly QSubjectRef[]; capability: string },
        ) => {
          runs.push(input);
          return Promise.resolve({
            id: randomUUID(),
            tenantId: TENANT,
            status: "RECEIVED",
            ...input,
          });
        },
        allocateEventSequence: () => Promise.resolve(1),
      },
      messages: {
        insert: (_tx: unknown, input: unknown) =>
          Promise.resolve({ id: randomUUID(), ...(input as object) }),
      },
      runEvents: {
        append: (_tx: unknown, input: unknown) => Promise.resolve(input),
      },
    },
    ...(options.withLookup === false
      ? {}
      : {
          ownInvestorOrganisation: (actor: ActorContext) => {
            lookups.push(actor);
            return Promise.resolve(options.own);
          },
        }),
  } as unknown as QRuntimeDependencies;
  const create = createCreateQRun(dependencies);
  const ask = (subjects: readonly QSubjectRef[]) =>
    create({
      actor: investor,
      input: {
        capability: "ANSWER",
        message: { text: "is this one worth my time given what I invest in?" },
        modality: "TEXT",
        subjects: [...subjects],
      } as never,
      idempotencyKey: randomUUID(),
      correlationId: "cor_test",
    });
  return { ask, runs, lookups };
}

const company: QSubjectRef = { kind: "COMPANY", companyId: COMPANY };
const ownFirm: QSubjectRef = {
  kind: "INVESTOR_ORGANISATION",
  investorOrganisationId: OWN_INVESTOR,
};

describe("an investor's own firm rides along with a company question", () => {
  it("is added server-side when the actor's organisation is an investor", async () => {
    const h = harness({ own: OWN_INVESTOR });
    await h.ask([company]);
    expect(h.runs[0]?.subjects).toEqual([company, ownFirm]);
    expect(h.lookups).toHaveLength(1);
  });

  it("is not added for a founder, whose organisation is no investor", async () => {
    const h = harness({ own: null });
    await h.ask([company]);
    expect(h.runs[0]?.subjects).toEqual([company]);
  });

  it("is not added unless it resolves as belonging to the actor's own organisation", async () => {
    const h = harness({ own: OWN_INVESTOR, investorOwner: OTHER_ORG });
    await h.ask([company]);
    expect(h.runs[0]?.subjects).toEqual([company]);
  });

  it("widens nothing when the turn already names an investor; a turn about no company carries their firm too (CQ-QX-008)", async () => {
    const other: QSubjectRef = {
      kind: "INVESTOR_ORGANISATION",
      investorOrganisationId: randomUUID(),
    };
    const h = harness({ own: OWN_INVESTOR });
    await h.ask([company, other]);
    await h.ask([]);
    expect(h.runs[0]?.subjects).toEqual([company, other]);
    expect(h.runs[1]?.subjects).toEqual([ownFirm]);
    expect(h.lookups).toHaveLength(1);
  });

  it("does nothing in a composition without the lookup", async () => {
    const h = harness({ own: OWN_INVESTOR, withLookup: false });
    await h.ask([company]);
    expect(h.runs[0]?.subjects).toEqual([company]);
  });
});
