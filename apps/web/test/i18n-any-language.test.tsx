// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));
const saved: string[] = [];
vi.mock("../src/features/settings/language-actions", () => ({
  setLanguageAction: (choice: string) => {
    saved.push(choice);
    return Promise.resolve({ ok: true, language: choice });
  },
}));

import {
  announceLanguage,
  LanguageProvider,
  useT,
} from "../src/features/i18n/language";
import {
  directionOf,
  hasHandCatalogue,
  registerMachineCatalogue,
  translate,
  uiLanguageOf,
} from "../src/features/i18n/messages";
import { LanguageSetting } from "../src/features/settings/language-setting";

/**
 * Any language (owner 2026-10-16): a language setting, not an
 * English/Arabic toggle. The registry decides names and direction from
 * Intl data; machine translations fill the screens where no hand catalogue
 * exists, the hand catalogue wins where it does, and English fills
 * anything missing.
 */

function Probe() {
  const t = useT();
  return (
    <nav>
      <span data-probe="settings">{t("Settings")}</span>
      <span data-probe="missing">{t("A sentence nobody translated")}</span>
    </nav>
  );
}

const FRENCH = {
  Settings: "Paramètres",
  "Waiting on {name}.": "En attente de {name}.",
};
const SPANISH = { Settings: "Configuración" };

describe("the registry drives the interface language", () => {
  it("offers any language the runtime can name and script, right to left from its script", () => {
    expect(uiLanguageOf("fr")).toBe("fr");
    expect(uiLanguageOf("pt-BR")).toBe("pt-BR");
    expect(uiLanguageOf("tlh")).toBe("en");
    for (const [tag, dir] of [
      ["fr", "ltr"],
      ["sw", "ltr"],
      ["ja", "ltr"],
      ["yo", "ltr"],
      ["ur", "rtl"],
      ["he", "rtl"],
      ["ar", "rtl"],
    ] as const) {
      expect(directionOf(tag), tag).toBe(dir);
    }
  });

  it("lays out Urdu and Hebrew right to left with no per-language code", () => {
    for (const tag of ["ur", "he"]) {
      const { container, unmount } = render(
        <LanguageProvider language={tag}>
          <Probe />
        </LanguageProvider>,
      );
      expect(
        container.querySelector("[data-ui-language]")?.getAttribute("dir"),
      ).toBe("rtl");
      expect(document.documentElement.lang).toBe(tag);
      unmount();
    }
  });
});

describe("machine translations, hand catalogues and English", () => {
  it("shows Q's machine translation, keeps placeholders filled, and English for a missing string", () => {
    registerMachineCatalogue("fr", FRENCH);
    expect(translate("fr", "Settings")).toBe("Paramètres");
    expect(translate("fr", "Waiting on Harbourline Cargo.")).toBe(
      "En attente de Harbourline Cargo.",
    );
    expect(translate("fr", "A sentence nobody translated")).toBe(
      "A sentence nobody translated",
    );
    expect(hasHandCatalogue("fr")).toBe(false);
  });

  it("lets the Arabic hand catalogue win over any machine output", () => {
    registerMachineCatalogue("ar", {
      Settings: "إعدادات آلية",
      "Only machine": "آلي فقط",
    });
    expect(translate("ar", "Settings")).toBe("الإعدادات");
    // Machine fills what the hand catalogue lacks.
    expect(translate("ar", "Only machine")).toBe("آلي فقط");
    expect(hasHandCatalogue("ar-AE")).toBe(true);
  });

  it("never shrinks what a language already shows when an older, smaller answer arrives", () => {
    registerMachineCatalogue("de", {
      Settings: "Einstellungen",
      Work: "Arbeit",
    });
    registerMachineCatalogue("de", { Settings: "Einstellungen" });
    expect(translate("de", "Work")).toBe("Arbeit");
  });
});

describe("switching between any two languages live", () => {
  it("goes French -> Arabic -> Spanish without a reload", () => {
    refresh.mockClear();
    registerMachineCatalogue("fr", FRENCH);
    registerMachineCatalogue("es", SPANISH);
    const { container } = render(
      <LanguageProvider
        language="fr"
        machine={{ entries: FRENCH, complete: true }}
      >
        <Probe />
      </LanguageProvider>,
    );
    const word = () =>
      container.querySelector("[data-probe=settings]")?.textContent;
    const dir = () =>
      container.querySelector("[data-ui-language]")?.getAttribute("dir");
    expect(word()).toBe("Paramètres");
    expect(dir()).toBe("ltr");
    act(() => {
      announceLanguage("ar");
    });
    expect(word()).toBe("الإعدادات");
    expect(dir()).toBe("rtl");
    act(() => {
      announceLanguage("es");
    });
    expect(word()).toBe("Configuración");
    expect(dir()).toBe("ltr");
    expect(document.documentElement.lang).toBe("es");
    // Server-rendered words follow by refresh, never a reload.
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

describe("the Settings language picker", () => {
  it("lists languages by their own names, finds one by search and saves it", async () => {
    saved.length = 0;
    render(
      <LanguageProvider language="en">
        <LanguageSetting initial="AUTO" />
      </LanguageProvider>,
    );
    expect(
      screen
        .getByRole("button", { name: "Automatic" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    const search = screen.getByLabelText("Search languages");
    fireEvent.change(search, { target: { value: "swahili" } });
    const swahili = screen.getByRole("button", { name: "Kiswahili" });
    expect(swahili.getAttribute("lang")).toBe("sw");
    await act(async () => {
      fireEvent.click(swahili);
      await Promise.resolve();
    });
    expect(saved).toEqual(["sw"]);
    // What Swahili gets today, said plainly.
    const coverage =
      document.querySelector("[data-language-coverage]")?.textContent ?? "";
    expect(coverage).toContain("Translated by Q, automatically");
    expect(coverage).toContain(
      "Not available in this language yet: type to Q instead",
    );
    fireEvent.change(search, { target: { value: "urdu" } });
    expect(
      screen.getByRole("button", { name: "اردو" }).getAttribute("dir"),
    ).toBe("rtl");
    fireEvent.change(search, { target: { value: "klingon" } });
    expect(screen.getByText("No language matches that.")).toBeTruthy();
  });

  it("says Arabic's screens are hand-translated and its voice and video work", () => {
    render(
      <LanguageProvider language="en">
        <LanguageSetting initial="ar" />
      </LanguageProvider>,
    );
    const coverage =
      document.querySelector("[data-language-coverage]")?.textContent ?? "";
    expect(coverage).toContain("Translated by hand");
    expect(coverage.match(/Available/gu)?.length).toBe(2);
  });
});
