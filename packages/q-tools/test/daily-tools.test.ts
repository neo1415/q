import { describe, expect, it } from "vitest";

import type {
  PermittedContextPlan,
  QDailyEdition,
  QDailyPreferences,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  createQDailyTools,
  createQToolExecutor,
  createQToolRegistry,
  GetQDailyOutputSchema,
  SetQDailyPreferencesInputSchema,
  type QDailyToolPort,
} from "../src/index.js";
import { actorA, actorB, contextFor, planFor } from "./support.js";

/**
 * The Q Daily through Q (DAILY spec §7): "show me today's Q Daily", "make
 * it weekly". Own edition and own preferences only.
 */

function ownPlan(actor = actorA, owner = actor): PermittedContextPlan {
  const plan = planFor(actor, "GENERAL_QUESTION", [
    { kind: "OWN_Q_CONVERSATION", sensitivity: "CONFIDENTIAL" },
  ]);
  return {
    ...plan,
    scopes: plan.scopes.map((scope) =>
      scope.kind === "OWN_Q_CONVERSATION"
        ? { ...scope, filter: { ...scope.filter, userId: owner.userId } }
        : scope,
    ),
  };
}

const PREFERENCES: QDailyPreferences = {
  frequency: "WEEKLY",
  email: true,
  sections: ["YOUR_SECTOR", "YOUR_MARKET", "DEALS", "PEOPLE", "Q_TAKE"],
  nextDueAt: "2026-10-05T06:00:00.000Z",
};

const EDITION: QDailyEdition = {
  id: "00000000-0000-4000-8000-0000000000e1",
  number: 2,
  editionDate: "2026-10-05",
  frequency: "WEEKLY",
  readerName: "Kola",
  topics: ["Fintech"],
  lead: {
    id: "s1",
    section: "LEAD",
    headline: "Moniepoint raises $110 million",
    standfirst: "The round values the company above $1 billion.",
    paragraphs: ["TechCabal reports the round."],
    quotes: [],
    sources: [
      {
        url: "https://techcabal.com/a",
        publisher: "TechCabal",
        title: "Moniepoint",
        publishedAt: null,
      },
    ],
    image: null,
    deal: null,
    written: true,
  },
  sections: [],
  briefs: [],
  chart: null,
  qTake: {
    paragraphs: ["Late-stage fintech money is back; worth watching."],
    storyIds: ["s1"],
    truthClass: "Q_INFERENCE",
  },
  generatedAt: "2026-10-05T06:00:00Z",
};

function harness(edition: QDailyEdition | null, preferences = PREFERENCES) {
  const asked: string[] = [];
  const set: { userId: string; patch: unknown }[] = [];
  const port: QDailyToolPort = {
    latest: (actor: ActorContext) => {
      asked.push(actor.userId);
      return Promise.resolve({ edition, preferences });
    },
    setPreferences: (actor, patch) => {
      set.push({ userId: actor.userId, patch });
      return Promise.resolve({
        ...preferences,
        ...patch,
        sections: patch.sections ?? preferences.sections,
        nextDueAt: patch.frequency === "OFF" ? null : preferences.nextDueAt,
      });
    },
  };
  const executor = createQToolExecutor({
    registry: createQToolRegistry(createQDailyTools(port)),
  });
  return { executor, asked, set };
}

const call = (name: string, args: Record<string, unknown>) => ({
  callId: `c-${name}`,
  name,
  arguments: args,
});

describe("The Q Daily tools", () => {
  it("reads the person's own latest edition with its link and Q's take", async () => {
    const { executor, asked } = harness(EDITION);
    const outcome = await executor.execute(
      call("get_q_daily", {}),
      contextFor(actorA, ownPlan()),
    );
    if (!outcome.result.ok) throw new Error("expected the read to succeed");
    const output = GetQDailyOutputSchema.parse(outcome.result.data);
    expect(output).toMatchObject({
      status: "READY",
      number: 2,
      href: `/daily/${EDITION.id}`,
      headlines: [
        {
          section: "Lead",
          headline: "Moniepoint raises $110 million",
          publisher: "TechCabal",
        },
      ],
      qTake: "Late-stage fintech money is back; worth watching.",
    });
    expect(asked).toEqual([actorA.userId]);
  });

  it("says when the first edition is still to come, or it is off", async () => {
    const none = await harness(null).executor.execute(
      call("get_q_daily", {}),
      contextFor(actorA, ownPlan()),
    );
    if (!none.result.ok) throw new Error("expected the read to succeed");
    expect(GetQDailyOutputSchema.parse(none.result.data).status).toBe(
      "NONE_YET",
    );
    const off = await harness(null, {
      ...PREFERENCES,
      frequency: "OFF",
      nextDueAt: null,
    }).executor.execute(call("get_q_daily", {}), contextFor(actorA, ownPlan()));
    if (!off.result.ok) throw new Error("expected the read to succeed");
    expect(GetQDailyOutputSchema.parse(off.result.data).status).toBe("OFF");
  });

  it("makes it weekly, daily or off for the person themselves, at once", async () => {
    const { executor, set } = harness(EDITION);
    const outcome = await executor.execute(
      call("set_q_daily_preferences", { frequency: "DAILY", email: false }),
      contextFor(actorA, ownPlan()),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(set).toEqual([
      { userId: actorA.userId, patch: { frequency: "DAILY", email: false } },
    ]);
  });

  it("takes only its own fields and section codes", () => {
    expect(
      SetQDailyPreferencesInputSchema.safeParse({ frequency: "HOURLY" })
        .success,
    ).toBe(false);
    expect(
      SetQDailyPreferencesInputSchema.safeParse({ sections: ["SPORTS"] })
        .success,
    ).toBe(false);
    expect(
      SetQDailyPreferencesInputSchema.safeParse({
        frequency: "OFF",
        userId: actorB.userId,
      }).success,
    ).toBe(false);
  });

  it("NEGATIVE: never reads or changes another person's Q Daily", async () => {
    const { executor, asked, set } = harness(EDITION);
    const read = await executor.execute(
      call("get_q_daily", {}),
      contextFor(actorA, ownPlan(actorA, actorB)),
    );
    const write = await executor.execute(
      call("set_q_daily_preferences", { frequency: "OFF" }),
      contextFor(actorA, ownPlan(actorA, actorB)),
    );
    expect(read.status).not.toBe("SUCCEEDED");
    expect(write.status).not.toBe("SUCCEEDED");
    expect(asked).toEqual([]);
    expect(set).toEqual([]);
  });

  it("refuses an empty change", async () => {
    const { executor, set } = harness(EDITION);
    const outcome = await executor.execute(
      call("set_q_daily_preferences", {}),
      contextFor(actorA, ownPlan()),
    );
    expect(outcome.status).not.toBe("SUCCEEDED");
    expect(set).toEqual([]);
  });
});
