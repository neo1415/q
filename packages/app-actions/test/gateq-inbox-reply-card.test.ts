import { describe, expect, it } from "vitest";

import { CorrelationIdSchema } from "@capital-q/contracts";
import { ActorContextSchema } from "@capital-q/security";

import {
  APP_ACTIONS,
  type AppActionPorts,
  type GateqInboxPort,
  type GateqOutboundPreview,
} from "../src/index.js";

/**
 * GateQ outbound: Q prepares an email to an applicant (who may not be on
 * Capital Q) as a card. The canonical payload, which the approval binds to,
 * carries the recipient, the subject and the exact words; a changed word is
 * a different payload and so a new approval. Nothing here sends: the port
 * is a fake and only `toCanonical` and `card` run.
 */

const actor = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  organisationId: "d0000000-0000-4000-8000-000000000001",
  membershipId: "e0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});
const context = {
  actor,
  idempotencyKey: "q:run-1:step",
  correlationId: CorrelationIdSchema.parse(
    "cor_00000000-0000-4000-8000-000000000001",
  ),
  surface: "Q" as const,
};
const GATEWAY = "a0000000-0000-4000-8000-000000000001";
const APPLICATION = "f0000000-0000-4000-8000-000000000001";

const preview = (
  overrides: Partial<GateqOutboundPreview> = {},
): GateqOutboundPreview => ({
  ok: true,
  companyName: "Kazikit (fictional)",
  fund: "Kilima Angel Network (fictional)",
  to: "founder@kazikit.example",
  toName: "Asha Mwangi",
  subject: "Kilima Angel Network (fictional) replied about Kazikit (fictional)",
  replyTo: null,
  deliverable: true,
  ...overrides,
});

function portsWith(
  found: GateqOutboundPreview | { readonly ok: false } | undefined,
): { ports: AppActionPorts; sends: unknown[] } {
  const sends: unknown[] = [];
  const inbox = {
    ownGatewayId: () => Promise.resolve(GATEWAY),
    findApplication: () =>
      Promise.resolve({
        applicationId: APPLICATION,
        companyName: "Kazikit (fictional)",
      }),
    reply: (...args: unknown[]) => {
      sends.push(args);
      return Promise.resolve({ ok: true, changed: 1, deduplicated: false });
    },
    ...(found === undefined
      ? {}
      : { outboundPreview: () => Promise.resolve(found) }),
  } as unknown as GateqInboxPort;
  return { ports: { gateqInbox: inbox }, sends };
}

const action = APP_ACTIONS.find((a) => a.name === "gateq.inbox.reply");
const tool = action?.tool;

describe("Q prepares an email to a GateQ applicant: the card binds recipient, subject and words", () => {
  it("is consequential: a card, never a send", () => {
    expect(action?.classification).toBe("CONSEQUENTIAL");
    expect(tool?.name).toBe("gateq_inbox_reply");
  });

  it("puts the recipient, subject and exact words in the payload and on the card, and sends nothing", async () => {
    if (action === undefined || tool === undefined) throw new Error("no tool");
    const { ports, sends } = portsWith(preview());
    const canonical = await tool.toCanonical(
      tool.input.parse({
        company: "Kazikit",
        message: "Could you share a few times for a call next week?",
      }),
      context,
      ports,
    );
    expect(canonical).toEqual({
      gatewayId: GATEWAY,
      applicationId: APPLICATION,
      organisationId: actor.organisationId,
      input: {
        message: "Could you share a few times for a call next week?",
        clientRequestId: "q:q:run-1:step",
        to: "founder@kazikit.example",
        subject:
          "Kilima Angel Network (fictional) replied about Kazikit (fictional)",
      },
    });
    const card = action.card(canonical);
    expect(card.preview).toBe(
      "To: founder@kazikit.example\nSubject: Kilima Angel Network (fictional) replied about Kazikit (fictional)\n\nCould you share a few times for a call next week?",
    );
    expect(sends).toHaveLength(0);
  });

  it("an edited message is a different payload, so it needs its own approval", async () => {
    if (tool === undefined) throw new Error("no tool");
    const { ports } = portsWith(preview());
    const first = await tool.toCanonical(
      tool.input.parse({ company: "Kazikit", message: "Thanks for applying." }),
      context,
      ports,
    );
    const edited = await tool.toCanonical(
      tool.input.parse({
        company: "Kazikit",
        message: "Thanks for applying. We'd like a call.",
      }),
      context,
      ports,
    );
    expect(edited).not.toEqual(first);
  });

  it("keeps a subject the investor asked for", async () => {
    if (tool === undefined) throw new Error("no tool");
    const { ports } = portsWith(preview());
    const canonical = await tool.toCanonical(
      tool.input.parse({
        company: "Kazikit",
        message: "Hello",
        subject: "Your Kilima application",
      }),
      context,
      ports,
    );
    expect(canonical).toMatchObject({
      input: { subject: "Your Kilima application" },
    });
  });

  it("refuses plainly when it cannot be sent: not theirs to decide, no address, no email service", async () => {
    if (tool === undefined) throw new Error("no tool");
    const said = tool.input.parse({ company: "Kazikit", message: "Hello" });
    expect(
      await tool.toCanonical(said, context, portsWith({ ok: false }).ports),
    ).toEqual({ refused: "Only an admin of your firm can reply." });
    expect(
      await tool.toCanonical(
        said,
        context,
        portsWith(preview({ to: null, deliverable: false })).ports,
      ),
    ).toEqual({
      refused:
        "Kazikit (fictional)'s application has no contact email, so there's no one to email.",
    });
    expect(
      await tool.toCanonical(
        said,
        context,
        portsWith(preview({ deliverable: false })).ports,
      ),
    ).toEqual({
      refused:
        "Email to applicants isn't connected here, so nothing can be sent yet.",
    });
    expect(
      await tool.toCanonical(said, context, portsWith(undefined).ports),
    ).toEqual({
      refused:
        "Open the application in your GateQ inbox to reply; I can draft the words.",
    });
  });

  it("answers a refused send with its reason, never a bare 404", () => {
    if (action?.http?.problem === undefined) throw new Error("no problem map");
    expect(
      action.http.problem({ ok: false, reason: "RECIPIENT_CHANGED" }),
    ).toMatchObject({ code: "RESOURCE_CONFLICT" });
    expect(
      action.http.problem({ ok: false, reason: "KEY_REUSED" }),
    ).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(
      action.http.problem({ ok: false, reason: "RATE_LIMITED" }),
    ).toMatchObject({ code: "RATE_LIMITED" });
    expect(action.http.problem({ ok: false })).toBeNull();
    expect(action.http.notFound?.({ ok: false })).toBe(true);
    expect(action.http.notFound?.({ ok: false, reason: "RATE_LIMITED" })).toBe(
      false,
    );
  });
});
