import { describe, expect, it } from "vitest";
import { cardsLaneOf } from "../src/fast-lane.js";

import { QCardsIntentSchema } from "@capital-q/contracts";

import {
  cardsIntentOf,
  cardsLineOf,
  cardsRequestOf,
} from "../src/cards-request.js";

describe("cardsRequestOf (founder P5, by code)", () => {
  it.each([
    "Q, clear all cards",
    "clear all cards",
    "hide these cards",
    "clear the screen",
    "remove these",
    "dismiss all the cards",
    "Hey Q, please hide all the cards.",
    "clear the cards",
    "hide the cards",
    "get rid of the cards",
    "can you clear the screen please",
    "dismiss these",
    "remove all cards from the screen",
    "tidy up the screen",
  ])("%s -> HIDE_ALL", (said) => {
    expect(cardsRequestOf(said)).toEqual({ action: "HIDE_ALL" });
  });

  it.each([
    ["hide the connection cards", "CONNECTION"],
    ["Q, dismiss all the source cards", "SOURCE"],
    ["hide the recommendation cards", "RECOMMENDATION"],
    ["clear the needs you cards", "NEEDS_YOU"],
    ["hide the answer cards", "ANSWER"],
  ])("%s -> HIDE_CATEGORY", (said, category) => {
    expect(cardsRequestOf(said)).toEqual({ action: "HIDE_CATEGORY", category });
  });

  it.each([
    "show me the cards again",
    "show the cards again",
    "bring back the cards",
    "bring the cards back",
    "restore all the cards",
    "Q, show me my hidden cards",
  ])("%s -> RESTORE_ALL", (said) => {
    expect(cardsRequestOf(said)).toEqual({ action: "RESTORE_ALL" });
  });

  it("restores one by name, and hides one by name", () => {
    expect(cardsRequestOf("bring back the TensorGate card")).toEqual({
      action: "RESTORE_ONE",
      name: "TensorGate",
    });
    expect(cardsRequestOf("show me the Halyard Security card again")).toEqual({
      action: "RESTORE_ONE",
      name: "Halyard Security",
    });
    expect(cardsRequestOf("hide the TensorGate card")).toEqual({
      action: "HIDE_ONE",
      name: "TensorGate",
    });
  });

  it("restores one category", () => {
    expect(cardsRequestOf("bring back the connection cards")).toEqual({
      action: "RESTORE_ALL",
      category: "CONNECTION",
    });
  });

  it.each([
    "clear my calendar",
    "decline the connection request",
    "delete this document",
    "reject all the cards",
    "approve these",
    "cancel the meeting",
    "remove my calendar",
    "delete the cards",
    "show me the Q card",
    "show me the TensorGate card",
    "open the cards page",
    "clear my inbox",
    "hide my email",
    "what are the cards",
    "no wait, clear my calendar",
    "",
  ])("%j is not a cards request", (said) => {
    expect(cardsRequestOf(said)).toBeNull();
  });

  it("builds a valid typed intent and an honest line", () => {
    for (const said of [
      "clear all cards",
      "hide the connection cards",
      "hide the TensorGate card",
      "bring back the TensorGate card",
      "show me the cards again",
    ]) {
      const request = cardsRequestOf(said);
      expect(request).not.toBeNull();
      if (request === null) continue;
      expect(QCardsIntentSchema.safeParse(cardsIntentOf(request)).success).toBe(
        true,
      );
      expect(cardsLineOf(request).length).toBeGreaterThan(5);
    }
    expect(cardsLineOf({ action: "HIDE_ALL" })).toMatch(
      /nothing was approved/i,
    );
  });
});

describe("cardsLaneOf (the server's instant lane)", () => {
  it("answers by code with a typed intent and a spoken line", () => {
    const lane = cardsLaneOf("Q, clear all cards");
    expect(lane?.intent).toEqual({ kind: "CARDS", action: "HIDE_ALL" });
    expect(lane?.said).toMatch(/nothing was approved or removed/i);
    expect(cardsLaneOf("decline the connection request")).toBeNull();
  });
});
