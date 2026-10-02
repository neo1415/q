import { describe, expect, it } from "vitest";

import { ownIndex } from "@capital-q/app-actions";
import type { PermittedContextPlan } from "@capital-q/contracts";
import type { InteractionSignalService } from "@capital-q/discovery";
import type { MediaAsset } from "@capital-q/media";

import {
  appActionKey,
  createDefaultQTools,
  createQToolExecutor,
  createQToolRegistry,
} from "../src/index.js";
import {
  actorA,
  actorB,
  COMPANY_A,
  contextFor,
  fakePorts,
  planFor,
} from "./support.js";

/**
 * ADR 0040: Q tools generated from the app's action registry. The same
 * declaration the route runs: Save / Pass act at once as the person
 * (idempotent on the run), a pitch's audience is prepared for approval,
 * names are resolved by one coercion, and read_my reads what the page
 * shows.
 */

function ownPlan(actor = actorA): PermittedContextPlan {
  const plan = planFor(actor, "GENERAL_QUESTION", [
    { kind: "OWN_Q_CONVERSATION", sensitivity: "CONFIDENTIAL" },
    { kind: "NETWORK_VISIBLE_DATA", sensitivity: "NETWORK_VISIBLE" },
  ]);
  return {
    ...plan,
    scopes: plan.scopes.map((scope) =>
      scope.kind === "OWN_Q_CONVERSATION"
        ? { ...scope, filter: { ...scope.filter, userId: actor.userId } }
        : scope,
    ),
  };
}

const TALUM = "55555555-0000-4000-8000-0000000000a1";
const PITCH = "38579af4-cfa2-4fd8-9381-d9f562768c03";

const pitch = (overrides: Partial<MediaAsset> = {}): MediaAsset =>
  ({
    id: PITCH,
    ownerType: "COMPANY",
    ownerId: COMPANY_A,
    purpose: "FOUNDER_PITCH",
    status: "READY",
    moderationStatus: "ALLOWED",
    playbackPolicy: "PRIVATE",
    audience: "NETWORK",
    title: "Nixo pitch",
    supersededAt: null,
    readyAt: "2026-10-02T08:04:06.000Z",
    createdAt: "2026-10-02T08:03:36.000Z",
    durationSeconds: 60,
    version: 10,
    ...overrides,
  }) as MediaAsset;

function world(options: { refuse?: boolean } = {}) {
  const decided: {
    type: string;
    companyId: string;
    clientEventId: string;
  }[] = [];
  const prepared: { actionType: string; payload: unknown }[] = [];
  const interactions: Pick<InteractionSignalService, "decide"> = {
    decide: (type, command) => {
      decided.push({
        type,
        companyId: command.companyId,
        clientEventId: command.clientEventId,
      });
      return Promise.resolve(
        (options.refuse === true
          ? { kind: "REFUSED", refusal: "NOT_VISIBLE" }
          : {
              kind: "RECORDED",
              deduplicated: false,
              state: { saved: type === "SAVE", passed: type === "PASS" },
            }) as never,
      );
    },
  };
  const ports = fakePorts({
    investorFeed: {
      page: () => Promise.resolve(null),
      decisions: () =>
        Promise.resolve([
          {
            companyId: TALUM,
            name: "Talum",
            stageCode: "SEED",
            headquartersCountry: "GB",
            decision: "PASSED" as const,
          },
        ]),
    },
    appActions: {
      interactions,
      ownCompanyId: (actor) =>
        Promise.resolve(actor.userId === actorA.userId ? COMPANY_A : null),
      media: {
        listCompanyMedia: () => Promise.resolve([pitch()]),
        setPitchDetails: () => Promise.reject(new Error("not on Q's path")),
      },
    },
    appApprovals: {
      prepareForApproval: (entry) => {
        prepared.push({ actionType: entry.actionType, payload: entry.payload });
        return "PREPARED";
      },
    },
  });
  const executor = createQToolExecutor({
    registry: createQToolRegistry(createDefaultQTools(ports)),
  });
  return { executor, decided, prepared };
}

const call = (name: string, args: Record<string, unknown>) => ({
  callId: `c-${name}`,
  name,
  arguments: args,
});

describe("the feed's decisions, generated from the registry", () => {
  it("undoes a pass on a company named as they said it, from Home, with a key the run derives", async () => {
    const { executor, decided } = world();
    const outcome = await executor.execute(
      call("unpass_company", { company: "talum" }),
      contextFor(actorA, ownPlan()),
    );
    expect(outcome.result).toMatchObject({
      ok: true,
      data: { status: "DONE" },
    });
    expect(JSON.stringify(outcome.result)).toContain("Talum");
    expect(decided.map(({ type, companyId }) => [type, companyId])).toEqual([
      ["UNPASS", TALUM],
    ]);
    expect(decided[0]?.clientEventId).toMatch(/^q-[0-9a-f]{40}$/);
    // Same run, same action, same input: the same key, recorded once.
    expect(decided[0]?.clientEventId).toBe(
      appActionKey(
        contextFor(actorA, ownPlan()).runId,
        "discovery.company.unpass",
        { company: TALUM },
      ),
    );
  });

  it("says plainly when the service refuses (a company on screen elsewhere is R35's test)", async () => {
    const refused = world({ refuse: true });
    const outcome = await refused.executor.execute(
      call("pass_company", { company: "Talum" }),
      contextFor(actorA, ownPlan()),
    );
    expect(outcome.result).toMatchObject({
      ok: true,
      data: { status: "NOT_DONE" },
    });
  });
});

describe("a pitch's audience, generated from the registry (live 2026-10-02, Nixo)", () => {
  it("'Let investors play my pitch video' prepares ONE approval: audience and playback together", async () => {
    const { executor, prepared } = world();
    const outcome = await executor.execute(
      call("set_pitch_sharing", {
        pitch: "my pitch video",
        sharing: "INVESTORS",
      }),
      contextFor(actorA, ownPlan()),
    );
    expect(outcome.result).toMatchObject({
      ok: true,
      data: { status: "PREPARED" },
    });
    expect(prepared).toEqual([
      {
        actionType: "app.pitch.details.set",
        payload: {
          companyId: COMPANY_A,
          mediaAssetId: PITCH,
          audience: "INVESTORS",
          playbackPolicy: "AUTHORISED",
        },
      },
    ]);
  });

  it("prepares nothing for someone with no company, or a pitch that isn't theirs", async () => {
    const { executor, prepared } = world();
    const stranger = await executor.execute(
      call("set_pitch_sharing", { pitch: "my pitch", sharing: "NETWORK" }),
      contextFor(actorB, ownPlan(actorB)),
    );
    expect(stranger.status).not.toBe("SUCCEEDED");
    const unknown = await executor.execute(
      call("set_pitch_sharing", {
        pitch: "Series B teaser",
        sharing: "NETWORK",
      }),
      contextFor(actorA, ownPlan()),
    );
    expect(unknown.status).not.toBe("SUCCEEDED");
    expect(prepared).toEqual([]);
  });
});

describe("read_my", () => {
  it("reads their pitch videos as the pitch page states them, never 'no record'", async () => {
    const { executor } = world();
    const outcome = await executor.execute(
      call("read_my", { kind: "media" }),
      contextFor(actorA, ownPlan()),
    );
    expect(outcome.result).toMatchObject({
      ok: true,
      data: {
        kind: "media",
        available: true,
        items: [
          {
            id: PITCH,
            title: "Nixo pitch",
            status: "private: only their organisation can play it",
            facts: {
              whoCanWatch: "only their organisation",
              playableByInvestors: false,
            },
          },
        ],
      },
    });
  });

  it("names an untitled pitch by their company, never the bare word 'Pitch' (parity eval 2026-10-02)", async () => {
    const ports = fakePorts({
      appActions: {
        ownCompanyId: () => Promise.resolve(COMPANY_A),
        ownCompanyName: () => Promise.resolve("Ajopot"),
        media: {
          listCompanyMedia: () => Promise.resolve([pitch({ title: null })]),
          setPitchDetails: () => Promise.reject(new Error("unused")),
        },
      },
    });
    const executor = createQToolExecutor({
      registry: createQToolRegistry(createDefaultQTools(ports)),
    });
    const outcome = await executor.execute(
      call("read_my", { kind: "media" }),
      contextFor(actorA, ownPlan()),
    );
    expect(outcome.result).toMatchObject({
      ok: true,
      data: { items: [{ id: PITCH, title: "Ajopot pitch video" }] },
    });
  });

  it("reads the companies in their Discover feed now, so 'not in Saved' is never 'not in Discover'", async () => {
    const ports = fakePorts({
      appActions: {
        feed: () =>
          Promise.resolve([
            {
              id: TALUM,
              title: "Ajopot",
              status: "#1 in their feed",
              at: null,
              facts: { stage: "seed" },
            },
          ]),
      },
    });
    const executor = createQToolExecutor({
      registry: createQToolRegistry(createDefaultQTools(ports)),
    });
    const outcome = await executor.execute(
      call("read_my", { kind: "feed" }),
      contextFor(actorA, ownPlan()),
    );
    expect(outcome.result).toMatchObject({
      ok: true,
      data: {
        kind: "feed",
        available: true,
        items: [{ title: "Ajopot", status: "#1 in their feed" }],
      },
    });
    const index = await ownIndex(
      {
        feed: () =>
          Promise.resolve([
            {
              id: TALUM,
              title: "Ajopot",
              status: "#1 in their feed",
              at: null,
              facts: {},
            },
          ]),
      },
      actorA,
    );
    expect(index).toEqual([
      {
        kind: "feed",
        label: "Companies in their Discover feed now",
        total: 1,
        titles: ["Ajopot (#1 in their feed)"],
      },
    ]);
  });

  it("says a kind is not readable here, rather than empty", async () => {
    const { executor } = world();
    const outcome = await executor.execute(
      call("read_my", { kind: "rehearsals" }),
      contextFor(actorA, ownPlan()),
    );
    expect(outcome.result).toMatchObject({
      ok: true,
      data: { available: false, items: [] },
    });
  });
});

describe("profile and records, generated from the registry (ADR 0040 step 2)", () => {
  function founderPlan(actor = actorA): PermittedContextPlan {
    const plan = planFor(actor, "OWN_COMPANY_QUESTION", [
      { kind: "OWN_Q_CONVERSATION", sensitivity: "CONFIDENTIAL" },
      {
        kind: "COMPANY_PROFILE",
        sensitivity: "CONFIDENTIAL",
        companyId: COMPANY_A,
      },
    ]);
    return {
      ...plan,
      scopes: plan.scopes.map((scope) =>
        scope.kind === "OWN_Q_CONVERSATION"
          ? { ...scope, filter: { ...scope.filter, userId: actor.userId } }
          : scope,
      ),
    };
  }

  function records(options: { readonly taken?: boolean } = {}) {
    const prepared: { actionType: string; payload: unknown }[] = [];
    const writes: string[] = [];
    const never = (what: string) => () => {
      writes.push(what);
      return Promise.reject(new Error("Q prepares; it never writes here"));
    };
    const ports = fakePorts({
      appActions: {
        ownCompanyId: () => Promise.resolve(COMPANY_A),
        ownInvestorOrganisationId: () => Promise.resolve(null),
        companies: {
          getCompany: () => Promise.resolve({ version: 7 } as never),
          getMyCompanyMembership: () =>
            Promise.resolve({
              relationshipType: "team_member",
              isFounder: true,
              businessTitle: "COO",
            } as never),
          updateCompany: never("company"),
          upsertMyCompanyMembership: never("membership"),
          updateMyFounderProfile: never("founder"),
          updateCompanyTeamFacts: never("facts"),
        },
        publicIdentity: {
          getCard: () => Promise.resolve(null),
          claimHandle: never("handle"),
          updateCard: never("card"),
          handleAvailable: () => Promise.resolve(options.taken !== true),
        },
        people: { read: never("read"), update: never("person") },
      },
      appApprovals: {
        prepareForApproval: (entry) => {
          prepared.push({
            actionType: entry.actionType,
            payload: entry.payload,
          });
          return "PREPARED";
        },
      },
    });
    const executor = createQToolExecutor({
      registry: createQToolRegistry(createDefaultQTools(ports)),
    });
    return { executor, prepared, writes };
  }

  it("'change our website' prepares ONE card on their own company, the website as a URL, applied at the version current when approved", async () => {
    const { executor, prepared, writes } = records();
    const outcome = await executor.execute(
      call("update_company_profile", {
        websiteUrl: "kivu-freight.example",
        headquartersCity: "Nairobi",
      }),
      contextFor(actorA, founderPlan()),
    );
    expect(outcome.result).toMatchObject({
      ok: true,
      data: { status: "PREPARED" },
    });
    expect(prepared).toEqual([
      {
        actionType: "app.company.profile.update",
        payload: {
          companyId: COMPANY_A,
          input: {
            websiteUrl: "https://kivu-freight.example",
            headquartersCity: "Nairobi",
            expectedVersion: 7,
          },
          atLatest: true,
        },
      },
    ]);
    expect(writes).toEqual([]);
  });

  it("a role change keeps what they did not mention, as their membership holds it", async () => {
    const { executor, prepared } = records();
    await executor.execute(
      call("set_my_company_role", { businessTitle: "CEO" }),
      contextFor(actorA, founderPlan()),
    );
    expect(prepared[0]?.payload).toEqual({
      companyId: COMPANY_A,
      input: {
        relationshipType: "team_member",
        isFounder: true,
        businessTitle: "CEO",
      },
    });
  });

  it("refuses a taken or malformed handle in words before anyone is asked", async () => {
    const taken = records({ taken: true });
    const outcome = await taken.executor.execute(
      call("claim_q_card_handle", {
        subject: "COMPANY",
        handle: "@KivuFreight",
      }),
      contextFor(actorA, founderPlan()),
    );
    expect(JSON.stringify(outcome.result)).toContain(
      "@kivufreight isn't available",
    );
    expect(taken.prepared).toEqual([]);
    const malformed = records();
    const bad = await malformed.executor.execute(
      call("claim_q_card_handle", { subject: "COMPANY", handle: "-k-" }),
      contextFor(actorA, founderPlan()),
    );
    expect(JSON.stringify(bad.result)).toContain("A handle is 3 to 30");
    expect(malformed.prepared).toEqual([]);
  });

  it("their own profile binds to them; a value that does not fit says which field", async () => {
    const { executor, prepared } = records();
    await executor.execute(
      call("update_my_profile", { timeZone: "Africa/Lagos" }),
      contextFor(actorA, founderPlan()),
    );
    expect(prepared).toEqual([
      {
        actionType: "app.person.profile.update",
        payload: { userId: actorA.userId, input: { timeZone: "Africa/Lagos" } },
      },
    ]);
    const misfit = await executor.execute(
      call("update_my_profile", { timeZone: "Lagos time" }),
      contextFor(actorA, founderPlan()),
    );
    expect(JSON.stringify(misfit.result)).toContain(
      "timeZone needs to be a time zone such as Africa/Lagos",
    );
    expect(prepared).toHaveLength(1);
  });

  it("an investor organisation's tools are not offered on a founder's own-company turn", async () => {
    const { executor, prepared } = records();
    const outcome = await executor.execute(
      call("update_investor_profile", { displayName: "Kivu Capital" }),
      contextFor(actorA, founderPlan()),
    );
    expect(outcome.result).toMatchObject({ ok: false });
    expect(prepared).toEqual([]);
  });
});
