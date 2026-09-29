import { describe, expect, it } from "vitest";

import { withThinkingBeats } from "../src/voice/thinking-beats.js";

/**
 * Thinking sounds are timed, not triggered by words: a quick answer gets
 * none; a slow one gets a "hm", and a very slow one a hum, once each.
 */
async function* after(ms: number, parts: readonly string[]) {
  await new Promise((resolve) => setTimeout(resolve, ms));
  for (const part of parts) yield part;
}

async function collect(source: AsyncIterable<string>) {
  const out: string[] = [];
  for await (const part of source) out.push(part);
  return out;
}

const pick = (choices: readonly string[]) => choices[0] ?? "";

describe("thinking beats", () => {
  it("adds nothing to an answer that arrives quickly", async () => {
    expect(
      await collect(
        withThinkingBeats(after(5, ["Yes.", "It is."]), {
          hmAfterMs: 60,
          humAfterMs: 120,
          pick,
        }),
      ),
    ).toEqual(["Yes.", "It is."]);
  });

  it("says hm when the answer is slow, and hums once when it is slower still", async () => {
    expect(
      await collect(
        withThinkingBeats(after(90, ["Here it is."]), {
          hmAfterMs: 30,
          humAfterMs: 60,
          pick,
        }),
      ),
    ).toEqual(["Hmm.", "Mmm...", "Here it is."]);
    expect(
      await collect(
        withThinkingBeats(after(45, ["Here."]), {
          hmAfterMs: 30,
          humAfterMs: 200,
          pick,
        }),
      ),
    ).toEqual(["Hmm.", "Here."]);
  });
});
