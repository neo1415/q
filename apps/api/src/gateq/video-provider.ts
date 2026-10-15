import { TavusError, type TavusKeyPool } from "@capital-q/integrations";
import type { GateqVideoProvider } from "@capital-q/gateq-intake";

/**
 * The GateQ video interview's provider adapter (ADR 0066's Tavus client,
 * shared with Rehearsals). Tavus is the face, voice and turn-taking only:
 * its LLM layer points at our bridge, which answers with the canonical
 * GateQ interviewer's reply. The PAL prompt fixes conduct and disclosure,
 * never content. The client itself refuses any call longer than its paid
 * test-run cap (180 s) whatever the caller asks.
 */
export function createTavusGateqVideoProvider(deps: {
  readonly pool: TavusKeyPool;
  /** Absolute origin of this API, e.g. https://api.example. */
  readonly publicBaseUrl: string;
  /** A stock interviewer face (never a likeness of a real person). */
  readonly faceId: string;
  readonly keyCount: number;
}): GateqVideoProvider {
  return {
    createRoom: async (input) => {
      const { value } = await deps.pool.withHealthyKey(async (client) => {
        const { palId } = await client.createPal({
          name: `cq-gateq-${input.sessionId}`,
          systemPrompt:
            "You are the face and voice of Q, Capital Q's AI interviewer for an investment application. Speak exactly the lines you are given, naturally, and nothing else.",
          faceId: deps.faceId,
          disclosure: {
            spoken:
              "Just so you know, I'm Q, an AI interviewer. What you say is transcribed into your application.",
            shown:
              "Q is an AI interviewer. This video interview is transcribed into your application.",
          },
          layers: {
            llm: {
              model: "capital-q-gateq-interview",
              base_url: `${deps.publicBaseUrl}${input.bridge.path}`,
              api_key: input.bridge.bearer,
              // One request per finished utterance: each line is a real
              // canonical turn, never a speculative one.
              speculative_inference: false,
            },
            perception: { perception_model: "off" },
            conversational_flow: {
              turn_detection_model: "sparrow-2",
              turn_taking_patience: "medium",
            },
          },
        });
        try {
          return await client.createConversation({
            palId,
            faceId: deps.faceId,
            name: `cq-gateq-${input.sessionId}`,
            callbackUrl: null,
            greeting: input.greeting.slice(0, 600),
            context: null,
            maxCallSeconds: input.maxSeconds,
            testMode: input.testMode,
            requireAuth: true,
          });
        } catch (error) {
          // A PAL without a room is configuration, not spend; best effort.
          await client.deletePal(palId).catch(() => undefined);
          throw error;
        }
      });
      const joinUrl =
        value.conversationUrl === null || value.meetingToken === null
          ? null
          : (() => {
              const url = new URL(value.conversationUrl);
              // Only the provider's own private room host is ever embedded.
              if (
                url.protocol !== "https:" ||
                url.hostname !== "tavus.daily.co"
              )
                return null;
              url.searchParams.set("t", value.meetingToken);
              return url.toString();
            })();
      return { conversationId: value.conversationId, joinUrl };
    },
    endRoom: async (conversationId) => {
      // The room lives on one configured account; ending it on another
      // answers not-found, so try each until one confirms.
      let lastError: Error | null = null;
      for (let index = 0; index < deps.keyCount; index++) {
        const client = deps.pool.clientAt(index);
        if (client === null) continue;
        try {
          await client.endConversation(conversationId);
          return;
        } catch (error) {
          if (error instanceof TavusError && error.status === 404) {
            lastError = error;
            continue;
          }
          throw error;
        }
      }
      // Not found on every account: the room no longer exists (expired or
      // already ended), so there is nothing left to end or bill.
      void lastError;
    },
  };
}
