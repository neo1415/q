import type { CallPrepWriter } from "@capital-q/model-gateway/q";
import type { QAnswerRequest } from "@capital-q/q-runtime";
import { describe, expect, it } from "vitest";

import {
  createCallPrepPort,
  type CallPrepSources,
} from "../src/composition/call-prep.js";

/**
 * Owner 2026-10-23: a call with one named counterpart, prepared from what
 * the founder may see. The Context Firewall holds before the model: the
 * name resolves only among records they may already see, and the writer
 * gets the rehearsal material only (never an investor's mandate).
 */
const INVESTOR = "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a";
const RELATIONSHIP = "7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b";
const request = {
  actor: { tenantId: "t", userId: "u" },
  runId: "run-1",
  correlationId: "c",
  plan: { maxSensitivity: "CONFIDENTIAL" },
} as unknown as QAnswerRequest;

const RESULT = {
  whoTheyAre: "A seed fund in Nairobi.",
  soFar: "First contact.",
  questions: [
    { question: "Why now?", answer: "Pilots with 3 co-ops." },
    { question: "Who pays?", answer: "The co-ops." },
    { question: "How big?", answer: "Not in your record yet." },
  ],
  weakSpots: [{ spot: "No churn figure.", handle: "Say so." }],
  ask: "A second meeting.",
};

function sources(options: {
  readonly found?: string | null;
  readonly relationshipId?: string | null;
  readonly waiting?: readonly { summary: string; targets?: unknown[] }[];
}) {
  const written: Parameters<CallPrepWriter>[1][] = [];
  const looked: string[] = [];
  const material: ReturnType<CallPrepSources["material"]> = {
    viewer: () =>
      Promise.resolve({ role: "FOUNDER", organisationName: "Maji Loop" }),
    counterpart: (_actor, kind, id) =>
      Promise.resolve(
        kind === "INVESTOR_ORGANISATION" && id === INVESTOR
          ? {
              name: "Savanna Seed Partners",
              profile: "Name: Savanna Seed Partners\nType: VC",
              relationshipId: options.relationshipId ?? null,
            }
          : null,
      ),
    theirMessages: () => Promise.resolve("Amina: Looking forward to it."),
    theirCalls: () => Promise.resolve(""),
    counterpartMaterial: () => Promise.resolve({ text: "", sources: [] }),
    ownMaterial: () =>
      Promise.resolve({ text: "THEIR COMPANY: Maji Loop.", sources: [] }),
    upcomingMeetings: () =>
      Promise.resolve([
        {
          meetingId: "m",
          relationshipId: RELATIONSHIP,
          startsAt: "2026-10-27T09:00:00Z",
          purpose: "First call",
        },
      ]),
  };
  const port = createCallPrepPort({
    material: () => material,
    findByName: (_actor, kind, name) => {
      looked.push(`${kind}:${name}`);
      return Promise.resolve(
        options.found === undefined ? INVESTOR : options.found,
      );
    },
    waiting: () =>
      Promise.resolve(
        (options.waiting ?? []).map((item) => ({
          summary: item.summary,
          targets: (item.targets ?? []) as never,
        })),
      ),
    write: (_request, input) => {
      written.push(input);
      return Promise.resolve(RESULT);
    },
  });
  return { port, written, looked };
}

describe("call prep from what the founder may see (owner 2026-10-23)", () => {
  it("resolves the investor among what they may see, and writes from the rehearsal material", async () => {
    const { port, written, looked } = sources({ relationshipId: RELATIONSHIP });
    const prep = await port.prepare(request, {
      counterpart: "Savanna Seed Partners",
      said: "Help me prepare for a first call with Savanna Seed Partners",
    });
    expect(looked).toEqual(["INVESTOR_ORGANISATION:Savanna Seed Partners"]);
    expect(prep?.counterpartName).toBe("Savanna Seed Partners");
    expect(prep?.questions).toHaveLength(3);
    expect(prep?.waiting).toEqual([]);
    const input = written[0];
    expect(input?.viewerRole).toBe("FOUNDER");
    expect(input?.counterpartProfile).toContain("Type: VC");
    expect(input?.soFar).toContain(
      "MEETINGS BOOKED:\n- 2026-10-27T09:00:00Z: First call",
    );
    expect(input?.soFar).toContain("Amina: Looking forward to it.");
    expect(input?.ownRecord).toBe("THEIR COMPANY: Maji Loop.");
    // Nothing of a mandate is read or given: no such source exists here.
    expect(JSON.stringify(input)).not.toMatch(/mandate|cheque|ticket/iu);
  });

  it("a first contact says so; no relationship reads nothing of one", async () => {
    const { port, written } = sources({ relationshipId: null });
    await port.prepare(request, { counterpart: "Savanna", said: "prep me" });
    expect(written[0]?.soFar).toBe(
      "No relationship on record yet: this would be the first contact.",
    );
  });

  it("a name they may not see is not prepared (the turn goes on as before)", async () => {
    const { port, written } = sources({ found: null });
    expect(
      await port.prepare(request, {
        counterpart: "Hidden Fund",
        said: "prep me",
      }),
    ).toBeNull();
    expect(written).toEqual([]);
  });

  it("related work already waiting comes back with the prep", async () => {
    const { port } = sources({
      waiting: [
        {
          summary:
            "Q's team: Prepare for the Savanna Seed Partners call without booking it.",
          targets: [
            { kind: "INVESTOR_ORGANISATION", investorOrganisationId: INVESTOR },
          ],
        },
        { summary: "Send Ledgerfold these 5 questions" },
      ],
    });
    const prep = await port.prepare(request, {
      counterpart: "Savanna Seed Partners",
      said: "Help me prepare for a first call with Savanna Seed Partners",
    });
    expect(prep?.waiting).toEqual([
      "Q's team: Prepare for the Savanna Seed Partners call without booking it.",
    ]);
  });
});
