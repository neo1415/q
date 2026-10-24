import { describe, expect, it, vi } from "vitest";

import { createLogger } from "@capital-q/observability";
import type { QRunStreamService, QRuntimeService } from "@capital-q/q-runtime";
import {
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import type { VoiceSessionBinding } from "../src/voice/bindings.js";
import type { VoiceSpeaker } from "../src/voice/provider.js";
import { createVoiceTurnBoard } from "../src/voice/turn-board.js";
import { createVoiceTurnHandler, STORY_LINE } from "../src/voice/turn.js";

/**
 * F-61 (live 2026-10-23, maji-loop on the think endpoint): "Hey Q, pitch
 * yourself" said on a line whose words reach only the server was answered
 * by Q with a self-introduction. The server now takes the story ask by
 * code, with no Q run: one short line, and the screen opens Q Pitch.
 */

const ACTOR: ActorContext = {
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000001"),
  tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001"),
  organisationId: OrganisationIdSchema.parse(
    "d0000000-0000-4000-8000-000000000001",
  ),
  membershipId: MembershipIdSchema.parse(
    "e0000000-0000-4000-8000-000000000001",
  ),
  actorType: "HUMAN",
};

const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);

function binding(): VoiceSessionBinding {
  return {
    voiceSessionId: "5f000000-0000-4000-8000-000000000009",
    providerConversationId: "dg_5f000000-0000-4000-8000-000000000009",
    actor: ACTOR,
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

function speakerSaying(said: string[]): VoiceSpeaker {
  return {
    providerConversationId: "dg_1",
    isOpen: true,
    speak: async (response) => {
      const chunks = typeof response === "string" ? [response] : response;
      for await (const chunk of chunks) said.push(chunk.trim());
    },
    close: () => undefined,
  };
}

describe("a spoken story ask on the server (F-61)", () => {
  it.each([
    "Hey Q, pitch yourself.",
    "Hey, Q. Pitch yourself.",
    "hey queue pitch yourself",
  ])(
    "'%s' opens Q Pitch with one short line and starts no Q run",
    async (words) => {
      const createRun = vi.fn();
      const board = createVoiceTurnBoard();
      const said: string[] = [];
      const handle = createVoiceTurnHandler({
        qRuntime: {
          createRun,
          cancelRun: vi.fn(),
        } as unknown as QRuntimeService,
        qStream: {} as unknown as QRunStreamService,
        board,
        logger,
      });
      const outcome = await handle(
        binding(),
        [{ role: "user", content: words }],
        new AbortController().signal,
        speakerSaying(said),
      );
      expect(outcome).toEqual({ kind: "SPOKEN", path: "MOVE" });
      expect(said.join(" ")).toBe(STORY_LINE);
      expect(board.read(binding().voiceSessionId).navigate).toBe("Q_PITCH");
      expect(createRun).not.toHaveBeenCalled();
    },
  );
});
