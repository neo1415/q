import { describe, expect, it } from "vitest";

import { createLogger } from "@capital-q/observability";
import type { ConversationTurnReading } from "@capital-q/q-core";

import {
  createInterviewer,
  type InterviewGateway,
} from "../src/voice/interviewer.js";

import {
  base,
  gateway,
  investorSession,
  turn,
} from "./interviewer-fixtures.js";

/**
 * G, the product-acceptance directive of 2026-09-24: the Adult content /
 * Insurance loops across I7.avoid, I7.hard_exclusions and
 * I7.sector_exclusions. Each case is a layer that failed on the live
 * replay of the fixture; the model's reading is given as luna returned
 * it, and the assertions are on what the session holds and on the claims
 * the reply makes, never its wording.
 */

const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);

const reading = (
  overrides: Partial<ConversationTurnReading>,
): ConversationTurnReading => ({
  kind: "ANSWER",
  confidence: "HIGH",
  transcript: "CLEAR",
  references: [],
  qualitative: [],
  question: null,
  suggestions: [],
  tensions: [],
  clears: [],
  ...overrides,
});

const SO_FAR = {
  "I0.investor_type": "angel",
  "I0.organisation_name": "Zino Aviation",
  "I1.deployment_status": "actively_investing",
};

describe("G · no restriction on an exclusion list is nothing excluded", () => {
  it("sets 'anything goes' aside on I7.avoid instead of avoiding every red flag", async () => {
    // Live: "Anything goes there, I do not mind what I see" recorded
    // I7.avoid as all eight red flags.
    const world = investorSession({
      refuseSkipOfAnswered: true,
      currentStepKey: "I7.avoid",
      recorded: SO_FAR,
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        reply: "Fair enough.",
        unrestricted: [{ stepKey: "I7.avoid" }],
        reading: reading({}),
      }),
      logger,
    });

    await interviewer.turn(
      turn(world, "Anything goes there, I do not mind what I see."),
    );

    expect(world.recordedValue("I7.avoid")).toBeUndefined();
    expect(world.skippedSteps()).toContain("I7.avoid");
  });

  it("does the same for the never-show list", async () => {
    const world = investorSession({
      refuseSkipOfAnswered: true,
      currentStepKey: "I7.hard_exclusions",
      recorded: SO_FAR,
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        reply: "Understood.",
        unrestricted: [{ stepKey: "I7.hard_exclusions" }],
        reading: reading({}),
      }),
      logger,
    });

    await interviewer.turn(turn(world, "Nothing is off limits."));

    expect(world.recordedValue("I7.hard_exclusions")).toBeUndefined();
    expect(world.skippedSteps()).toContain("I7.hard_exclusions");
  });
});

describe("G · an exclusion given as the answer to the exclusion question is recorded", () => {
  it("records 'Gambling then' on the never-show list without a read-back", async () => {
    const world = investorSession({
      refuseSkipOfAnswered: true,
      currentStepKey: "I7.hard_exclusions",
      recorded: { ...SO_FAR, "I7.avoid": "adult_content" },
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        reply: "I'll take gambling as the exclusion you mean.",
        answers: [
          {
            stepKey: "I7.hard_exclusions",
            value: ["gambling"],
            confidence: "HIGH",
            clarity: "SETTLED",
          },
        ],
        reading: reading({}),
      }),
      logger,
    });

    const outcome = await interviewer.turn(
      turn(world, "Okay. Gambling. Gambling then."),
    );

    expect(world.recordedValue("I7.hard_exclusions")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["gambling"],
    });
    expect(outcome.recorded).toContain("I7.hard_exclusions");
    // Not asked about again: whatever Q asks next is another step.
    expect(outcome.asking?.stepKey).not.toBe("I7.hard_exclusions");
  });

  it("still reads back a hard exclusion volunteered while another question was open", async () => {
    const world = investorSession({
      refuseSkipOfAnswered: true,
      currentStepKey: "I2.stages",
      recorded: SO_FAR,
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        reply: "Noted.",
        answers: [
          {
            stepKey: "I7.hard_exclusions",
            value: ["gambling"],
            confidence: "HIGH",
            clarity: "SETTLED",
          },
        ],
        reading: reading({}),
      }),
      logger,
    });

    await interviewer.turn(turn(world, "By the way, never gambling."));

    expect(world.recordedValue("I7.hard_exclusions")).toBeUndefined();
  });
});

describe("G · one concept stays in one exclusion list", () => {
  it("moves adult content from 'rather not see' to 'never show' when that is the answer", async () => {
    // Live: the journey refused the never-show write ("Keep it in one
    // list"), the refusal was treated as an invalid value, and the
    // question came round again.
    const world = investorSession({
      refuseSkipOfAnswered: true,
      currentStepKey: "I7.hard_exclusions",
      recorded: { ...SO_FAR, "I7.avoid": "adult_content,tobacco" },
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        reply: "Understood.",
        answers: [
          {
            stepKey: "I7.hard_exclusions",
            value: ["adult_content", "gambling"],
            confidence: "HIGH",
            clarity: "SETTLED",
          },
        ],
        reading: reading({}),
      }),
      logger,
    });

    await interviewer.turn(turn(world, "Adult content and gambling."));

    expect(world.recordedValue("I7.hard_exclusions")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["adult_content", "gambling"],
    });
    expect(world.recordedValue("I7.avoid")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["tobacco"],
    });
  });

  it("does not re-list on 'rather not see' what is already never shown", async () => {
    const world = investorSession({
      refuseSkipOfAnswered: true,
      currentStepKey: "I7.avoid",
      recorded: { ...SO_FAR, "I7.hard_exclusions": "gambling" },
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        reply: "Understood.",
        answers: [
          {
            stepKey: "I7.avoid",
            value: ["gambling", "tobacco"],
            confidence: "HIGH",
            clarity: "SETTLED",
          },
        ],
        reading: reading({}),
      }),
      logger,
    });

    await interviewer.turn(turn(world, "Gambling and tobacco."));

    expect(world.recordedValue("I7.avoid")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["tobacco"],
    });
    expect(world.recordedValue("I7.hard_exclusions")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["gambling"],
    });
  });
});

describe("G · 'I just said so' at the sibling of an answered exclusion", () => {
  const insisting = {
    ...base,
    intent: "CORRECTION" as const,
    reply: "You're right, you already said adult content.",
    frustrated: true,
    reading: reading({ kind: "CORRECTION" }),
  };

  it("asks once which of several ranked-lower items to hide, and the answer moves it", async () => {
    const world = investorSession({
      refuseSkipOfAnswered: true,
      currentStepKey: "I7.hard_exclusions",
      recorded: { ...SO_FAR, "I7.avoid": "adult_content,tobacco" },
    });
    const interviewer = createInterviewer({
      gateway: gateway(insisting, {
        ...base,
        reply: "Adult content, never shown.",
        answers: [
          {
            stepKey: "I7.hard_exclusions",
            value: ["adult_content"],
            confidence: "HIGH",
            clarity: "SETTLED",
          },
        ],
        reading: reading({}),
      }),
      logger,
    });

    const first = await interviewer.turn(turn(world, "I just said so."));
    // No claim that something they said was lost: nothing was.
    expect(first.reply).not.toMatch(/didn't get it down/i);
    // What they insist on is named from the record, and the one question
    // that separates the two lists is asked.
    expect(first.reply).toContain("Adult content");
    expect(first.asking?.stepKey).toBe("I7.hard_exclusions");
    expect(world.recordedValue("I7.hard_exclusions")).toBeUndefined();

    await interviewer.turn(turn(world, "Adult content."));
    expect(world.recordedValue("I7.hard_exclusions")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["adult_content"],
    });
    // Moved, not listed twice: the journey keeps it in one list.
    expect(world.recordedValue("I7.avoid")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["tobacco"],
    });
  });

  it("does not offer a move the journey cannot make, and sets the never-show list aside", async () => {
    // "Rather not see" holds only adult content: moving it would leave
    // that list empty, which the journey cannot record.
    const world = investorSession({
      refuseSkipOfAnswered: true,
      currentStepKey: "I7.hard_exclusions",
      recorded: { ...SO_FAR, "I7.avoid": "adult_content" },
    });
    const interviewer = createInterviewer({
      gateway: gateway(insisting),
      logger,
    });

    const outcome = await interviewer.turn(turn(world, "I just said so."));

    expect(outcome.reply).not.toMatch(/didn't get it down/i);
    expect(outcome.reply).toContain("Adult content");
    expect(world.skippedSteps()).toContain("I7.hard_exclusions");
    expect(world.recordedValue("I7.avoid")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["adult_content"],
    });
    expect(outcome.asking?.stepKey).not.toBe("I7.hard_exclusions");
  });

  it("insisting again sets the never-show list aside and moves on, keeping the answer as given", async () => {
    const world = investorSession({
      refuseSkipOfAnswered: true,
      currentStepKey: "I7.hard_exclusions",
      recorded: { ...SO_FAR, "I7.avoid": "adult_content,tobacco" },
    });
    const interviewer = createInterviewer({
      gateway: gateway(insisting, {
        ...insisting,
        intent: "ANSWER",
        reading: reading({ kind: "CLARIFICATION" }),
      }),
      logger,
    });

    await interviewer.turn(turn(world, "I just said so."));
    const second = await interviewer.turn(
      turn(world, "just answered that question."),
    );

    expect(second.reply).not.toMatch(/didn't get it down/i);
    expect(world.skippedSteps()).toContain("I7.hard_exclusions");
    expect(world.recordedValue("I7.hard_exclusions")).toBeUndefined();
    expect(world.recordedValue("I7.avoid")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["adult_content", "tobacco"],
    });
    expect(second.asking?.stepKey).not.toBe("I7.hard_exclusions");
  });

  it("never claims a lost answer about a step nothing was said for", async () => {
    const world = investorSession({
      refuseSkipOfAnswered: true,
      currentStepKey: "I7.sector_exclusions",
      recorded: SO_FAR,
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...insisting,
        reply: "Fair enough.",
      }),
      logger,
    });

    const outcome = await interviewer.turn(
      turn(world, "Stop asking me silly questions."),
    );

    expect(outcome.reply).not.toMatch(/you did tell me/i);
  });
});

describe("G · a sector the taxonomy does not hold is said, not dropped", () => {
  it("says 'Adult content' matched no sector instead of claiming it was lost", async () => {
    const world = investorSession({
      refuseSkipOfAnswered: true,
      currentStepKey: "I7.sector_exclusions",
      recorded: SO_FAR,
      taxonomy: {},
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        reply: "Got it.",
        categoryPhrases: [
          { stepKey: "I7.sector_exclusions", phrases: ["Adult content"] },
        ],
        reading: reading({}),
      }),
      logger,
    });

    const outcome = await interviewer.turn(turn(world, "Adult content."));

    expect(world.recordedValue("I7.sector_exclusions")).toBeUndefined();
    expect(outcome.recorded).toEqual([]);
    // Not a lost-answer claim and not an acknowledgement: the step is
    // asked again, the question they actually answered.
    expect(outcome.reply).not.toMatch(/you did tell me|got it/i);
    expect(outcome.asking?.stepKey).toBe("I7.sector_exclusions");
  });
});

describe("G · a further item for a held list adds to it", () => {
  it("keeps adult content and gambling when gambling answers the read-back of adult content", async () => {
    // Live: two holds for one list; the yes confirmed the first and the
    // second was discarded.
    const world = investorSession({
      refuseSkipOfAnswered: true,
      currentStepKey: "I2.stages",
      recorded: SO_FAR,
    });
    const hard = (keys: readonly string[]) => ({
      ...base,
      reply: "Noted.",
      answers: [
        {
          stepKey: "I7.hard_exclusions",
          value: [...keys],
          confidence: "HIGH" as const,
          clarity: "SETTLED" as const,
        },
      ],
      reading: reading({}),
    });
    const interviewer = createInterviewer({
      gateway: gateway(hard(["adult_content"]), hard(["gambling"]), {
        ...base,
        reply: "Done.",
        confirmations: [
          { stepKey: "I7.hard_exclusions", decision: "CONFIRMED" },
        ],
        reading: reading({}),
      }),
      logger,
    });

    const first = await interviewer.turn(
      turn(world, "I don't want to see adult content, ever."),
    );
    expect(first.asking?.stepKey).toBe("I7.hard_exclusions");
    expect(world.recordedValue("I7.hard_exclusions")).toBeUndefined();

    await interviewer.turn(turn(world, "Gambling then."));
    await interviewer.turn(turn(world, "Yes."));

    expect(world.recordedValue("I7.hard_exclusions")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["adult_content", "gambling"],
    });
  });
});

describe("G · a list set aside stays answerable", () => {
  it("still offers the set-aside exclusion lists to the reading, marked never to be asked", async () => {
    // Live: "Nothing else" set the lists aside; "I don't want to see adult
    // content" a moment later had no step to land on, nothing was written,
    // and the model's prose said it was taken.
    const world = investorSession({
      refuseSkipOfAnswered: true,
      currentStepKey: "I7.avoid",
      recorded: SO_FAR,
    });
    const prompts: string[] = [];
    const results = [
      {
        ...base,
        reply: "Fair enough.",
        unrestricted: [{ stepKey: "I7.avoid" }],
        reading: reading({}),
      },
      {
        ...base,
        reply: "Understood.",
        answers: [
          {
            stepKey: "I7.avoid",
            value: ["adult_content"],
            confidence: "HIGH" as const,
            clarity: "SETTLED" as const,
          },
        ],
        reading: reading({}),
      },
    ];
    let index = 0;
    const capturing: InterviewGateway = {
      execute: (request) => {
        prompts.push(
          (request.messages as readonly { readonly content: string }[])
            .map((m) => m.content)
            .join("\n"),
        );
        const value = results[Math.min(index, results.length - 1)];
        index += 1;
        return Promise.resolve({
          output: { kind: "STRUCTURED", value },
        } as never);
      },
    };
    const interviewer = createInterviewer({ gateway: capturing, logger });

    await interviewer.turn(turn(world, "Nothing else."));
    expect(world.skippedSteps()).toContain("I7.avoid");
    await interviewer.turn(turn(world, "I don't want to see adult content."));

    const second = prompts[1] ?? "";
    expect(second).toContain("SET ASIDE EARLIER");
    expect(second).toMatch(/"stepKey":\s*"I7\.avoid"/);
    expect(world.recordedValue("I7.avoid")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["adult_content"],
    });
  });
});

describe("G · what the journey cannot move is said, and the rest is written", () => {
  it("writes gambling to never-show and says adult content stays ranked lower", async () => {
    const world = investorSession({
      refuseSkipOfAnswered: true,
      currentStepKey: "I7.hard_exclusions",
      recorded: { ...SO_FAR, "I7.avoid": "adult_content" },
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        reply: "Both never shown.",
        answers: [
          {
            stepKey: "I7.hard_exclusions",
            value: ["adult_content", "gambling"],
            confidence: "HIGH",
            clarity: "SETTLED",
          },
        ],
        reading: reading({}),
      }),
      logger,
    });

    const outcome = await interviewer.turn(
      turn(world, "Adult content and gambling."),
    );

    expect(world.recordedValue("I7.hard_exclusions")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["gambling"],
    });
    expect(world.recordedValue("I7.avoid")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["adult_content"],
    });
    // The model's "both never shown" is not what happened; the reply
    // names the item that stayed where it was.
    expect(outcome.reply).toContain("Adult content");
  });
});

describe("G · objecting to a read-back of their own words records it", () => {
  it("writes the held never-show list on 'stop asking me silly questions'", async () => {
    const world = investorSession({
      refuseSkipOfAnswered: true,
      currentStepKey: "I2.stages",
      recorded: SO_FAR,
    });
    const interviewer = createInterviewer({
      gateway: gateway(
        {
          ...base,
          reply: "Noted.",
          answers: [
            {
              stepKey: "I7.hard_exclusions",
              value: ["gambling", "adult_content"],
              confidence: "HIGH",
              clarity: "SETTLED",
            },
          ],
          reading: reading({}),
        },
        {
          ...base,
          intent: "CORRECTION",
          reply: "Sorry.",
          frustrated: true,
          reading: reading({ kind: "CLARIFICATION" }),
        },
      ),
      logger,
    });

    const first = await interviewer.turn(
      turn(world, "Never gambling or adult content."),
    );
    expect(first.asking?.stepKey).toBe("I7.hard_exclusions");
    expect(world.recordedValue("I7.hard_exclusions")).toBeUndefined();

    const second = await interviewer.turn(
      turn(world, "Stop asking me silly questions."),
    );
    expect(world.recordedValue("I7.hard_exclusions")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["gambling", "adult_content"],
    });
    expect(second.asking?.stepKey).not.toBe("I7.hard_exclusions");
  });
});
