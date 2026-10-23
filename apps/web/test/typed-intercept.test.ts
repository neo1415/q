import { describe, expect, it } from "vitest";

import {
  interceptTyped,
  setTypedInterceptor,
} from "@/features/q/typed-intercept";

describe("typed messages taken before they reach Q (v6 step commands)", () => {
  it("takes only what the holder takes, and nothing once released", () => {
    expect(interceptTyped("next")).toBe(false);
    const release = setTypedInterceptor((text) => text === "next");
    expect(interceptTyped("next")).toBe(true);
    expect(interceptTyped("what is your moat?")).toBe(false);
    release();
    expect(interceptTyped("next")).toBe(false);
  });

  it("never swallows a message when the holder throws", () => {
    const release = setTypedInterceptor(() => {
      throw new Error("boom");
    });
    expect(interceptTyped("next")).toBe(false);
    release();
  });

  it("the latest holder decides first; what it declines goes to the one before", () => {
    const trigger = setTypedInterceptor((text) => text === "pitch yourself");
    const story = setTypedInterceptor((text) => text === "next");
    expect(interceptTyped("next")).toBe(true);
    expect(interceptTyped("pitch yourself")).toBe(true);
    expect(interceptTyped("what is your moat?")).toBe(false);
    story();
    expect(interceptTyped("next")).toBe(false);
    expect(interceptTyped("pitch yourself")).toBe(true);
    trigger();
  });

  it("a throwing holder passes the message to the one before it", () => {
    const below = setTypedInterceptor(() => true);
    const above = setTypedInterceptor(() => {
      throw new Error("boom");
    });
    expect(interceptTyped("next")).toBe(true);
    above();
    below();
  });

  it("a stale release leaves the newer holder in place", () => {
    const first = setTypedInterceptor(() => true);
    const second = setTypedInterceptor(() => true);
    first();
    expect(interceptTyped("anything")).toBe(true);
    second();
  });
});
