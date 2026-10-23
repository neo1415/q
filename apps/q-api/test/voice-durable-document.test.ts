import { describe, expect, it } from "vitest";

import type { QStreamEvent } from "@capital-q/contracts";
import { createLogger } from "@capital-q/observability";
import type {
  QRunRecord,
  QRunStreamService,
  QRuntimeService,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import type { VoiceSessionBinding } from "../src/voice/bindings.js";
import type { VoiceSpeaker } from "../src/voice/provider.js";
import {
  createVoiceTurnHandler,
  DURABLE_HANDOFF_LINE,
} from "../src/voice/turn.js";

/**
 * Owner 2026-10-23: "When Q offered to create a one-pager, it showed it
 * pulling it together, but it kept DROPPING it." A spoken turn that makes
 * a document is durable work: the person carrying on talking stops the
 * line following it, never the work. It finishes and lands on the screen.
 */

const TENANT = "f0000000-0000-4000-8000-000000000001";
const USER = "f0000000-0000-4000-8000-000000000002";
const CONVERSATION_ID = "f0000000-0000-4000-8000-000000000021";
const NOW = "2026-10-23T09:00:00.000Z";
const RUN_IDS = [
  "f0000000-0000-4000-8000-000000000031",
  "f0000000-0000-4000-8000-000000000032",
  "f0000000-0000-4000-8000-000000000033",
] as const;
const DOCUMENT_RUN = RUN_IDS[0];

const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);
const actor = ActorContextSchema.parse({
  tenantId: TENANT,
  userId: USER,
  actorType: "HUMAN",
});

function binding(): VoiceSessionBinding {
  return {
    voiceSessionId: "vs-durable",
    providerConversationId: "conv_d",
    actor,
    accessToken: "bearer",
    voice: "FEMALE",
    thread: {
      conversationId: undefined,
      subjects: undefined,
      onboarding: undefined,
    },
    issuedAt: 0,
    connectBy: 1,
    connectedAt: 0,
  } as unknown as VoiceSessionBinding;
}

function speaker(): VoiceSpeaker & { readonly spoken: string[] } {
  const self = {
    providerConversationId: "conv_d",
    isOpen: true,
    spoken: [] as string[],
    speak: async (response: string | AsyncIterable<string>) => {
      if (typeof response === "string") {
        self.spoken.push(response);
        return;
      }
      const parts: string[] = [];
      for await (const chunk of response) parts.push(chunk);
      if (parts.length > 0) self.spoken.push(parts.join(" ").trim());
    },
    close: () => undefined,
  };
  return self;
}

const event = (
  runId: string,
  type: string,
  data: Record<string, unknown>,
): QStreamEvent =>
  ({
    type,
    runId,
    sequence: 1,
    occurredAt: NOW,
    data,
  }) as unknown as QStreamEvent;

describe("a document Q starts on a voice line is durable work", () => {
  it("is handed off, not cancelled, when the person goes on talking, and lands on the screen", async () => {
    let released: () => void = () => undefined;
    const documentDone = new Promise<void>((resolve) => {
      released = resolve;
    });
    let created = 0;
    const cancelled: string[] = [];
    const runtime = {
      createRun: () => {
        const id = RUN_IDS[created] ?? RUN_IDS[2];
        created += 1;
        return Promise.resolve({
          run: { id, conversationId: CONVERSATION_ID, status: "RECEIVED" },
          conversation: {},
          message: {},
          created: true,
        });
      },
      cancelRun: (command: { readonly runId: string }) => {
        cancelled.push(command.runId);
        return Promise.resolve({ run: {}, changed: true, summary: {} });
      },
    } as unknown as QRuntimeService;
    const stream: QRunStreamService = {
      authorize: (_actor, runId) =>
        Promise.resolve({
          id: runId,
          conversationId: CONVERSATION_ID,
        } as unknown as QRunRecord),
      open: async function* (input) {
        const runId = input.run.id;
        if (runId === DOCUMENT_RUN) {
          yield {
            kind: "durable" as const,
            event: event(runId, "q.stage.changed", {
              stage: "PREPARING_DOCUMENT",
            }),
          };
          // Still being made while the person carries on.
          await Promise.race([
            documentDone,
            new Promise<void>((resolve) => {
              input.signal.addEventListener("abort", () => resolve(), {
                once: true,
              });
            }),
          ]);
          if (input.signal.aborted) return;
          yield {
            kind: "durable" as const,
            event: event(runId, "q.stage.changed", {
              stage: "DESIGNING_DOCUMENT",
            }),
          };
          yield {
            kind: "durable" as const,
            event: event(runId, "q.message.completed", {
              message: {
                messageId: "m-doc",
                text: "Here is your one-pager.",
                blocks: [],
              },
            }),
          };
          yield {
            kind: "durable" as const,
            event: event(runId, "q.run.completed", {
              status: "COMPLETED",
              completedAt: NOW,
            }),
          };
          yield { kind: "end" as const, reason: "TERMINAL" as const };
          return;
        }
        yield {
          kind: "durable" as const,
          event: event(runId, "q.message.delta", {
            messageId: `m-${runId}`,
            text: "Seed rounds are usually smaller.",
          }),
        };
        yield {
          kind: "durable" as const,
          event: event(runId, "q.run.completed", {
            status: "COMPLETED",
            completedAt: NOW,
          }),
        };
        yield { kind: "end" as const, reason: "TERMINAL" as const };
      },
      stats: () => ({
        noticeSubscribers: 0,
        deltaSubscribers: 0,
        deltasDropped: 0,
      }),
    };
    const published: { runId: string; text: string | undefined }[] = [];
    const stages: { runId: string; stage: string }[] = [];
    const handle = createVoiceTurnHandler({
      qRuntime: runtime,
      qStream: stream,
      logger,
      room: {
        publish: (_actor, input) => {
          published.push({
            runId: input.runId,
            text: (input.message as { text?: string }).text,
          });
        },
        stage: (_actor, input) => {
          stages.push({ runId: input.runId, stage: input.stage });
        },
      },
    });
    const line = binding();
    const voice = speaker();
    const history = [
      { role: "user" as const, content: "Make me a one-pager on Northwind." },
    ];

    // The document turn: said once, and the line is free at once.
    const first = await handle(
      line,
      history,
      new AbortController().signal,
      voice,
    );
    expect(first).toEqual({ kind: "SPOKEN", path: "Q" });
    expect(voice.spoken.join(" ")).toContain(DURABLE_HANDOFF_LINE);

    // Two more turns while the one-pager is still being made.
    for (const said of ["What are seed rounds?", "And Series A?"]) {
      history.push({ role: "user", content: said });
      const next = await handle(
        line,
        [...history],
        new AbortController().signal,
        voice,
      );
      expect(next.kind).toBe("SPOKEN");
    }
    // Neither turn cancelled the document's run.
    expect(cancelled).not.toContain(DOCUMENT_RUN);

    // It finishes, and lands on their screen with its true stages.
    released();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(published).toContainEqual({
      runId: DOCUMENT_RUN,
      text: "Here is your one-pager.",
    });
    expect(stages).toContainEqual({
      runId: DOCUMENT_RUN,
      stage: "DESIGNING_DOCUMENT",
    });
    expect(cancelled).not.toContain(DOCUMENT_RUN);
  });

  it("a barge-in before anything was said still never cancels a document", async () => {
    const cancelled: string[] = [];
    const runtime = {
      createRun: () =>
        Promise.resolve({
          run: {
            id: DOCUMENT_RUN,
            conversationId: CONVERSATION_ID,
            status: "RECEIVED",
          },
          conversation: {},
          message: {},
          created: true,
        }),
      cancelRun: (command: { readonly runId: string }) => {
        cancelled.push(command.runId);
        return Promise.resolve({ run: {}, changed: true, summary: {} });
      },
    } as unknown as QRuntimeService;
    const cut = new AbortController();
    const stream: QRunStreamService = {
      authorize: () =>
        Promise.resolve({
          id: DOCUMENT_RUN,
          conversationId: CONVERSATION_ID,
        } as unknown as QRunRecord),
      open: async function* (input) {
        yield {
          kind: "durable" as const,
          event: event(DOCUMENT_RUN, "q.stage.changed", {
            stage: "REVISING_DOCUMENT",
          }),
        };
        cut.abort();
        await Promise.resolve();
        if (input.signal.aborted) return;
        yield { kind: "end" as const, reason: "TERMINAL" as const };
      },
      stats: () => ({
        noticeSubscribers: 0,
        deltaSubscribers: 0,
        deltasDropped: 0,
      }),
    };
    const handle = createVoiceTurnHandler({
      qRuntime: runtime,
      qStream: stream,
      logger,
    });
    await handle(
      binding(),
      [{ role: "user", content: "Change the title of my one-pager." }],
      cut.signal,
      speaker(),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(cancelled).toHaveLength(0);
  });
});
