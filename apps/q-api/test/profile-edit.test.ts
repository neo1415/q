import { describe, expect, it } from "vitest";

import {
  profileEditQuestion,
  spokenProfileEdit,
} from "../src/voice/profile-edit.js";

/**
 * Changing your own details by saying so, and only when it was clearly
 * asked for. The cost of a false match is Q offering to change something
 * nobody mentioned, so silence is the right answer whenever the reading is
 * not obvious.
 */
describe("a spoken request to change your own details", () => {
  it("reads the change and the value the person gave", () => {
    const cases: readonly (readonly [string, string, string])[] = [
      [
        "Change my website to vaultlyne.com",
        "websiteUrl",
        "https://vaultlyne.com",
      ],
      [
        "my website is www dot thevaultlyne dot com",
        "websiteUrl",
        "https://www.thevaultlyne.com",
      ],
      ["Please call me Dan", "displayName", "Dan"],
      ["my name is Daniel Okafor", "displayName", "Daniel Okafor"],
      [
        "update our company name to The Vaultlyne",
        "companyName",
        "The Vaultlyne",
      ],
      ["we're based in Lagos", "headquartersCity", "Lagos"],
      [
        "change our description to payments for African merchants",
        "shortDescription",
        "payments for African merchants",
      ],
    ];
    for (const [said, field, value] of cases) {
      const edit = spokenProfileEdit(said);
      expect(edit, said).not.toBeNull();
      expect(edit?.field, said).toBe(field);
      expect(edit?.value, said).toBe(value);
    }
  });

  it("drops the politeness people speak but do not mean", () => {
    expect(spokenProfileEdit("call me Dan, please")?.value).toBe("Dan");
    expect(spokenProfileEdit("we're based in Lagos now")?.value).toBe("Lagos");
    expect(spokenProfileEdit("call me Dan, thanks!")?.value).toBe("Dan");
  });

  it("says nothing to a question about a field", () => {
    for (const said of [
      "what is my website?",
      "do you know my name?",
      "where are we based?",
      "what does our description say?",
      "tell me about our website",
    ]) {
      expect(spokenProfileEdit(said), said).toBeNull();
    }
  });

  it("says nothing about somebody else's details", () => {
    for (const said of [
      "change Paystack's website to paystack.com",
      "their company name is Flutterwave",
      "set his name to Ezra",
    ]) {
      expect(spokenProfileEdit(said), said).toBeNull();
    }
  });

  it("refuses a value that is not one", () => {
    // A sentence about a website is not a website.
    expect(
      spokenProfileEdit("change my website to whatever you think is best"),
    ).toBeNull();
    // And nothing at all is not a value.
    expect(spokenProfileEdit("change my website to ")).toBeNull();
    expect(spokenProfileEdit(`call me ${"a".repeat(200)}`)).toBeNull();
  });

  it("says nothing to ordinary conversation", () => {
    for (const said of [
      "I think our market is bigger than that",
      "we raised a seed round last year",
      "can you look up Paystack",
      "yes",
      "",
    ]) {
      expect(spokenProfileEdit(said), said).toBeNull();
    }
  });

  it("reads the change back before making it", () => {
    const edit = spokenProfileEdit("change my website to vaultlyne.com");
    expect(edit).not.toBeNull();
    if (edit === null) return;
    const question = profileEditQuestion(edit);
    expect(question).toContain("https://vaultlyne.com");
    expect(question).toMatch(/Shall I\?$/);
  });
});
