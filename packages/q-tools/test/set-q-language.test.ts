import { describe, expect, it } from "vitest";

import type { QLanguagePreference } from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  createQToolExecutor,
  createQToolRegistry,
  createSetQLanguageTool,
  LANGUAGE_CONFIRMATIONS,
} from "../src/index.js";
import { actorA, actorB, contextFor, planFor } from "./support.js";

/**
 * Multilingual Q: "switch to Arabic", in any language, sets the same
 * per-person preference as Settings, for the person asking and nobody else,
 * and carries the screen's switch and Q's confirmation in the new language.
 */
function harness() {
  const saved: { userId: string; language: QLanguagePreference }[] = [];
  const executor = createQToolExecutor({
    registry: createQToolRegistry([
      createSetQLanguageTool({
        set: (actor: ActorContext, language) => {
          saved.push({ userId: actor.userId, language });
          return Promise.resolve();
        },
      }),
    ]),
  });
  return { executor, saved };
}

const ownConversation = (
  actor: typeof actorA,
  userIdInFilter: string = actor.userId,
) => {
  const plan = planFor(actor, "GENERAL_QUESTION", [
    { kind: "OWN_Q_CONVERSATION", sensitivity: "CONFIDENTIAL" },
  ]);
  return {
    ...plan,
    scopes: plan.scopes.map((scope) => ({
      ...scope,
      filter: { ...scope.filter, userId: userIdInFilter },
    })),
  };
};

const call = (args: Record<string, unknown>) => ({
  callId: "l1",
  name: "set_q_language",
  arguments: args,
});

describe("set_q_language", () => {
  it("sets the person's own language and carries the switch and an Arabic confirmation", async () => {
    const { executor, saved } = harness();
    const outcome = await executor.execute(
      call({ language: "ar" }),
      contextFor(actorA, ownConversation(actorA)),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(saved).toEqual([{ userId: actorA.userId, language: "ar" }]);
    expect(outcome.result.ok && outcome.result.data).toMatchObject({
      language: "ar",
      done: true,
      clientAction: { kind: "SET_LANGUAGE", language: "ar" },
      confirm: LANGUAGE_CONFIRMATIONS.ar,
    });
    expect(LANGUAGE_CONFIRMATIONS.ar).toMatch(/بالعربية/u);
  });

  it("switches back to English, confirmed in English", async () => {
    const { executor, saved } = harness();
    const outcome = await executor.execute(
      call({ language: "en" }),
      contextFor(actorA, ownConversation(actorA)),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(saved.at(-1)?.language).toBe("en");
    expect(outcome.result.ok && outcome.result.data).toMatchObject({
      confirm: LANGUAGE_CONFIRMATIONS.en,
    });
  });

  it("refuses to change another person's language, and takes no person at all", async () => {
    const { executor, saved } = harness();
    // B asking under a conversation scope that is A's.
    const asOther = await executor.execute(
      call({ language: "ar" }),
      contextFor(actorB, ownConversation(actorB, actorA.userId)),
    );
    expect(asOther.status).not.toBe("SUCCEEDED");
    // Naming someone is not an input it accepts.
    const named = await executor.execute(
      call({ language: "ar", userId: actorB.userId }),
      contextFor(actorA, ownConversation(actorA)),
    );
    expect(named.status).not.toBe("SUCCEEDED");
    // Without the person's own-conversation scope there is nothing to set.
    const noScope = await executor.execute(
      call({ language: "ar" }),
      contextFor(actorA, planFor(actorA, "GENERAL_QUESTION", [])),
    );
    expect(noScope.status).not.toBe("SUCCEEDED");
    expect(saved).toEqual([]);
  });

  it("refuses a language Capital Q does not offer", async () => {
    const { executor, saved } = harness();
    const outcome = await executor.execute(
      call({ language: "fr" }),
      contextFor(actorA, ownConversation(actorA)),
    );
    expect(outcome.status).not.toBe("SUCCEEDED");
    expect(saved).toEqual([]);
  });
});
