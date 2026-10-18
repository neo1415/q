import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

import { Q_VISIBLE_STAGES, type QStreamEvent } from "@capital-q/contracts";
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
import {
  createVoiceTurnHandler,
  SPOKEN_SILENCE_LADDER,
} from "../src/voice/turn.js";

/**
 * No spoken fillers (founder live test 2026-09-27, failure 10; R38).
 *
 * The property: nothing reaches the voice unless it is part of an answer.
 * A run that is slow, passes through every visible stage and searches the
 * public web is heard as its answer and nothing else. The stage is shown
 * on screen; it is never said.
 *
 * The scan beside it is a regression guard over the voice modules' string
 * literals (comments may quote what was removed): the wait lines the
 * founder heard, and any export that would bring a filler back by name.
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
    voiceSessionId: "vs-no-filler",
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

describe("nothing is spoken unless it is part of the answer", () => {
  it("a slow run through every stage, public web included, is heard as its answer alone", async () => {
    // Every clock read is two seconds later: any "quiet window" a filler
    // could wait behind has long passed by the time a stage arrives.
    const started = Date.now();
    let offset = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => {
      offset += 2_000;
      return started + offset;
    });
    try {
      const answer = [
        "Zino Aviation is registered in the UK.",
        "Its company number is 13100002.",
      ];
      const handle = createVoiceTurnHandler({
        qRuntime: runtime(),
        qStream: stream([
          ...Q_VISIBLE_STAGES.map((stage) =>
            event("q.stage.changed", { stage }),
          ),
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
      });
      const voice = speaker();
      await handle(
        binding(),
        [{ role: "user", content: "What do the public sources say about us?" }],
        new AbortController().signal,
        voice,
      );
      expect(voice.spoken.filter((line) => line.length > 0)).toEqual(answer);
    } finally {
      clock.mockRestore();
    }
  });
});

/** A stream whose events arrive `gapMs` apart on the (fake) clock. */
function slowStream(
  events: readonly QStreamEvent[],
  gapMs: number,
): QRunStreamService {
  return {
    ...stream([]),
    open: async function* (input) {
      for (const item of events) {
        await new Promise((resolve) => setTimeout(resolve, gapMs));
        if (input.signal.aborted) return;
        yield { kind: "durable" as const, event: item };
      }
      yield { kind: "end" as const, reason: "TERMINAL" as const };
    },
  };
}

describe("no sound at all while Q works (founder 2026-10-09)", () => {
  it("the silence ladder is off on every line", () => {
    expect(SPOKEN_SILENCE_LADDER).toBe(false);
  });

  it("a run that takes over half a minute says nothing until its answer: no stage line, no tone, no hum", async () => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "Date",
      ],
    });
    try {
      const answer = "Halyard Security leads on fit.";
      const handle = createVoiceTurnHandler({
        qRuntime: runtime(),
        qStream: slowStream(
          [
            ...Q_VISIBLE_STAGES.map((stage) =>
              event("q.stage.changed", { stage }),
            ),
            event("q.message.delta", { messageId: "m1", text: answer }),
            event("q.message.completed", {
              message: {
                messageId: "m1",
                runId: RUN_ID,
                role: "Q",
                text: answer,
                createdAt: NOW,
              },
            }),
            event("q.run.completed", { status: "COMPLETED", completedAt: NOW }),
          ],
          2_000,
        ),
        logger,
      });
      const voice = speaker();
      const turn = handle(
        binding(),
        [{ role: "user", content: "Who leads my pipeline on fit?" }],
        new AbortController().signal,
        voice,
      );
      // Every stage, each two seconds apart: well past any ladder rung.
      await vi.advanceTimersByTimeAsync((Q_VISIBLE_STAGES.length + 4) * 2_000);
      await turn;
      expect(voice.spoken.filter((line) => line.length > 0)).toEqual([answer]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a question back is asked as it is: no rising 'Hm?' before it", async () => {
    // The beat was random on half the turns; pin the draw that said it.
    const draw = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const handle = createVoiceTurnHandler({
        qRuntime: runtime(),
        qStream: stream([
          event("q.input.required", {
            clarification: { question: "Which fund do you mean" },
          }),
          event("q.run.completed", { status: "COMPLETED", completedAt: NOW }),
        ]),
        logger,
      });
      const voice = speaker();
      await handle(
        binding(),
        [{ role: "user", content: "How is the fund doing?" }],
        new AbortController().signal,
        voice,
      );
      const said = voice.spoken.filter((line) => line.length > 0);
      expect(said.join(" ")).toContain("Which fund do you mean");
      expect(said.join(" ")).not.toMatch(/\bhm+\b/iu);
    } finally {
      draw.mockRestore();
    }
  });
});

const VOICE_DIR = join(import.meta.dirname, "../src/voice");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith(".ts") ? [path] : [];
  });
}

/** Every string a module can say: literals and template pieces, not comments. */
function literals(path: string): string[] {
  const file = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      found.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/**
 * What the founder heard Q say while it worked, and its siblings: each a
 * whole line on its own, which is what makes it a filler rather than part
 * of an answer (a failure line may well ask for "a moment").
 */
const HEARD_WAIT_LINES = [
  /^\s*one (second|moment)\.?\s*$/i,
  /^\s*checking the public web on that\.?\s*$/i,
  /^\s*let me (check|look)( that| at public sources)?\.?\s*$/i,
  /^\s*hold on, checking\.?\s*$/i,
  /^\s*give me a moment( on that| to look that up)?\.?\s*$/i,
  /^\s*still working on (that|it)\.?\s*$/i,
  /^\s*I'm (going through|checking what|looking at|comparing|pulling)[^.]*\.\s*$/i,
];

describe("the voice modules carry no filler", () => {
  const files = sourceFiles(VOICE_DIR);

  it("scans the voice modules", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("says none of the wait lines the founder heard", () => {
    const offending = files.flatMap((path) =>
      literals(path)
        .filter((text) => HEARD_WAIT_LINES.some((line) => line.test(text)))
        .map((text) => `${path}: ${text}`),
    );
    expect(offending).toEqual([]);
  });

  it("exports nothing that would bring a filler or progress line back", () => {
    const offending = files.filter((path) =>
      /export\s+(const|function|async function)\s+\w*(filler|progress|narrat)/i.test(
        readFileSync(path, "utf8"),
      ),
    );
    expect(offending).toEqual([]);
  });
});
