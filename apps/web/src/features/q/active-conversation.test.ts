// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  initialConversationFor,
  NEW_CHAT_HREF,
  readActiveConversation,
  rememberActiveConversation,
} from "./active-conversation";

/**
 * Returning to Q keeps the tab's conversation (live 2026-10-28, investor):
 * Q opened a company page; coming back to a bare /home began a new
 * conversation and the thread was lost. The URL names one, else the tab's
 * pointer; only "New chat" starts over.
 */
const KEPT = "4bd57e55-e4dd-4c98-b1c3-c94003401853";
const NAMED = "7ac1999d-2ff7-41b1-9272-ce10453fdf1f";

describe("initialConversationFor", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("a bare /home resumes the conversation this tab was in", () => {
    rememberActiveConversation("home", KEPT);
    expect(initialConversationFor({ pathname: "/home", search: "" })).toBe(
      KEPT,
    );
  });

  it("the URL's own conversation wins over the tab's pointer", () => {
    rememberActiveConversation("home", KEPT);
    expect(
      initialConversationFor({ pathname: "/home", search: `?c=${NAMED}` }),
    ).toBe(NAMED);
  });

  it("'New chat' starts over even with a conversation kept", () => {
    rememberActiveConversation("home", KEPT);
    const url = new URL(NEW_CHAT_HREF, "https://capitalq.test");
    expect(
      initialConversationFor({ pathname: url.pathname, search: url.search }),
    ).toBeNull();
  });

  it("nothing kept and nothing named: a new conversation", () => {
    expect(
      initialConversationFor({ pathname: "/home", search: "" }),
    ).toBeNull();
    expect(readActiveConversation("home")).toBeNull();
  });

  it("away from the Q page, the tab's pointer is the dock's conversation", () => {
    rememberActiveConversation("home", KEPT);
    expect(
      initialConversationFor({ pathname: "/company/abc", search: "" }),
    ).toBe(KEPT);
  });

  it("a malformed id in the URL is input, not a conversation", () => {
    rememberActiveConversation("home", KEPT);
    expect(
      initialConversationFor({ pathname: "/home", search: "?c=not-an-id" }),
    ).toBe(KEPT);
  });
});
