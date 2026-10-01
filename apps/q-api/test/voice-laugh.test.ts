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
import { createSpeechPerformanceBoard } from "../src/voice/speech-performance.js";
import { createVoiceTurnHandler } from "../src/voice/turn.js";

/**
 * Q laughs when it writes a laugh (founder report 2026-10-01: "laugh" was
 * answered with a bare emoji and the voice never laughed). Asked to laugh,
 * Q writes it out ("Ha! ..."); the voice turn cues a LAUGH reaction on
 * that sentence before it is handed over, so a voice that can laugh
 * ([laughs] on eleven v3) does, rather than reading "Ha" aloud. Q's own
 * output only; a greeting is not a laugh.
 */

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

async function spoken(answer: readonly string[]) {
  const performance = createSpeechPerformanceBoard();
  const handle = createVoiceTurnHandler({
    qRuntime: runtime(),
    qStream: stream([
      ...answer.map((text) =>
        event("q.message.delta", { messageId: "m1", text }),
      ),
      event("q.message.completed", {
        message: {
          messageId: "m1",
          runId: RUN_ID,
          role: "Q",
          text: answer.join(" "),
          createdAt: NOW,
        },
      }),
      event("q.run.completed", { status: "COMPLETED", completedAt: NOW }),
    ]),
    logger,
    performance,
  });
  const voice = speaker();
  await handle(
    binding(),
    [{ role: "user", content: "Laugh for me" }],
    new AbortController().signal,
    voice,
  );
  return { performance, voice };
}

describe("Q laughs when it writes a laugh", () => {
  it.each(["Ha!", "Hahaha.", "Jajaja!", "Ha ha, alright, you got me."])(
    "cues a LAUGH reaction on %j, spoken as written",
    async (first) => {
      const { performance, voice } = await spoken([first, "What next?"]);
      expect(voice.spoken.join(" ")).toContain(first);
      expect(
        performance.take("vs-laugh", first).map((p) => p.reaction),
      ).toEqual(["LAUGH"]);
    },
  );

  it("does not take a greeting or an ordinary sentence for a laugh", async () => {
    for (const first of [
      "Hi! Good to see you.",
      "He. Said so.",
      "Happy to help.",
    ]) {
      const { performance } = await spoken([first]);
      expect(performance.take("vs-laugh", first)).toEqual([]);
    }
  });
});
