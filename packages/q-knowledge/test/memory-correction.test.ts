import { describe, expect, it } from "vitest";

import {
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import {
  createMemoryCorrection,
  type MemoryItem,
  type RememberCommand,
} from "../src/index.js";

/** What Q remembers: the person's own correction, through the Write Gate. */

const ACTOR: ActorContext = {
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000001"),
  tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001"),
  organisationId: OrganisationIdSchema.parse(
    "d0000000-0000-4000-8000-000000000001",
  ),
  actorType: "HUMAN",
};
const OWN = "11111111-0000-4000-8000-000000000001";
const ITEM = {
  id: OWN,
  subject: null,
  memoryType: "pronunciation",
  memoryKey: "name.okafor",
  structuredValue: {},
  content: "Okafor is said oh-KAY-for.",
  quote: "okafor",
} as unknown as MemoryItem;

function build(refuse: RememberCommand["candidate"]["content"] | null = null) {
  const remembered: RememberCommand[] = [];
  const correction = createMemoryCorrection({
    list: () => Promise.resolve([ITEM]),
    remember: (command) => {
      remembered.push(command);
      return Promise.resolve(
        command.candidate.content === refuse
          ? { outcome: "REFUSED", reason: "SENSITIVE_CONTENT" }
          : { outcome: "REMEMBERED", reason: "SUPERSEDED_EARLIER", item: ITEM },
      );
    },
  });
  return { correction, remembered };
}

describe("correcting what Q remembers", () => {
  it("writes the person's own words under the same type and key, so the old one is superseded", async () => {
    const { correction, remembered } = build();
    await expect(
      correction.correct(ACTOR, OWN, "  Okafor is said oh-KAH-for. "),
    ).resolves.toBe("CORRECTED");
    expect(remembered).toHaveLength(1);
    expect(remembered[0]).toMatchObject({
      actor: ACTOR,
      writeMode: "USER_CONFIRMED",
      userTurns: ["Okafor is said oh-KAH-for."],
      candidate: {
        memoryType: "pronunciation",
        memoryKey: "name.okafor",
        content: "Okafor is said oh-KAH-for.",
        quote: "Okafor is said oh-KAH-for.",
      },
    });
  });

  it("an item that is not theirs is not found, and nothing is written", async () => {
    const { correction, remembered } = build();
    await expect(
      correction.correct(
        ACTOR,
        "11111111-0000-4000-8000-000000000002",
        "Something else.",
      ),
    ).resolves.toBe("NOT_FOUND");
    expect(remembered).toHaveLength(0);
  });

  it("says when the Write Gate refuses a secret, and refuses an empty correction", async () => {
    const { correction } = build("my pin code is 1234");
    await expect(
      correction.correct(ACTOR, OWN, "my pin code is 1234"),
    ).resolves.toBe("SENSITIVE");
    await expect(correction.correct(ACTOR, OWN, " a ")).resolves.toBe(
      "REFUSED",
    );
  });
});
