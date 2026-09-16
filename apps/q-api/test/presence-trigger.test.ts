import { describe, expect, it } from "vitest";

import type { OnboardingSessionView } from "@capital-q/contracts";
import type { PresenceService } from "@capital-q/q-presence";
import type { ActorContext } from "@capital-q/security";

import { createPresenceTrigger } from "../src/voice/presence-trigger.js";

/**
 * Arrival research: the company the person named, and the person who
 * named it.
 *
 * The person was missing. Only a company ever started a build, so the
 * online and personality profile Capital Q is supposed to hold about
 * somebody from the moment they arrive was never gathered at all.
 */

const ACTOR = {
  userId: "22222222-2222-4222-8222-222222222222",
  tenantId: "11111111-1111-4111-8111-111111111111",
  actorType: "HUMAN",
} as unknown as ActorContext;

const COMPANY_ID = "44444444-4444-4444-8444-444444444444";

function view(responses: Record<string, string>): OnboardingSessionView {
  return {
    session: { subject: { type: "COMPANY", id: COMPANY_ID } },
    responses: Object.entries(responses).map(([stepKey, value]) => ({
      stepKey,
      value,
    })),
  } as unknown as OnboardingSessionView;
}

type Built = {
  readonly subjectType: string;
  readonly subjectId: string;
  readonly name: string;
  readonly qualifier: string | null;
  readonly websiteUrl: string | null;
};

function build(options: { readonly personName?: string | null } = {}) {
  const builds: Built[] = [];
  const presence = {
    build: (command: {
      subject: { subjectType: string; subjectId: string };
      identity: {
        name: string;
        qualifier: string | null;
        websiteUrl: string | null;
      };
    }) => {
      builds.push({
        subjectType: command.subject.subjectType,
        subjectId: command.subject.subjectId,
        name: command.identity.name,
        qualifier: command.identity.qualifier,
        websiteUrl: command.identity.websiteUrl,
      });
      return Promise.resolve({ status: "COMPLETED" });
    },
  } as unknown as PresenceService;

  const trigger = createPresenceTrigger({
    presence,
    ...(options.personName === undefined
      ? {}
      : {
          people: { displayNameFor: () => options.personName ?? null },
        }),
  });
  return { builds, trigger };
}

/** The builds are detached; let the microtasks that start them run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("what Capital Q looks up when somebody arrives", () => {
  it("looks up the company and the person who named it", async () => {
    const { builds, trigger } = build({ personName: "Ada Okafor" });
    trigger.afterInterviewTurn(
      ACTOR,
      view({
        "F1.company_name": "The Vaultlyne",
        "F1.website": "https://thevaultlyne.com",
      }),
    );
    await settle();

    expect(builds).toHaveLength(2);
    expect(builds[0]).toEqual({
      subjectType: "COMPANY",
      subjectId: COMPANY_ID,
      name: "The Vaultlyne",
      qualifier: null,
      websiteUrl: "https://thevaultlyne.com",
    });
    // The person, told apart from their namesakes by the company they
    // just named, and never carrying the company's website as their own.
    expect(builds[1]).toEqual({
      subjectType: "PERSON",
      subjectId: ACTOR.userId,
      name: "Ada Okafor",
      qualifier: "The Vaultlyne",
      websiteUrl: null,
    });
  });

  it("looks up only the company when nothing knows the person's name", async () => {
    for (const personName of [null, "", " "]) {
      const { builds, trigger } = build({ personName });
      trigger.afterInterviewTurn(
        ACTOR,
        view({ "F1.company_name": "The Vaultlyne" }),
      );
      await settle();
      expect(builds.map((b) => b.subjectType)).toEqual(["COMPANY"]);
    }
  });

  it("looks up nothing at all before a company is named", async () => {
    const { builds, trigger } = build({ personName: "Ada Okafor" });
    trigger.afterInterviewTurn(ACTOR, view({}));
    trigger.afterInterviewTurn(ACTOR, view({ "F1.company_name": "A" }));
    await settle();
    expect(builds).toEqual([]);
  });

  it("never fails a turn when a build throws", async () => {
    const presence = {
      build: () => Promise.reject(new Error("upstream said no")),
    } as unknown as PresenceService;
    const trigger = createPresenceTrigger({
      presence,
      people: {
        displayNameFor: () => {
          throw new Error("profile unavailable");
        },
      },
    });
    expect(() => {
      trigger.afterInterviewTurn(
        ACTOR,
        view({ "F1.company_name": "The Vaultlyne" }),
      );
    }).not.toThrow();
    await settle();
  });
});
