import { describe, expect, it } from "vitest";

import type { TenantId, UserId } from "@capital-q/security";

import { createFounderExtraction } from "../src/intelligence/extraction.js";

/**
 * Whose documents these are (CQ-REC-008 entry gate 0C; doc 15 §62).
 *
 * The extraction seam names the kind of material it handles so the gateway
 * can route it. The property worth pinning is where that name comes from:
 * the composition root, which holds the server attestation, and nowhere
 * else. A founder cannot type it, a browser cannot send it, and the
 * request this seam accepts has no field for it.
 *
 * Sensitivity is not what changes. A founder's documents are CONFIDENTIAL
 * in every case below.
 */

const TENANT = "33333333-3333-4333-8333-333333333333" as TenantId;
const USER = "44444444-4444-4444-8444-444444444444" as UserId;

type Sent = {
  readonly taskClass: string;
  readonly sensitivity: string;
  readonly dataPosture?: string | undefined;
};

function recordingGateway() {
  const sent: Sent[] = [];
  return {
    sent,
    // The seam only needs the narrow slice; a failure is enough, because
    // what is asserted is the request that went out, not the answer.
    execute: (request: unknown) => {
      sent.push(request as Sent);
      return Promise.reject(
        Object.assign(new Error("no provider in this test"), {
          failureClass: "PROVIDER_OUTAGE",
        }),
      );
    },
  };
}

const requestFor = () => ({
  tenantId: TENANT,
  userId: USER,
  sources: [
    {
      documentId: "55555555-5555-4555-8555-555555555555",
      label: "deck.pdf",
      page: 1,
      text: "An invented company that makes industrial sensors.",
    },
  ],
  narrative: null,
  knownFacts: [],
  unansweredKeys: [],
  shape: null,
  stage: null,
  correlationId: "cor_00000000-0000-4000-8000-000000000001",
});

describe("founder extraction data posture", () => {
  it("A: declares SYNTHETIC_DEMO when the composition root attested it", async () => {
    const gateway = recordingGateway();
    const extraction = createFounderExtraction({
      gateway: gateway as never,
      budget: {},
      dataPosture: "SYNTHETIC_DEMO",
    });
    await extraction.extract(requestFor() as never);
    expect(gateway.sent).toHaveLength(1);
    expect(gateway.sent[0]?.dataPosture).toBe("SYNTHETIC_DEMO");
    // The founder's own documents are still confidential material.
    expect(gateway.sent[0]?.sensitivity).toBe("CONFIDENTIAL");
    expect(gateway.sent[0]?.taskClass).toBe("STRUCTURED_EXTRACTION");
  });

  it("B: declares REAL_CUSTOMER when the composition root says so", async () => {
    const gateway = recordingGateway();
    const extraction = createFounderExtraction({
      gateway: gateway as never,
      budget: {},
      dataPosture: "REAL_CUSTOMER",
    });
    await extraction.extract(requestFor() as never);
    expect(gateway.sent[0]?.dataPosture).toBe("REAL_CUSTOMER");
  });

  it("omitting it sends no posture at all, which the gateway reads as REAL_CUSTOMER", async () => {
    // The safe default is the absence of a claim, not a claim of safety.
    const gateway = recordingGateway();
    const extraction = createFounderExtraction({
      gateway: gateway as never,
      budget: {},
    });
    await extraction.extract(requestFor() as never);
    expect(gateway.sent[0]).not.toHaveProperty("dataPosture");
  });

  it("D: nothing in the extraction request can carry a posture", async () => {
    // A forged field on the caller's request must not reach the gateway.
    // `sources` is the only founder-controlled text here, and it is
    // content, never instruction.
    const gateway = recordingGateway();
    const extraction = createFounderExtraction({
      gateway: gateway as never,
      budget: {},
      dataPosture: "REAL_CUSTOMER",
    });
    await extraction.extract({
      ...requestFor(),
      dataPosture: "SYNTHETIC_DEMO",
      syntheticDemo: true,
    } as never);
    expect(gateway.sent[0]?.dataPosture).toBe("REAL_CUSTOMER");
  });
});

describe("founder extraction leniency (live 2026-10-01)", () => {
  it("asks the gateway to drop a list element that fails, never to refuse the reading", async () => {
    const options: unknown[] = [];
    const gateway = {
      execute: (_request: unknown, given: unknown) => {
        options.push(given);
        return Promise.reject(
          Object.assign(new Error("no provider in this test"), {
            failureClass: "PROVIDER_OUTAGE",
          }),
        );
      },
    };
    await createFounderExtraction({
      gateway: gateway as never,
      budget: {},
    }).extract(requestFor() as never);
    expect(options[0]).toMatchObject({ invalidListItems: "DROP" });
  });
});
