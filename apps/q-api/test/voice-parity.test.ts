import { describe, expect, it } from "vitest";

import { type QStreamEvent } from "@capital-q/contracts";
import { createLogger } from "@capital-q/observability";
import type {
  QRunRecord,
  QRunStreamService,
  QRuntimeService,
} from "@capital-q/q-runtime";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import type { VoiceSessionBinding } from "../src/voice/bindings.js";
import type { VoiceSpeaker } from "../src/voice/provider.js";
import { createVoiceTurnHandler } from "../src/voice/turn.js";

const CONTEXT: ActorContext = {
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000001"),
  tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001"),
  organisationId: OrganisationIdSchema.parse(
    "d0000000-0000-4000-8000-000000000001",
  ),
  actorType: "HUMAN",
};
const RUN_ID = "f0000000-0000-4000-8000-000000000020";
const NOW = "2026-09-27T09:00:00.000Z";
const RUN = {
  id: RUN_ID,
  conversationId: "f0000000-0000-4000-8000-000000000021",
  status: "RECEIVED",
} as unknown as QRunRecord;

const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);

function binding(): VoiceSessionBinding {
  return {
    voiceSessionId: "vs-laugh",
    providerConversationId: "conv_1",
    actor: CONTEXT,
    accessToken: "eyPRIVATE.bearer",
    voice: "FEMALE",
    thread: {
      conversationId: undefined,
      subjects: undefined,
      onboarding: undefined,
    },
    issuedAt: 0,
    connectBy: 1,
    connectedAt: 0,
  };
}

function speaker(): VoiceSpeaker & { readonly spoken: string[] } {
  const self = {
    providerConversationId: "conv_1",
    isOpen: true,
    spoken: [] as string[],
    speak: async (response: string | AsyncIterable<string>) => {
      if (typeof response === "string") {
        self.spoken.push(response.trim());
        return;
      }
      for await (const part of response) self.spoken.push(part.trim());
    },
    close: () => undefined,
  };
  return self;
}

const event = (type: string, data: Record<string, unknown>): QStreamEvent =>
  ({
    type,
    runId: RUN_ID,
    sequence: 1,
    occurredAt: NOW,
    data,
  }) as unknown as QStreamEvent;

function runtime(): QRuntimeService {
  return {
    createRun: () =>
      Promise.resolve({
        run: RUN,
        conversation: {} as never,
        message: {} as never,
        created: true,
      }),
    cancelRun: () =>
      Promise.resolve({ run: RUN, changed: true, summary: {} as never }),
  } as unknown as QRuntimeService;
}

function stream(events: readonly QStreamEvent[]): QRunStreamService {
  return {
    authorize: () => Promise.resolve(RUN),
    open: async function* (input) {
      for (const item of events) {
        if (input.signal.aborted) return;
        yield { kind: "durable" as const, event: item };
        await Promise.resolve();
      }
      yield { kind: "end" as const, reason: "TERMINAL" as const };
    },
    stats: () => ({
      noticeSubscribers: 0,
      deltaSubscribers: 0,
      deltasDropped: 0,
    }),
  };
}

/**
 * Voice parity (lead 2026-10-03): a streamed answer's last sentence is
 * only in the completed message, and so are code's closing lines (the
 * could-not line, what was done, a status). A spoken answer says them
 * after the streamed sentences, never the streamed ones twice.
 */

async function heard(
  deltas: readonly string[],
  completed: string,
): Promise<string[]> {
  const handle = createVoiceTurnHandler({
    qRuntime: runtime(),
    qStream: stream([
      ...deltas.map((text) =>
        event("q.message.delta", { messageId: "m1", text: `${text} ` }),
      ),
      event("q.message.completed", {
        message: {
          messageId: "m1",
          runId: RUN_ID,
          role: "Q",
          text: completed,
          createdAt: NOW,
        },
      }),
      event("q.run.completed", { status: "COMPLETED", completedAt: NOW }),
    ]),
    logger,
  });
  const voice = speaker();
  await handle(
    binding(),
    [{ role: "user", content: "what should I do next" }],
    new AbortController().signal,
    voice,
  );
  return voice.spoken.filter((part) => part.length > 0);
}

describe("a spoken answer says what the stream did not carry", () => {
  it("the last sentence, once, after the streamed ones", async () => {
    const said = await heard(
      ["Paystack is a payments company.", "Stripe bought it in 2020."],
      "Paystack is a payments company. Stripe bought it in 2020. Want me to compare it with Flutterwave?",
    );
    expect(said.join(" ")).toBe(
      "Paystack is a payments company. Stripe bought it in 2020. Want me to compare it with Flutterwave?",
    );
  });

  it("code's lead lines (streamed first) and code's closing line (only in the message)", async () => {
    const said = await heard(
      [
        "Investors can't find your company in Discover yet. What to do next, most important first:",
        "1. Make the company visible to investors.",
        "Start there today.",
      ],
      "Investors can't find your company in Discover yet. What to do next, most important first:\n1. Make the company visible to investors.\n\nStart there today. I can do it now.\n\nNothing was prepared or changed yet.",
    );
    const text = said.join(" ");
    expect(text).toContain("Make the company visible to investors.");
    expect(text.split("Make the company visible").length - 1).toBe(1);
    expect(
      text.endsWith("I can do it now. Nothing was prepared or changed yet."),
    ).toBe(true);
  });
});
