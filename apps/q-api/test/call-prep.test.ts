import type { CallPrepWriter } from "@capital-q/model-gateway/q";
import type { QAnswerRequest } from "@capital-q/q-runtime";
import {
  isCallPrepUnresolved,
  type CallPrep,
  type CallPrepUnresolved,
} from "@capital-q/q-specialists";
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
  theyWant: null,
};

/** A prepared call, or null for none or an unresolved counterpart. */
function prepOf(value: CallPrep | CallPrepUnresolved | null): CallPrep | null {
  return value === null || isCallPrepUnresolved(value) ? null : value;
}

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
    const prep = prepOf(
      await port.prepare(request, {
        counterpart: "Savanna Seed Partners",
        said: "Help me prepare for a first call with Savanna Seed Partners",
      }),
    );
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

  it("a name they may not open is prepared from the name and their own record only", async () => {
    const { port, written } = sources({ found: null });
    const prep = prepOf(
      await port.prepare(request, {
        counterpart: "Hidden Fund",
        said: "prep me",
      }),
    );
    expect(prep?.counterpartName).toBe("Hidden Fund");
    expect(written[0]?.counterpartName).toBe("Hidden Fund");
    expect(written[0]?.counterpartProfile).toBe("");
    expect(written[0]?.soFar).toBe(
      "Nothing about them is on record that they can see.",
    );
    expect(written[0]?.ownRecord).toBe("THEIR COMPANY: Maji Loop.");
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
    const prep = prepOf(
      await port.prepare(request, {
        counterpart: "Savanna Seed Partners",
        said: "Help me prepare for a first call with Savanna Seed Partners",
      }),
    );
    expect(prep?.waiting).toEqual([
      "Q's team: Prepare for the Savanna Seed Partners call without booking it.",
    ]);
  });
});

describe("an investor's call prep (owner QA O-I12)", () => {
  it("resolves the company among what they may see, and the prep is from the investor's side", async () => {
    const written: Parameters<CallPrepWriter>[1][] = [];
    const looked: string[] = [];
    const COMPANY = "6c6c6c6c-6c6c-4c6c-8c6c-6c6c6c6c6c6c";
    const port = createCallPrepPort({
      material: () => ({
        viewer: () =>
          Promise.resolve({
            role: "INVESTOR",
            organisationName: "Adedaniel Capital",
          }),
        counterpart: (_actor, kind, id) =>
          Promise.resolve(
            kind === "COMPANY" && id === COMPANY
              ? {
                  name: "Spheros",
                  profile: "Company: Spheros",
                  relationshipId: null,
                }
              : null,
          ),
        theirMessages: () => Promise.resolve(""),
        theirCalls: () => Promise.resolve(""),
        counterpartMaterial: () =>
          Promise.resolve({
            text: "THEIR DECK: 10 clients, 2 paying.",
            sources: [],
          }),
        ownMaterial: () => Promise.resolve({ text: "", sources: [] }),
        upcomingMeetings: () => Promise.resolve([]),
      }),
      findByName: (_actor, kind, name) => {
        looked.push(`${kind}:${name}`);
        return Promise.resolve(COMPANY);
      },
      write: (_request, input) => {
        written.push(input);
        return Promise.resolve({ ...RESULT, theyWant: "A cheque and intros." });
      },
    });
    const prep = prepOf(
      await port.prepare(request, {
        counterpart: "Spheros",
        said: "Prep me for my call with Spheros",
      }),
    );
    expect(looked).toEqual(["COMPANY:Spheros"]);
    expect(written[0]?.viewerRole).toBe("INVESTOR");
    // The company's claims are its material, never the investor's own record.
    expect(written[0]?.counterpartProfile).toContain(
      "THEIR DECK: 10 clients, 2 paying.",
    );
    expect(written[0]?.ownRecord).toBe("");
    expect(prep?.viewerRole).toBe("INVESTOR");
    expect(prep?.theyWant).toBe("A cheque and intros.");
  });
});

/**
 * RC4 (voice audit 15 Nov 2026, F7-04, run 5ea70816): "If you were
 * preparing me for an investor meeting…" was read with the counterpart
 * "investor", the name search matched QInvest, and an unrelated investor
 * was briefed (twice). Replays of that turn against the port.
 */
describe("a meeting named only by its role (RC4, F7-04)", () => {
  const QINVEST = "9e9e9e9e-9e9e-4e9e-8e9e-9e9e9e9e9e9e";
  const ZINO = "1d1d1d1d-1d1d-4d1d-8d1d-1d1d1d1d1d1d";
  const VENTURES = "2e2e2e2e-2e2e-4e2e-8e2e-2e2e2e2e2e2e";
  const said =
    "If you were preparing me for an investor meeting, what would you tell me to work on first";
  function founder(options: {
    readonly relationships: readonly {
      relationshipId: string;
      id: string;
      name: string;
      state: string;
    }[];
    readonly meetings?: readonly string[];
  }) {
    const looked: string[] = [];
    const written: Parameters<CallPrepWriter>[1][] = [];
    const names: Record<string, string> = {
      [QINVEST]: "QInvest",
      [ZINO]: "Zino Aviation",
      [VENTURES]: "Ventures Platform",
    };
    const port = createCallPrepPort({
      material: () => ({
        viewer: () =>
          Promise.resolve({ role: "FOUNDER", organisationName: "Tensorgate" }),
        counterpart: (_actor, _kind, id) =>
          Promise.resolve(
            names[id] === undefined
              ? null
              : {
                  name: names[id] ?? "",
                  profile: `Name: ${names[id] ?? ""}`,
                  relationshipId:
                    options.relationships.find((row) => row.id === id)
                      ?.relationshipId ?? null,
                },
          ),
        theirMessages: () => Promise.resolve(""),
        theirCalls: () => Promise.resolve(""),
        counterpartMaterial: () => Promise.resolve({ text: "", sources: [] }),
        ownMaterial: () => Promise.resolve({ text: "", sources: [] }),
        relationships: () =>
          Promise.resolve(
            options.relationships.map((row) => ({
              ...row,
              kind: "INVESTOR_ORGANISATION" as const,
            })),
          ),
        upcomingMeetings: () =>
          Promise.resolve(
            (options.meetings ?? []).map((relationshipId) => ({
              meetingId: `m-${relationshipId}`,
              relationshipId,
              startsAt: "2026-11-16T09:00:00Z",
              purpose: "Follow-up call",
            })),
          ),
      }),
      // The live search: "investor" matched QInvest.
      findByName: (_actor, kind, name) => {
        looked.push(`${kind}:${name}`);
        return Promise.resolve(QINVEST);
      },
      write: (_request, input) => {
        written.push(input);
        return Promise.resolve(RESULT);
      },
    });
    return { port, looked, written };
  }
  const zino = {
    relationshipId: "r-zino",
    id: ZINO,
    name: "Zino Aviation",
    state: "IN_DILIGENCE",
  };
  const ventures = {
    relationshipId: "r-ventures",
    id: VENTURES,
    name: "Ventures Platform",
    state: "CONNECTED",
  };

  it("several of their investors: asks which, by name; QInvest is never briefed", async () => {
    const { port, looked, written } = founder({
      relationships: [zino, ventures],
    });
    const result = await port.prepare(request, {
      counterpart: "investor",
      said,
    });
    expect(result).toEqual({
      kind: "WHICH",
      options: ["Zino Aviation", "Ventures Platform"],
    });
    expect(looked).toEqual([]);
    expect(written).toEqual([]);
  });

  it("the one investor they have a meeting with is the one prepared", async () => {
    const { port, written } = founder({
      relationships: [zino, ventures],
      meetings: ["r-zino"],
    });
    const prep = prepOf(
      await port.prepare(request, { counterpart: "an investor", said }),
    );
    expect(prep?.counterpartName).toBe("Zino Aviation");
    expect(written[0]?.counterpartName).toBe("Zino Aviation");
  });

  it("none on record: says none, and prepares nobody", async () => {
    const { port, written } = founder({ relationships: [] });
    const result = await port.prepare(request, {
      counterpart: "investor meeting",
      said,
    });
    expect(result).toEqual({ kind: "NONE", role: "INVESTOR" });
    expect(written).toEqual([]);
  });

  it("a record the search found whose name they never said is not prepared as theirs", async () => {
    const { port, written } = founder({ relationships: [] });
    const prep = prepOf(
      await port.prepare(request, { counterpart: "Kestrel Fund", said }),
    );
    expect(written[0]?.counterpartName).toBe("Kestrel Fund");
    expect(written[0]?.counterpartProfile).toBe("");
    expect(prep?.counterpart).toBeNull();
  });
});
