import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { QSubjectRef } from "@capital-q/contracts";
import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import { createCreateQRun } from "../src/application/create-run.js";
import type { QRuntimeDependencies } from "../src/application/dependencies.js";

/**
 * The actor's own context on every turn (CQ-QX-008): "a PDF describing my
 * company" from Home Q was asked "which company?", because a turn that named
 * nothing carried nothing. Property over what the turn names, what the
 * actor's organisation owns, and whether ownership verifies: their company
 * joins a turn about no company or relationship, their investor firm a turn
 * naming no investor or relationship, each only when it resolves as their
 * own organisation's, and nothing a client sent is ever dropped.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG = "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0";
const OTHER_ORG = "b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0";
const OWN_COMPANY = "c0000000-0000-4000-8000-0000000000aa";
const OWN_FIRM = "11111111-0000-4000-8000-0000000000bb";

const actor = ActorContextSchema.parse({
  userId: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  tenantId: TENANT,
  organisationId: ORG,
  membershipId: "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
  actorType: "HUMAN",
});

const ownCompany: QSubjectRef = { kind: "COMPANY", companyId: OWN_COMPANY };
const ownFirm: QSubjectRef = {
  kind: "INVESTOR_ORGANISATION",
  investorOrganisationId: OWN_FIRM,
};
const otherCompany: QSubjectRef = {
  kind: "COMPANY",
  companyId: "c0000000-0000-4000-8000-0000000000cc",
};
const otherFirm: QSubjectRef = {
  kind: "INVESTOR_ORGANISATION",
  investorOrganisationId: "11111111-0000-4000-8000-0000000000dd",
};
const relationship = {
  kind: "RELATIONSHIP",
  relationshipId: "22222222-0000-4000-8000-0000000000ee",
} as unknown as QSubjectRef;

function harness(options: {
  readonly company: string | null;
  readonly firm: string | null;
  readonly verified: boolean;
}) {
  const runs: { subjects: readonly QSubjectRef[] }[] = [];
  const isOwn = (ref: QSubjectRef) =>
    (ref.kind === "COMPANY" && ref.companyId === OWN_COMPANY) ||
    (ref.kind === "INVESTOR_ORGANISATION" &&
      ref.investorOrganisationId === OWN_FIRM);
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
          organisationId: isOwn(ref) && options.verified ? ORG : OTHER_ORG,
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
    ownCompany: () => Promise.resolve(options.company),
    ownInvestorOrganisation: () => Promise.resolve(options.firm),
  } as unknown as QRuntimeDependencies;
  const create = createCreateQRun(dependencies);
  const ask = (subjects: readonly QSubjectRef[]) =>
    create({
      actor,
      input: {
        capability: "ANSWER",
        message: { text: "give me a PDF describing my company" },
        modality: "TEXT",
        subjects: [...subjects],
      } as never,
      idempotencyKey: randomUUID(),
      correlationId: "cor_test",
    });
  return { ask, runs };
}

const TURNS: readonly (readonly QSubjectRef[])[] = [
  [],
  [otherCompany],
  [otherFirm],
  [relationship],
  [otherCompany, otherFirm],
];

describe("the actor's own context joins every turn that does not name it otherwise", () => {
  it("follows the rule for every turn, organisation and verification", async () => {
    for (const turn of TURNS) {
      for (const company of [OWN_COMPANY, null]) {
        for (const firm of [OWN_FIRM, null]) {
          for (const verified of [true, false]) {
            const h = harness({ company, firm, verified });
            await h.ask(turn);
            const got = h.runs[0]?.subjects ?? [];
            const names = (kind: string) => turn.some((r) => r.kind === kind);
            const expected = [
              ...turn,
              ...(company !== null &&
              verified &&
              !names("COMPANY") &&
              !names("RELATIONSHIP")
                ? [ownCompany]
                : []),
              ...(firm !== null &&
              verified &&
              !names("INVESTOR_ORGANISATION") &&
              !names("RELATIONSHIP")
                ? [ownFirm]
                : []),
            ];
            expect(
              got,
              JSON.stringify({ turn, company, firm, verified }),
            ).toEqual(expected);
          }
        }
      }
    }
  });

  it("a founder's 'my company' turn carries their company", async () => {
    const h = harness({ company: OWN_COMPANY, firm: null, verified: true });
    await h.ask([]);
    expect(h.runs[0]?.subjects).toEqual([ownCompany]);
  });
});
