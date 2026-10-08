import type { Page, WebSocketRoute } from "@playwright/test";

/**
 * The standard voice line with no Deepgram: Playwright serves the agent
 * socket (wss://agent.deepgram.com/v1/agent/converse, agent-socket.ts:26).
 *
 * It behaves as the Voice Agent does at the points our code depends on:
 * Welcome → (browser) Settings → SettingsApplied; microphone frames are
 * counted; when the test says the person spoke, it announces the user turn,
 * then does what Deepgram does with it, calling the think endpoint the
 * Settings named (q-api's own, carrying the session's bearer) in OpenAI
 * chat-completions form, and relays Q's words back as ConversationText.
 * So the q-api voice turn handler, the turn reader and the Q answer path all
 * run; only speech recognition and synthesis are scripted.
 */
export type DeepgramFake = {
  readonly frames: () => number;
  readonly settings: () => Record<string, unknown> | null;
  readonly say: (text: string) => Promise<string>;
  readonly drop: (code?: number) => Promise<void>;
  readonly error: (description: string) => void;
};

type ThinkEndpoint = { url: string; headers?: Record<string, string> };

export async function installDeepgramFake(page: Page): Promise<DeepgramFake> {
  let socket: WebSocketRoute | null = null;
  let frames = 0;
  let settings: Record<string, unknown> | null = null;
  const history: Array<{ role: string; content: string }> = [];

  await page.routeWebSocket(/agent\.deepgram\.com/u, (ws) => {
    socket = ws;
    ws.send(JSON.stringify({ type: "Welcome", request_id: "fake-agent" }));
    ws.onMessage((message) => {
      if (typeof message !== "string") {
        frames += 1;
        return;
      }
      let parsed: { type?: string } & Record<string, unknown>;
      try {
        parsed = JSON.parse(message) as typeof parsed;
      } catch {
        return;
      }
      if (parsed.type === "Settings") {
        settings = parsed;
        ws.send(JSON.stringify({ type: "SettingsApplied" }));
      }
    });
  });

  const think = (): ThinkEndpoint | null => {
    const agent = (settings?.["agent"] ?? {}) as Record<string, unknown>;
    const block = (agent["think"] ?? {}) as Record<string, unknown>;
    const endpoint = block["endpoint"] as ThinkEndpoint | undefined;
    return endpoint ?? null;
  };

  return {
    frames: () => frames,
    settings: () => settings,
    say: async (text: string) => {
      const ws = socket;
      const endpoint = think();
      if (ws === null || endpoint === null) throw new Error("the line is not up");
      ws.send(JSON.stringify({ type: "UserStartedSpeaking" }));
      ws.send(JSON.stringify({ type: "ConversationText", role: "user", content: text }));
      ws.send(JSON.stringify({ type: "AgentThinking", content: "" }));
      history.push({ role: "user", content: text });
      const response = await fetch(endpoint.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...(endpoint.headers ?? {}) },
        body: JSON.stringify({ model: "capital-q", stream: true, messages: history }),
      });
      const raw = await response.text();
      let reply = "";
      for (const line of raw.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") break;
        try {
          const chunk = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          reply += chunk.choices?.[0]?.delta?.content ?? "";
        } catch {
          // A keep-alive comment or a partial line: ignored as Deepgram does.
        }
      }
      history.push({ role: "assistant", content: reply });
      if (reply.length > 0) {
        ws.send(JSON.stringify({ type: "AgentStartedSpeaking", total_latency: 0.1 }));
        ws.send(JSON.stringify({ type: "ConversationText", role: "assistant", content: reply }));
      }
      ws.send(JSON.stringify({ type: "AgentAudioDone" }));
      return reply;
    },
    drop: async (code = 1011) => {
      await socket?.close({ code, reason: "fake drop" });
    },
    error: (description: string) => {
      socket?.send(JSON.stringify({ type: "Error", description, code: "FAKE" }));
    },
  };
}
