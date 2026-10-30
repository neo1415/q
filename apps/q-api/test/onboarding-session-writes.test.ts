import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { getOnboardingSession } from "@capital-q/api-client";
import { describe, expect, it } from "vitest";

import {
  SESSION_WRITE_KINDS,
  writeSession,
  type SessionWriteContext,
} from "../src/voice/session-writes.js";

import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * Live recheck 2026-10-30, class B: every write q-api makes to an
 * onboarding session (submit, batch, skip, withdraw, complete, resolve,
 * say) goes through one per-session chain with one conflict retry. Nothing
 * else in the repo's server code calls the onboarding API's
 * version-bumping operations, so no write can bypass the chain.
 */

/** The api-client operations that move an onboarding session's version. */
const VERSION_BUMPING = [
  "submitOnboardingResponse",
  "submitOnboardingResponses",
  "reviseOnboardingResponse",
  "skipOnboardingStep",
  "withdrawOnboardingResponse",
  "goBackInOnboarding",
  "completeOnboardingSession",
  "resolveOnboardingSuggestion",
  "answerOnboardingQuestion",
  "dismissOnboardingQuestion",
  "sayToOnboarding",
] as const;

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const THE_CHAIN = "apps/q-api/src/voice/session-writes.ts";
/**
 * Server code that writes onboarding sessions. The browser's own writes
 * (apps/web) are sequenced by its runtime client's queue instead.
 */
const SERVER_CODE = ["apps/q-api/src", "apps/workers/src", "packages"];

function sources(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    if (name === "node_modules" || name === "dist" || name === "test") {
      return [];
    }
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx|mts)$/u.test(name) && !name.endsWith(".d.ts")
      ? [path]
      : [];
  });
}

describe("no onboarding session write bypasses the chain", () => {
  it("only session-writes.ts calls a version-bumping onboarding operation", () => {
    const callers: string[] = [];
    for (const root of SERVER_CODE) {
      for (const file of sources(join(ROOT, root))) {
        const at = relative(ROOT, file);
        // The client that defines them, and the chain that calls them.
        if (at.startsWith("packages/api-client/") || at === THE_CHAIN) {
          continue;
        }
        const text = readFileSync(file, "utf8");
        for (const name of VERSION_BUMPING) {
          if (new RegExp(`\\b${name}\\b`, "u").test(text)) {
            callers.push(`${at}: ${name}`);
          }
        }
      }
    }
    expect(callers).toEqual([]);
  });

  it("the chain dispatches every version-bumping operation q-api uses", () => {
    const chain = readFileSync(join(ROOT, THE_CHAIN), "utf8");
    expect([...SESSION_WRITE_KINDS].sort()).toEqual(
      [
        "COMPLETE",
        "RESOLVE",
        "SAY",
        "SKIP",
        "SUBMIT",
        "SUBMIT_MANY",
        "WITHDRAW",
      ].sort(),
    );
    for (const kind of SESSION_WRITE_KINDS) {
      expect(chain).toContain(`case "${kind}":`);
    }
  });
});

describe("one chain for every kind of write", () => {
  it("a submit, a skip and a withdraw fired at once on one stale version all land, in order", async () => {
    const world = investorSession({
      currentStepKey: "I0.organisation_name",
      recorded: {
        "I0.investor_type": "angel",
        "I0.business_title": "Partner",
      },
    });
    const base = turn(world, "").session;
    let posts = 0;
    let conflicts = 0;
    // The service: a write on any version but the current one is a 409.
    const session = {
      ...base,
      fetch: (async (input, init) => {
        if ((init?.method ?? "GET") === "POST") {
          posts += 1;
          const body = JSON.parse(
            typeof init?.body === "string" ? init.body : "{}",
          ) as { expectedSessionVersion?: number };
          const now = (await getOnboardingSession(base, SESSION_ID)).session
            .version;
          if (body.expectedSessionVersion !== now) {
            conflicts += 1;
            return new Response(
              JSON.stringify({
                type: "urn:capitalq:problem:resource-conflict",
                title: "The request conflicts with the current state.",
                status: 409,
                code: "VERSION_CONFLICT",
                requestId: "req_test",
              }),
              {
                status: 409,
                headers: { "content-type": "application/problem+json" },
              },
            );
          }
        }
        return world.fetch(input, init);
      }) as typeof fetch,
    };
    const stale = (await getOnboardingSession(base, SESSION_ID)).session
      .version;
    const context: SessionWriteContext = {
      session,
      onboardingSessionId: SESSION_ID,
      // Every writer starts from the same version it read earlier.
      version: () => Promise.resolve(stale),
    };
    await Promise.all([
      writeSession(context, {
        kind: "SUBMIT",
        request: {
          stepKey: "I0.organisation_name",
          response: {
            value: { type: "TEXT", text: "Noordlicht Partners" },
            channel: "CONVERSATION",
          },
        },
      }),
      writeSession(context, {
        kind: "SKIP",
        stepKey: "I3.geography_strength",
        request: {},
      }),
      writeSession(context, {
        kind: "WITHDRAW",
        stepKey: "I0.business_title",
        request: {},
      }),
    ]);
    expect(world.recordedValue("I0.organisation_name")).toEqual({
      type: "TEXT",
      text: "Noordlicht Partners",
    });
    expect(world.skippedSteps()).toEqual(
      expect.arrayContaining(["I3.geography_strength", "I0.business_title"]),
    );
    // One at a time: the first lands, each later one conflicts once and is
    // made again on the version the one before returned.
    expect(conflicts).toBe(2);
    expect(posts).toBe(5);
  });
});

const SESSION_ID = "f0000000-0000-4000-8000-000000000010";
