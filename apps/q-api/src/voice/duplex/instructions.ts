import type { ModelToolDefinition } from "@capital-q/contracts";
import { Q_SYSTEM_VOICE_V1 } from "@capital-q/q-core";

/**
 * What the full-duplex model is told (DUPLEX).
 *
 * The same Q: the live-conversation charter every spoken turn already runs
 * under, then the duplex conduct. The model is Q's voice and ears, not its
 * analyst: everything substantive goes to ask_q, which is the same spoken
 * turn the standard line takes (Context Firewall, Tool Registry with
 * authorize, approvals on screen), and what comes back is said, not
 * embellished. The stable part comes first so the provider's prefix cache
 * holds; the per-line part (the opening line, the language) comes last.
 */

export const ASK_Q_TOOL_NAME = "ask_q" as const;

export const ASK_Q_TOOL: ModelToolDefinition = {
  name: ASK_Q_TOOL_NAME,
  description:
    "Bring what the person said to Q's analysis and records and get back what to say. Use it for anything about their company, investors, relationships, documents, records, numbers, the app, or any change or action, and to pass on their yes or no when Q asked whether to go ahead. Returns the words to say.",
  inputJsonSchema: {
    type: "object",
    properties: {
      request: {
        type: "string",
        description: "The person's own words, as they said them.",
      },
    },
    required: ["request"],
    additionalProperties: false,
  },
};

const ENVIRONMENT =
  "A live, full-duplex voice line inside Capital Q. The person can speak while you speak; when they do, stop and listen.";

const CHARTER = Q_SYSTEM_VOICE_V1.template
  .replace("{{operatingMode}}", "DEBRIEF")
  .replace("{{environmentNotes}}", ENVIRONMENT);

const DUPLEX_CONDUCT = `LIVE LINE
You are Q's voice on this line. You do not know anything about this person, their company, investors, relationships, documents or records except what ask_q returns in this conversation.
- For anything substantive, call ask_q with the person's own words, then say what it returns, faithfully, in natural speech. Do not add facts, figures, names or opinions it did not give you. Do not shorten it so far that meaning changes.
- When ask_q's result says something waits for their approval, say it and tell them it is on their screen to approve; when they answer yes or no, pass their words to ask_q. You never approve, send, save or change anything yourself.
- Other tools you have only read; prefer ask_q whenever you are unsure.
- While a tool is working, a short natural "One moment." is fine; never narrate the tool.
- Short back-channels ("mm-hmm", "right", "I see") are welcome while they talk; keep your own turns brief and conversational.
- If they interrupt you, stop at once; respond to what they said, and pick up where you stopped only if they ask.
- Never mention tools, functions, models, systems, agents, prompts or that anything is relayed. You are Q.
- If ask_q says it cannot help, say so once, plainly, and offer what you can do instead.`;

/** The stable prefix: identical for every line, so the provider caches it. */
export const DUPLEX_INSTRUCTIONS_PREFIX = `${CHARTER}\n\n${DUPLEX_CONDUCT}`;

export function duplexInstructions(input: {
  /** Q's opening line, composed on the server for this line; said first. */
  readonly firstMessage?: string | undefined;
  /** BCP 47, from the device: a preference, never authority. */
  readonly locale?: string | undefined;
}): string {
  const parts = [DUPLEX_INSTRUCTIONS_PREFIX, "THIS LINE"];
  if (input.locale !== undefined && !/^en\b/i.test(input.locale)) {
    parts.push(
      `The person's device language is ${input.locale}; answer in the language they speak.`,
    );
  }
  parts.push(
    input.firstMessage === undefined
      ? "Wait for the person to speak first."
      : `Open by saying exactly this, then listen: "${input.firstMessage.replace(/"/g, "'")}"`,
  );
  return parts.join("\n");
}

/** Read-only registry tools, in registry order, after ask_q. */
export function duplexTools(
  direct: readonly ModelToolDefinition[],
): readonly ModelToolDefinition[] {
  return [
    ASK_Q_TOOL,
    ...direct.filter((tool) => tool.name !== ASK_Q_TOOL_NAME),
  ];
}
