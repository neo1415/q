import { describe, expect, it } from "vitest";

import {
  isApplePlatform,
  opensQ,
  qShortcutHint,
} from "../src/components/app-shell/q-shortcut";

const key = (
  k: string,
  mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {},
) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, ...mods });

/** Client feedback UX-05 (2026-11-04): Control/Command+K, never Q. */
describe("the shortcut that opens Q", () => {
  it("opens on Command+K and Control+K, either case", () => {
    expect(opensQ(key("k", { metaKey: true }))).toBe(true);
    expect(opensQ(key("K", { ctrlKey: true }))).toBe(true);
  });

  it("never takes Command+Q or Control+Q", () => {
    expect(opensQ(key("q", { metaKey: true }))).toBe(false);
    expect(opensQ(key("Q", { metaKey: true }))).toBe(false);
    expect(opensQ(key("q", { ctrlKey: true }))).toBe(false);
  });

  it("ignores a bare K, and K with Alt", () => {
    expect(opensQ(key("k"))).toBe(false);
    expect(opensQ(key("k", { metaKey: true, altKey: true }))).toBe(false);
  });

  it("is named in the platform's words", () => {
    expect(qShortcutHint(true)).toBe("⌘K");
    expect(qShortcutHint(false)).toBe("Ctrl K");
    expect(isApplePlatform("MacIntel", "")).toBe(true);
    expect(
      isApplePlatform(
        "",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      ),
    ).toBe(true);
    expect(isApplePlatform("Win32", "Mozilla/5.0 (Windows NT 10.0)")).toBe(
      false,
    );
  });
});
