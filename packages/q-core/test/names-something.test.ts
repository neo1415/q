import { describe, expect, it } from "vitest";

import { namesSomething } from "../src/index.js";

/**
 * Whether there is anything in the words worth a trip to the public web.
 * Small talk is not; a name, an address or a quoted thing is.
 */
describe("whether a message names something to look up", () => {
  it("finds nothing to look up in small talk", () => {
    for (const said of [
      "whats up?",
      "how are you?",
      "cn you hear me?",
      "thanks",
      "ok go on",
      "what is a SAFE note?",
      "what is our runway",
    ]) {
      expect(namesSomething(said), said).toBe(false);
    }
  });

  it("finds a name, however it is written", () => {
    for (const said of [
      "tell me about Paystack",
      "who is the current CEO of paystack",
      "look up kuda",
      "what does Flutterwave do",
      "search for 'The Vaultlyne'",
      "read vaultlyne.com",
      "anything on @paystack",
    ]) {
      expect(namesSomething(said), said).toBe(true);
    }
  });
});
