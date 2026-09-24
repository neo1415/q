import { describe, expect, it } from "vitest";

import { createLogger } from "@capital-q/observability";

import {
  createInterviewer,
  type InterviewGateway,
} from "../src/voice/interviewer.js";

import { base, investorSession, turn } from "./interviewer-fixtures.js";

/**
 * The rendered turn stays inside a small model's request budget
 * (CQ-QX-005; the Groq free tier refused turns above ~8,000 tokens).
 *
 * v8 says more than v7 and carries two more sections, so the whole
 * rendered prompt — charter, communication guidance, template, every
 * open step of the real investor journey — is measured here rather than
 * assumed, at both ends of a session: fresh, with every step open, and
 * deep into it, with answers known, twelve maximal turns of history,
 * options on screen and the conversation block full. The structured-output
 * JSON schema travels in the same request and is counted too.
 *
 * Ratios are calibrated, not guessed: counted with cl100k (close to the
 * Llama tokenizer the fallback uses), this prompt runs 4.3 characters to
 * a token and the result schema 3.8. Measured 2026-09-24, deep worst case:
 * 6,328 prompt tokens + 1,415 schema tokens = 7,743.
 */

const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);

const TOKEN_BUDGET = 8_000;
const PROMPT_CHARS_PER_TOKEN = 4.3;
const SCHEMA_CHARS_PER_TOKEN = 3.8;

function measuring(): {
  readonly gateway: InterviewGateway;
  readonly sizes: number[];
} {
  const sizes: number[] = [];
  return {
    sizes,
    gateway: {
      execute: (request) => {
        const prompt = (
          request.messages as readonly { readonly content: string }[]
        ).reduce((n, m) => n + m.content.length, 0);
        const schema =
          request.output.kind === "STRUCTURED"
            ? JSON.stringify(request.output.jsonSchema).length
            : 0;
        sizes.push(
          prompt / PROMPT_CHARS_PER_TOKEN + schema / SCHEMA_CHARS_PER_TOKEN,
        );
        return Promise.resolve({
          output: {
            kind: "STRUCTURED",
            value: {
              ...base,
              reply: "Which capabilities in a founding team matter to you?",
              askNext: "I5.founder_preferences",
              showOptions: true,
              reading: {
                kind: "ANSWER",
                confidence: "HIGH",
                transcript: "CLEAR",
                references: [],
                qualitative: [
                  {
                    target: "I5.founder_preferences",
                    meaning:
                      "It doesn't really matter as long as they've got the grit to do it — resilience over pedigree.",
                  },
                ],
                question: null,
                suggestions: [
                  {
                    target: "I6.green_flags",
                    value: ["capital_efficiency"],
                    because:
                      "pre-seed with a small cheque — capital efficiency may matter to you",
                  },
                ],
                tensions: [],
                clears: [],
              },
            },
          },
        } as never);
      },
    },
  };
}

describe("the rendered interview turn", () => {
  it("fits a fresh investor session, all steps open, inside the budget", async () => {
    const world = investorSession({ currentStepKey: "I0.investor_type" });
    const { gateway, sizes } = measuring();
    const interviewer = createInterviewer({ gateway, logger });
    await interviewer.turn(turn(world, "Hello, I'm an angel investor."));
    const rendered = sizes[0] ?? 0;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(TOKEN_BUDGET);
  });

  it("fits a session deep in, with history, options on screen and the conversation block full", async () => {
    const world = investorSession({
      currentStepKey: "I5.founder_preferences",
      recorded: {
        "I0.investor_type": "angel",
        "I0.organisation_name": "Zino Aviation",
        "I1.deployment_status": "actively_investing",
      },
    });
    const { gateway, sizes } = measuring();
    const interviewer = createInterviewer({ gateway, logger });
    const history = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 === 0 ? ("person" as const) : ("q" as const),
      // The longest a turn may be: the worst case, not a typical one.
      text: `Turn ${String(i)}: ${"a person explaining at length how they invest and why. ".repeat(12)}`.slice(
        0,
        600,
      ),
    }));
    // The first turn puts options on screen and fills the conversation
    // state (a kept meaning, a suggestion awaiting a yes); the second is
    // the one measured.
    await interviewer.turn(turn(world, "ok"));
    await interviewer.turn({
      ...turn(world, "It doesn't really matter as long as they've got grit."),
      recentTurns: history,
    });
    const rendered = sizes[1] ?? 0;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(TOKEN_BUDGET);
  });
});
