import { describe, expect, it } from "vitest";

import {
  createNotePreferenceTool,
  createQToolExecutor,
  createQToolRegistry,
  type NotePreferenceInput,
  type PreferenceNotePort,
} from "../src/index.js";
import { actorA, actorB, contextFor, planFor } from "./support.js";

/**
 * `note_preference` (CQ-QX-007 P0-5): the model decides a preference was
 * expressed; the tool only proposes it, for this very person, to a port
 * over the memory Write Gate. Closed vocabulary in, never a memory row
 * written here.
 */

function harness(owner: string) {
  const notes: (NotePreferenceInput & { latestUserText: string | null })[] = [];
  const port: PreferenceNotePort = {
    ownerUserId: owner,
    note: (input) => {
      notes.push(input);
      return Promise.resolve({ outcome: "REMEMBERED", reason: "RECORDED" });
    },
  };
  const executor = createQToolExecutor({
    registry: createQToolRegistry([createNotePreferenceTool(port)]),
  });
  return { executor, notes };
}

/** The firewall's actor-wide own-conversation scope, filtered to `userId`. */
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
  callId: "n1",
  name: "note_preference",
  arguments: args,
});

describe("note_preference", () => {
  it("proposes a closed-vocabulary preference for the person themselves, with what they said", async () => {
    const { executor, notes } = harness(actorA.userId);
    const context = {
      ...contextFor(actorA, ownConversation(actorA)),
      conversation: { latestUserText: "just give me the result" },
    };
    const outcome = await executor.execute(
      call({
        aspect: "responseDepth",
        value: "CONCISE",
        persistence: "LONG_TERM",
        quote: "just give me the result",
      }),
      context,
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(notes).toEqual([
      {
        aspect: "responseDepth",
        value: "CONCISE",
        persistence: "LONG_TERM",
        quote: "just give me the result",
        latestUserText: "just give me the result",
      },
    ]);
  });

  it("refuses a value outside the aspect's vocabulary, and an aspect that does not exist", async () => {
    const { executor, notes } = harness(actorA.userId);
    for (const args of [
      {
        aspect: "responseDepth",
        value: "TINY",
        persistence: "SESSION",
        quote: "shorter",
      },
      {
        aspect: "tone",
        value: "CONCISE",
        persistence: "SESSION",
        quote: "shorter",
      },
      {
        aspect: "verbosity",
        value: "LOW",
        persistence: "SESSION",
        quote: "shorter",
      },
    ]) {
      const outcome = await executor.execute(
        call(args),
        contextFor(actorA, ownConversation(actorA)),
      );
      expect(outcome.status).not.toBe("SUCCEEDED");
    }
    expect(notes).toEqual([]);
  });

  it("writes for nobody but the person the port is bound to, and only under their own-conversation scope", async () => {
    // Bound to A, asked by B.
    const bound = harness(actorA.userId);
    const asB = await bound.executor.execute(
      call({
        aspect: "tone",
        value: "CONVERSATIONAL",
        persistence: "SESSION",
        quote: "talk normally",
      }),
      contextFor(actorB, ownConversation(actorB)),
    );
    expect(asB.status).toBe("DENIED");
    // A without the scope.
    const bare = await bound.executor.execute(
      call({
        aspect: "tone",
        value: "CONVERSATIONAL",
        persistence: "SESSION",
        quote: "talk normally",
      }),
      contextFor(actorA, planFor(actorA, "GENERAL_QUESTION", [])),
    );
    expect(bare.status).not.toBe("SUCCEEDED");
    // A with a scope filtered to somebody else.
    const forged = await bound.executor.execute(
      call({
        aspect: "tone",
        value: "CONVERSATIONAL",
        persistence: "SESSION",
        quote: "talk normally",
      }),
      contextFor(actorA, ownConversation(actorA, actorB.userId)),
    );
    expect(forged.status).toBe("DENIED");
    expect(bound.notes).toEqual([]);
  });
});
