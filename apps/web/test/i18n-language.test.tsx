// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import {
  announceLanguage,
  LanguageProvider,
  useT,
} from "../src/features/i18n/language";
import { performClientAction } from "../src/features/q/client-actions";
import { loadWire } from "../src/features/q/wire";
import {
  directionOf,
  translate,
  translatedStrings,
  uiLanguageOf,
} from "../src/features/i18n/messages";
import {
  PRIMARY_NAVIGATION,
  PROFILE_NAVIGATION,
  SETTINGS_NAVIGATION,
} from "../src/components/app-shell/navigation";

/**
 * Multilingual Q (2026-10-16): the interface follows the person's saved
 * language. Arabic renders right-to-left from the server HTML, the
 * document follows for portals, and an untranslated string stays English.
 */

function Probe() {
  const t = useT();
  return (
    <nav>
      <span>{t("Settings")}</span>
      <span>{t("A sentence nobody translated")}</span>
    </nav>
  );
}

describe("the interface language", () => {
  it("is Arabic only when Arabic was chosen", () => {
    expect(uiLanguageOf("ar")).toBe("ar");
    expect(uiLanguageOf("en")).toBe("en");
    expect(uiLanguageOf("AUTO")).toBe("en");
    expect(uiLanguageOf(null)).toBe("en");
    expect(directionOf("ar")).toBe("rtl");
    expect(directionOf("en")).toBe("ltr");
  });

  it("lays Arabic out right to left, on the wrapper and the document", () => {
    const { container } = render(
      <LanguageProvider language="ar">
        <Probe />
      </LanguageProvider>,
    );
    const wrapper = container.querySelector("[data-ui-language]");
    expect(wrapper?.getAttribute("dir")).toBe("rtl");
    expect(wrapper?.getAttribute("lang")).toBe("ar");
    expect(wrapper?.className).toBe("contents");
    expect(document.documentElement.dir).toBe("rtl");
    expect(document.documentElement.lang).toBe("ar");
    expect(screen.getByText("الإعدادات")).toBeTruthy();
    // Untranslated: English, never a key.
    expect(screen.getByText("A sentence nobody translated")).toBeTruthy();
  });

  it("keeps English left to right and untouched", () => {
    const { container } = render(
      <LanguageProvider language="en">
        <Probe />
      </LanguageProvider>,
    );
    expect(
      container.querySelector("[data-ui-language]")?.getAttribute("dir"),
    ).toBe("ltr");
    expect(document.documentElement.dir).toBe("ltr");
    expect(screen.getByText("Settings")).toBeTruthy();
  });

  it("defaults to English with no provider", () => {
    render(<Probe />);
    expect(screen.getAllByText("Settings").length).toBeGreaterThan(0);
  });

  it("translates every navigation label except product names", () => {
    const products = new Set(["Q", "GateQ", "Q Pitch", "The Q Daily"]);
    for (const item of [
      ...PRIMARY_NAVIGATION,
      PROFILE_NAVIGATION,
      SETTINGS_NAVIGATION,
    ]) {
      if (products.has(item.label)) continue;
      expect(translate("ar", item.label), item.label).not.toBe(item.label);
    }
    for (const group of ["Workspace", "You", "Admin"]) {
      expect(translate("ar", group)).not.toBe(group);
    }
  });

  it("covers the onboarding frame and the language setting itself", () => {
    const strings = translatedStrings("ar");
    for (const english of [
      "Back",
      "Save & leave",
      "Saving",
      "Saved",
      "Language",
      "Automatic",
    ]) {
      expect(strings).toContain(english);
    }
  });
});

describe("Settings says what is Arabic today", () => {
  it("names the Arabic surfaces and the pages still in English, in both languages", async () => {
    const { ARABIC_NOW, STILL_ENGLISH, VIDEO_FALLBACK } =
      await import("../src/features/settings/language-setting");
    expect(ARABIC_NOW).toMatch(/conversation with Q/u);
    expect(ARABIC_NOW).toMatch(/voice/u);
    expect(ARABIC_NOW).toMatch(/rehearsals/u);
    expect(ARABIC_NOW).toMatch(/onboarding/u);
    expect(STILL_ENGLISH).toMatch(/Discover/u);
    expect(STILL_ENGLISH).toMatch(/CRM/u);
    for (const line of [ARABIC_NOW, STILL_ENGLISH, VIDEO_FALLBACK]) {
      expect(translate("ar", line)).not.toBe(line);
    }
  });
});

describe("changing language by telling Q (live, no reload)", () => {
  beforeAll(async () => {
    await loadWire();
  });

  it("switches direction and words the moment the change is announced", () => {
    refresh.mockClear();
    const { container } = render(
      <LanguageProvider language="en">
        <Probe />
      </LanguageProvider>,
    );
    const wrapper = () => container.querySelector("[data-ui-language]");
    expect(wrapper()?.getAttribute("dir")).toBe("ltr");
    act(() => {
      announceLanguage("ar");
    });
    expect(wrapper()?.getAttribute("dir")).toBe("rtl");
    expect(document.documentElement.dir).toBe("rtl");
    expect(screen.getByText("الإعدادات")).toBeTruthy();
    // Server-rendered words follow from a refresh, not a reload.
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => {
      announceLanguage("en");
    });
    expect(wrapper()?.getAttribute("dir")).toBe("ltr");
  });

  it("Q's SET_LANGUAGE action is performed on the screen, checked against the contract", () => {
    const seen: string[] = [];
    const effects = {
      setTheme: () => undefined,
      reload: () => undefined,
      openTab: () => true,
      setQMotion: () => undefined,
      setVoice: () => undefined,
      setLanguage: (language: string) => seen.push(language),
      signOut: () => undefined,
      goTo: () => undefined,
      setDiscoverFilters: () => undefined,
      screen: () => undefined,
      openMaterial: () => undefined,
    };
    expect(
      performClientAction({ kind: "SET_LANGUAGE", language: "ar" }, effects),
    ).toBe(true);
    expect(
      performClientAction({ kind: "SET_LANGUAGE", language: "fr" }, effects),
    ).toBe(false);
    expect(seen).toEqual(["ar"]);
  });
});
