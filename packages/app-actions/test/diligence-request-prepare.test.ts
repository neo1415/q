import { describe, expect, it } from "vitest";

import { CorrelationIdSchema } from "@capital-q/contracts";
import { ActorContextSchema } from "@capital-q/security";

import {
  APP_ACTIONS,
  DILIGENCE_REQUEST_INVESTOR_ONLY,
  DILIGENCE_REQUEST_NO_RELATIONSHIP,
  DILIGENCE_REQUEST_NOT_OPEN,
  type AppActionPorts,
} from "../src/index.js";

/**
 * Owner addendum "resolving investor uncertainty" (14 Nov 2026), audit
 * slice 4: a document request the investor may not make is refused when Q
 * prepares it -- no approval card that would only be refused after the
 * person approved it. Slice 5: an authorised request carries what it was
 * asked to resolve onto the canonical input.
 */

const investor = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000002",
  tenantId: "c0000000-0000-4000-8000-000000000002",
  organisationId: "d0000000-0000-4000-8000-000000000002",
  membershipId: "e0000000-0000-4000-8000-000000000002",
  actorType: "HUMAN",
});
const context = {
  actor: investor,
  idempotencyKey: "q:run-7:diligence",
  correlationId: CorrelationIdSchema.parse(
    "cor_00000000-0000-4000-8000-000000000007",
  ),
  surface: "Q" as const,
};
const RELATIONSHIP = "88888888-0000-4000-8000-000000000007";

const tool = (() => {
  const found = APP_ACTIONS.find(
    (action) => action.tool?.name === "diligence_documents",
  )?.tool;
  if (found === undefined) throw new Error("no diligence_documents tool");
  return found;
})();
const questionsTool = (() => {
  const found = APP_ACTIONS.find(
    (action) => action.tool?.name === "send_questions_to_founder",
  )?.tool;
  if (found === undefined) throw new Error("no send_questions_to_founder");
  return found;
})();

type View = {
  readonly side: "INVESTOR" | "COMPANY";
  readonly open: boolean;
} | null;

function portsWith(view: View): {
  readonly ports: AppActionPorts;
  readonly views: string[];
} {
  const views: string[] = [];
  const ports = {
    diligence: {
      view: (query: { readonly relationshipId: string }) => {
        views.push(query.relationshipId);
        return Promise.resolve(
          view === null
            ? null
            : {
                relationshipId: RELATIONSHIP,
                side: view.side,
                open: view.open,
                shares: [],
                requests: [],
              },
        );
      },
      share: () => Promise.reject(new Error("not in this test")),
      revoke: () => Promise.reject(new Error("not in this test")),
      request: () => Promise.reject(new Error("never run at prepare time")),
      uploadAndFulfil: () => Promise.reject(new Error("not in this test")),
    },
  } as unknown as AppActionPorts;
  return { ports, views };
}

const ABOUT = {
  statement: "October 2026 MRR of USD 120,000 is the founder's figure only.",
  standing: "FOUNDER_CONFIRMED" as const,
};

describe("diligence_documents REQUEST at prepare time (slice 4)", () => {
  const said = tool.input.parse({
    relationship: RELATIONSHIP,
    operation: "REQUEST",
    title: "Bank statements for October 2026",
    resolves: ABOUT,
  });

  it("an investor in diligence gets the canonical request, carrying what it resolves", async () => {
    const { ports, views } = portsWith({ side: "INVESTOR", open: true });
    expect(await tool.toCanonical(said, context, ports)).toEqual({
      operation: "REQUEST",
      input: {
        relationshipId: RELATIONSHIP,
        idempotencyKey: context.idempotencyKey,
        input: { title: "Bank statements for October 2026", about: ABOUT },
      },
    });
    expect(views).toEqual([RELATIONSHIP]);
  });

  it("before diligence: refused before any card, saying what can go instead", async () => {
    const { ports } = portsWith({ side: "INVESTOR", open: false });
    expect(await tool.toCanonical(said, context, ports)).toEqual({
      refused: DILIGENCE_REQUEST_NOT_OPEN,
    });
  });

  it("the company's side never asks itself for documents", async () => {
    const { ports } = portsWith({ side: "COMPANY", open: true });
    expect(await tool.toCanonical(said, context, ports)).toEqual({
      refused: DILIGENCE_REQUEST_INVESTOR_ONLY,
    });
  });

  it("no relationship they are a party to: the step is express interest, and nothing is read about it", async () => {
    const { ports } = portsWith(null);
    expect(await tool.toCanonical(said, context, ports)).toEqual({
      refused: DILIGENCE_REQUEST_NO_RELATIONSHIP,
    });
  });

  it("a standing outside the closed list (a KYB check) is never accepted", () => {
    expect(
      tool.input.safeParse({
        relationship: RELATIONSHIP,
        operation: "REQUEST",
        title: "Bank statements",
        resolves: { statement: "MRR", standing: "KYB_VERIFIED" },
      }).success,
    ).toBe(false);
  });
});

describe("send_questions_to_founder carries what the questions resolve (slice 5)", () => {
  it("puts it on the canonical input; without it, nothing is added", async () => {
    const { ports } = portsWith({ side: "INVESTOR", open: false });
    const withAbout = questionsTool.input.parse({
      relationship: RELATIONSHIP,
      questions: ["What was October 2026 MRR, and what does it rest on?"],
      resolves: ABOUT,
    });
    expect(await questionsTool.toCanonical(withAbout, context, ports)).toEqual({
      relationshipId: RELATIONSHIP,
      idempotencyKey: context.idempotencyKey,
      input: {
        questions: ["What was October 2026 MRR, and what does it rest on?"],
        resolves: ABOUT,
      },
    });
    const plain = questionsTool.input.parse({
      relationship: RELATIONSHIP,
      questions: ["What was October 2026 MRR?"],
    });
    expect(await questionsTool.toCanonical(plain, context, ports)).toEqual({
      relationshipId: RELATIONSHIP,
      idempotencyKey: context.idempotencyKey,
      input: { questions: ["What was October 2026 MRR?"] },
    });
  });
});
