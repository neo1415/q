import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ActorContextSchema } from "@capital-q/security";

import {
  createWorkforcePorts,
  type WorkforcePortServices,
} from "../src/composition/workforce/ports.js";

/**
 * Founder 2026-10-09: a job's agent sends through the same hard rule at
 * the send itself -- not into a thread where its side already wrote and
 * followed up, and not into one it could not read.
 */

const actor = ActorContextSchema.parse({
  tenantId: randomUUID(),
  userId: randomUUID(),
  organisationId: randomUUID(),
  actorType: "HUMAN",
});
const owner = { tenantId: actor.tenantId, userId: actor.userId };
const NOW = new Date("2026-10-20T10:00:00Z");

function ports(
  messages: readonly { from: "YOU" | "OTHER_SIDE"; sentAt: string }[] | null,
) {
  const sent: string[] = [];
  const services = {
    readChat: () =>
      messages === null
        ? Promise.reject(new Error("unreadable"))
        : Promise.resolve({
            blocked: false,
            messages: messages.map((one, index) => ({
              id: String(index),
              from: one.from,
              senderName: one.from === "YOU" ? "Ada" : "Zino",
              text: "words",
              sentAt: one.sentAt,
            })),
          }),
    sendChat: (input: { body: string }) => {
      sent.push(input.body);
      return Promise.resolve(null);
    },
    now: () => NOW,
  } as unknown as WorkforcePortServices;
  return {
    sent,
    port: createWorkforcePorts(services, () => Promise.resolve())(actor),
  };
}

describe("a job's send goes through the send guard", () => {
  it("replies when they wrote last", async () => {
    const { port, sent } = ports([
      { from: "YOU", sentAt: "2026-10-12T10:00:00Z" },
      { from: "OTHER_SIDE", sentAt: "2026-10-19T10:00:00Z" },
    ]);
    expect(await port.send(owner, "rel", "wf-key-0001", "Thanks!")).toBe(true);
    expect(sent).toEqual(["Thanks!"]);
  });

  it("sends nothing after a first message and a follow-up went unanswered", async () => {
    const { port, sent } = ports([
      { from: "YOU", sentAt: "2026-10-05T10:00:00Z" },
      { from: "YOU", sentAt: "2026-10-09T10:00:00Z" },
    ]);
    expect(await port.send(owner, "rel", "wf-key-0002", "Again?")).toBe(false);
    expect(sent).toEqual([]);
  });

  it("sends nothing into a thread it could not read", async () => {
    const { port, sent } = ports(null);
    expect(await port.send(owner, "rel", "wf-key-0003", "Hello")).toBe(false);
    expect(sent).toEqual([]);
  });
});
