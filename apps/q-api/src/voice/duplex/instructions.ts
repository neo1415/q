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

/**
 * BACKCHANNEL: the duplex-only tool the model calls when the person asks
 * Q to react less, more, or not at all. The model chooses the change from
 * a closed set and quotes them; the broker resolves the level and writes
 * it through the memory Write Gate. Never offered to a backchannel.
 */
export const SET_LISTENING_TOOL_NAME = "set_listening" as const;

export const LISTENING_CHANGES = [
  "OFF",
  "LESS",
  "MORE",
  "SUBTLE",
  "NATURAL",
] as const;

export const SET_LISTENING_TOOL: ModelToolDefinition = {
  name: SET_LISTENING_TOOL_NAME,
  description:
    "Change how much you react with small listening sounds while the person talks, and with short lines while you work on an answer, when they ask: OFF to stop them, LESS or MORE to adjust, SUBTLE or NATURAL when they name a level. Remembered for next time.",
  inputJsonSchema: {
    type: "object",
    properties: {
      change: { type: "string", enum: [...LISTENING_CHANGES] },
      quote: {
        type: "string",
        description: "Their exact words asking for the change.",
      },
    },
    required: ["change", "quote"],
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
- Call ask_q straight away, without a lead-in; never narrate the tool.
- Keep your own turns brief and conversational.
- If ask_q's result carries a delivery note, let it colour how you sound; never say the note.

PACING
- Speak at a relaxed, unhurried conversational pace, like a calm analyst on a call: not slow, never rushed.
- Short sentences, one thought at a time, with a natural pause between thoughts.
- Say the answer first, in two or three sentences. If there is more, stop and let them respond, or offer it ("want the detail?"), rather than going on.
- After a question to them, stop and wait. Leave room: silence while they think is fine.
- Never fill a pause with filler or a recap of what you just said.

EXPRESSION
- React the way a person does, in your voice: warmth, surprise, a real laugh when something is funny.
- Never say a sound as a word or a description: no "ha", "haha", "hehe", "lol", and no stage directions such as "chuckles", "laughs", "sighs" or "smiles", in any language.
- If they interrupt you, stop at once; respond to what they said, and pick up where you stopped only if they ask.
- Never mention tools, functions, models, systems, agents, prompts or that anything is relayed. You are Q.
- If ask_q says it cannot help, say so once, plainly, and offer what you can do instead.`;

/** The stable prefix: identical for every line, so the provider caches it. */
export const DUPLEX_INSTRUCTIONS_PREFIX = `${CHARTER}\n\n${DUPLEX_CONDUCT}`;

const LISTENING_CONDUCT = `LISTENING
- While they talk you stay quiet; Q's small listening sounds and its short lines while an answer is slow are produced separately, never by you.
- If they ask for less or more of those sounds, or for them to stop ("stop doing that", "less of that", "you can react more"), call set_listening with the change and their exact words, then acknowledge it once, in a few words, and carry on. If it is unclear what they mean, ask briefly.`;

/** The prefix for a line with listening behaviour: still identical per line. */
export const DUPLEX_LISTENING_INSTRUCTIONS_PREFIX = `${DUPLEX_INSTRUCTIONS_PREFIX}\n\n${LISTENING_CONDUCT}`;

/**
 * BACKCHANNEL: the out-of-band reaction while the person is mid-turn.
 * Server-owned and stable (the provider caches it across reactions); the
 * browser appends only what changes (their in-progress audio, what Q
 * last said, the reactions already used). The examples are guidance for
 * the model's choice, not a list it picks from.
 */
export const BACKCHANNEL_INSTRUCTIONS = `You are Q, listening on a live call. The person is in the middle of telling you something and has paused briefly; they will carry on. Make one tiny listener's reaction in your own voice, the way an attentive person does on a phone call.
- At most three words and under one second, quiet and relaxed. Never a sentence, never a question they must answer, never advice.
- When in doubt, stay silent: most pauses need no reaction at all.
- Fit what they just said and how they said it: a continuer ("mm-hm", "yeah", "right") while they narrate; an assessment ("wow", "nice", "oh, really?") for news; empathy ("oh no", "oof", "ah") for something hard; for something funny, a short, soft laugh in your voice (the sound itself, never the word "ha" or a description such as "chuckles"); "okay" or "got it" for an instruction. If nothing more fits, the softest "mm".
- Never state a fact, figure, name or opinion; never agree to do anything; never call a tool.
- Do not repeat the reactions you used recently (listed below); vary like a person does.
- Use the language they are speaking.`;

/** BACKCHANNEL: the out-of-band bridge while a substantive answer is slow. */
export const BRIDGE_INSTRUCTIONS = `You are Q on a live call. The person asked you something (their words are below) and your answer is still being prepared; the pause is now noticeable. Say one short, natural bridging line in your own voice, as a person does while they look something up: at most eight words, about what you are doing for them, drawn from their request (for example pulling up a company they named, or going through their pipeline).
- Never give an answer, fact, figure or result; never guess what you will find; never promise an outcome or a time.
- Never mention tools, systems, searching databases or waiting. Not "hmm", and not a generic "one moment" when something specific fits.
- Different from the bridging lines you used recently (listed below).
- Use the language they are speaking.`;

export function duplexInstructions(input: {
  /** Q's opening line, composed on the server for this line; said first. */
  readonly firstMessage?: string | undefined;
  /** BCP 47, from the device: a preference, never authority. */
  readonly locale?: string | undefined;
  /** BACKCHANNEL: the line listens like a person (the set_listening conduct). */
  readonly listening?: boolean | undefined;
}): string {
  const parts = [
    input.listening === true
      ? DUPLEX_LISTENING_INSTRUCTIONS_PREFIX
      : DUPLEX_INSTRUCTIONS_PREFIX,
    "THIS LINE",
  ];
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

/** Read-only registry tools, in registry order, after ask_q (and set_listening). */
export function duplexTools(
  direct: readonly ModelToolDefinition[],
  options: { readonly listening?: boolean | undefined } = {},
): readonly ModelToolDefinition[] {
  return [
    ASK_Q_TOOL,
    ...(options.listening === true ? [SET_LISTENING_TOOL] : []),
    ...direct.filter(
      (tool) =>
        tool.name !== ASK_Q_TOOL_NAME && tool.name !== SET_LISTENING_TOOL_NAME,
    ),
  ];
}
