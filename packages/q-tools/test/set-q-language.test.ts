import { describe, expect, it } from "vitest";

import type { QLanguagePreference } from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  createQToolExecutor,
  createQToolRegistry,
  createSetQLanguageTool,
  LANGUAGE_CONFIRMATIONS,
  SetQLanguageOutputSchema,
} from "../src/index.js";
import { actorA, actorB, contextFor, planFor } from "./support.js";

/**
 * Any language: "switch to French", in any language, sets the same
 * per-person preference as Settings, for the person asking and nobody else,
 * and carries the screen's switch and Q's confirmation in the new language.
 * The registry's resolution (Intl data) is q-core's and tested there; this
 * stand-in knows a few names, as the real one knows every offered language.
 */
const KNOWN: Readonly<
  Record<string, { tag: string; nativeName: string; englishName: string }>
> = {
  ar: { tag: "ar", nativeName: "العربية", englishName: "Arabic" },
  en: { tag: "en", nativeName: "English", englishName: "English" },
  fr: { tag: "fr", nativeName: "français", englishName: "French" },
  français: { tag: "fr", nativeName: "français", englishName: "French" },
  الفرنسية: { tag: "fr", nativeName: "français", englishName: "French" },
  es: { tag: "es", nativeName: "español", englishName: "Spanish" },
};

function harness() {
  const saved: { userId: string; language: QLanguagePreference }[] = [];
  const executor = createQToolExecutor({
    registry: createQToolRegistry([
      createSetQLanguageTool({
        set: (actor: ActorContext, language) => {
          saved.push({ userId: actor.userId, language });
          return Promise.resolve();
        },
        resolve: (asked) => KNOWN[asked] ?? null,
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
      confirm: LANGUAGE_CONFIRMATIONS["ar"],
    });
    expect(LANGUAGE_CONFIRMATIONS["ar"]).toMatch(/بالعربية/u);
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
      confirm: LANGUAGE_CONFIRMATIONS["en"],
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

  it("accepts a language named in another language and confirms in it", async () => {
    const { executor, saved } = harness();
    for (const asked of ["français", "الفرنسية", "fr"]) {
      const outcome = await executor.execute(
        call({ language: asked }),
        contextFor(actorA, ownConversation(actorA)),
      );
      expect(outcome.status).toBe("SUCCEEDED");
      expect(outcome.result.ok && outcome.result.data).toMatchObject({
        language: "fr",
        done: true,
        clientAction: { kind: "SET_LANGUAGE", language: "fr" },
      });
      // No hand-written French line: Q is told to say it in French.
      const said = outcome.result.ok
        ? SetQLanguageOutputSchema.parse(outcome.result.data).confirm
        : "";
      expect(said).toMatch(/^Say this in French \(français\)/u);
    }
    expect(saved.map((s) => s.language)).toEqual(["fr", "fr", "fr"]);
  });

  it("switches between any two languages in turn", async () => {
    const { executor, saved } = harness();
    for (const asked of ["fr", "ar", "es"]) {
      await executor.execute(
        call({ language: asked }),
        contextFor(actorA, ownConversation(actorA)),
      );
    }
    expect(saved.map((s) => s.language)).toEqual(["fr", "ar", "es"]);
  });

  it("refuses a language Capital Q does not offer, honestly, and saves nothing", async () => {
    const { executor, saved } = harness();
    const outcome = await executor.execute(
      call({ language: "Klingon" }),
      contextFor(actorA, ownConversation(actorA)),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.result.ok && outcome.result.data).toMatchObject({
      language: null,
      done: false,
      clientAction: null,
    });
    const said = outcome.result.ok
      ? SetQLanguageOutputSchema.parse(outcome.result.data).confirm
      : "";
    expect(said).toMatch(/^I can't do Klingon yet.*for example French/u);
    expect(saved).toEqual([]);
  });
});
