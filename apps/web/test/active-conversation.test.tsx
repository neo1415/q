// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which conversation each Q surface is in, for this tab (UX2 item 2).
 *
 * Reproduced on the head: a reload of /home?c=… reopened the chat and Q
 * recalled what was said in it, but going Home -> Discover -> Home through
 * the navigation opened an empty new chat, the Q sheet forgot its thread
 * whenever it closed, and "Ask Q" on Home dropped the open chat. These
 * hold the pointer that fixes that: per surface, validated on the way out
 * of storage, forgotten on sign-out, and never shared across surfaces.
 */

vi.mock("next/navigation", () => ({ usePathname: () => "/discover" }));

const {
  forgetActiveConversations,
  homeHref,
  readActiveConversation,
  rememberActiveConversation,
} = await import("../src/features/q/active-conversation");
const { MobileNavigation } =
  await import("../src/components/app-shell/mobile-navigation");

const A = "3c8363ca-cb80-4d51-9cfa-ffa48bfcc9b7";
const B = "0f5b0f0e-6a53-4c1f-9a43-3b0e7c5d2a11";

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("the per-tab pointer", () => {
  it("is empty until a surface names a conversation", () => {
    expect(readActiveConversation("home")).toBeNull();
    expect(homeHref(null)).toBe("/home");
  });

  it("keeps one conversation per surface, and never lends it to another", () => {
    rememberActiveConversation("home", A);
    rememberActiveConversation("sheet:company:x", B);
    expect(readActiveConversation("home")).toBe(A);
    expect(readActiveConversation("sheet:company:x")).toBe(B);
    expect(readActiveConversation("sheet:company:y")).toBeNull();
  });

  it("forgets a surface's conversation when told it has none (New chat, or refused)", () => {
    rememberActiveConversation("home", A);
    rememberActiveConversation("home", null);
    expect(readActiveConversation("home")).toBeNull();
  });

  it("treats what is in storage as input: anything that is not a conversation id is ignored", () => {
    window.sessionStorage.setItem(
      "cq.q.active-conversation.v1",
      JSON.stringify({ home: "../../admin", "sheet:none": 42 }),
    );
    expect(readActiveConversation("home")).toBeNull();
    expect(readActiveConversation("sheet:none")).toBeNull();
    window.sessionStorage.setItem("cq.q.active-conversation.v1", "{not json");
    expect(readActiveConversation("home")).toBeNull();
  });

  it("refuses to store something that is not a conversation id", () => {
    rememberActiveConversation("home", "javascript:alert(1)");
    expect(readActiveConversation("home")).toBeNull();
  });

  it("is forgotten entirely on sign-out", () => {
    rememberActiveConversation("home", A);
    rememberActiveConversation("sheet:none", B);
    forgetActiveConversations();
    expect(readActiveConversation("home")).toBeNull();
    expect(readActiveConversation("sheet:none")).toBeNull();
  });

  it("builds Home's address from it", () => {
    expect(homeHref(A)).toBe(`/home?c=${A}`);
  });
});

describe("the navigation's Home", () => {
  it("returns to the conversation Home is in, and follows it when it changes", () => {
    render(<MobileNavigation />);
    const home = () => screen.getByRole("link", { name: /Home/ });
    expect(home().getAttribute("href")).toBe("/home");

    act(() => rememberActiveConversation("home", A));
    expect(home().getAttribute("href")).toBe(`/home?c=${A}`);

    // New chat: Home with none is a new chat again.
    act(() => rememberActiveConversation("home", null));
    expect(home().getAttribute("href")).toBe("/home");
  });

  it("leaves the other destinations alone", () => {
    rememberActiveConversation("home", A);
    render(<MobileNavigation />);
    expect(
      screen.getByRole("link", { name: /Discover/ }).getAttribute("href"),
    ).toBe("/discover");
  });
});
