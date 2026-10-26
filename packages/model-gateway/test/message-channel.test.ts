import { describe, expect, it } from "vitest";

import type { QToolCallOutcome } from "@capital-q/q-runtime";

import { firstContactOf } from "../src/q/first-contact.js";
import { chatInsteadOf } from "../src/q/message-channel.js";

/**
 * Live d3a197b4 (2026-10-26): an email may name its other side more than
 * once. The same words, prepared as a Capital Q message where the email
 * has no address, go to the relationship the email itself resolved: their
 * name for the other side first, as the email's authorize reads it.
 */

const noAddress = {
  callId: "e",
  toolName: "relationship.email.propose",
  toolVersion: 1,
  classification: "SIDE_EFFECT",
  status: "SUCCEEDED",
  failureCode: null,
  sensitivity: "CONFIDENTIAL",
  result: { ok: true, data: { status: "NO_RECIPIENT" } },
  latencyMs: 1,
} as QToolCallOutcome;

describe("the Capital Q message instead of an email", () => {
  it("names the other side as the email resolved it: their name first", () => {
    expect(
      chatInsteadOf(
        {
          name: "propose_email",
          arguments: {
            companyId: "61000000-0000-4000-8000-000000000001",
            counterpartName: "Savanna Seed Partners",
            body: "Hi Savanna team.",
          },
        },
        noAddress,
      ),
    ).toEqual({
      counterpartName: "Savanna Seed Partners",
      body: "Hi Savanna team.",
    });
  });

  it("an id alone is still that id", () => {
    expect(
      chatInsteadOf(
        {
          name: "propose_email",
          arguments: {
            relationshipId: "88888888-0000-4000-8000-0000000000e1",
            body: "Hi.",
          },
        },
        noAddress,
      ),
    ).toEqual({
      relationshipId: "88888888-0000-4000-8000-0000000000e1",
      body: "Hi.",
    });
  });
});

describe("the first contact for a message that could not reach them", () => {
  it("names the company as the message resolved it: their name first", () => {
    expect(
      firstContactOf(
        {
          name: "propose_chat_message",
          arguments: {
            companyId: "61000000-0000-4000-8000-000000000001",
            counterpartName: "Basketari",
            body: "Hi.",
          },
        },
        {
          ...noAddress,
          result: { ok: true, data: { status: "NOT_CONNECTED" } },
        },
      ),
    ).toEqual({ company: "Basketari", note: "Hi." });
  });
});
