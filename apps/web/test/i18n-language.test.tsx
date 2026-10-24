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
    // Any language: French is a language like any other now.
    expect(
      performClientAction({ kind: "SET_LANGUAGE", language: "fr" }, effects),
    ).toBe(true);
    // Not a language tag at all: refused by the contract.
    expect(
      performClientAction(
        { kind: "SET_LANGUAGE", language: "Not A Tag" },
        effects,
      ),
    ).toBe(false);
    expect(seen).toEqual(["ar", "fr"]);
  });
});

describe("data-bearing words in Arabic (taxonomy, reasons, sentences with names)", () => {
  it("shows taxonomy display names in Arabic, keyed to their codes", async () => {
    const { TAXONOMY_AR_BY_CODE } =
      await import("../src/features/i18n/catalog/taxonomy");
    expect(TAXONOMY_AR_BY_CODE["company_stage:seed"]).toBe("البذرة");
    expect(translate("ar", "Fintech")).toBe("التقنية المالية");
    expect(translate("ar", "Seed")).toBe("البذرة");
  });

  it("translates a joined list only when every item is known", () => {
    expect(
      translate("ar", "Financial Services, Digital Lending, Fintech"),
    ).toBe("الخدمات المالية، الإقراض الرقمي، التقنية المالية");
    // A name in the list: the list stays exactly as written.
    expect(translate("ar", "Fintech, Harbourline Cargo")).toBe(
      "Fintech, Harbourline Cargo",
    );
  });

  it("fills fit reasons and notes from patterns, keeping names and figures", () => {
    expect(translate("ar", "Seed, in your range")).toBe("البذرة، ضمن نطاقك");
    expect(translate("ar", "Nigeria, a country you invest in")).toBe(
      "نيجيريا، دولة تستثمر فيها",
    );
    expect(
      translate(
        "ar",
        "Your red-flag exclusion can't be checked automatically yet, so nobody is hidden because of it.",
      ),
    ).toBe(
      "لا يمكن التحقق من استبعاد المؤشرات التحذيرية تلقائياً بعد، لذا لا يُخفى أحد بسببه.",
    );
    expect(translate("ar", "You're connected with Harbourline Cargo")).toBe(
      "أنت الآن على تواصل مع Harbourline Cargo",
    );
    expect(translate("ar", "3 pitches that match your mandate")).toBe(
      "3 عروض تطابق تفويضك",
    );
    expect(translate("ar", "Said in their pitch")).toBe("قالوه في عرضهم");
    expect(translate("en", "Seed, in your range")).toBe("Seed, in your range");
  });
});

describe("live Arabic check 2026-10-16: no English half-sentences", () => {
  it("a joining pattern never grafts Arabic onto an English sentence", () => {
    // Live: "..., وwhat investors would see." from "{a} and {b}".
    const prose = "We met them last week, and they would like a deck.";
    expect(translate("ar", prose)).toBe(prose);
    expect(
      translate(
        "ar",
        "What Capital Q knows about your company, and what investors would see.",
      ),
    ).toBe("ما يعرفه Capital Q عن شركتك، وما سيراه المستثمرون.");
  });

  it("joins names and known words, and lists inside a sentence", () => {
    expect(translate("ar", "Zino Aviation and Atlas Health")).toBe(
      "Zino Aviation وAtlas Health",
    );
    expect(translate("ar", "On record: Founders named, Pitch deck.")).toBe(
      "مسجّل: تسمية المؤسسين، العرض التقديمي.",
    );
  });

  it("the readiness plan and the gate say their words in Arabic", () => {
    expect(translate("ar", "Add 3 months of revenue evidence")).toBe(
      "أضف إثبات إيرادات لثلاثة أشهر",
    );
    expect(
      translate(
        "ar",
        "Meets 2 of their 6 published criteria; 4 Q can't check until you share more.",
      ),
    ).toBe(
      "يستوفي 2 من معاييرهم المنشورة البالغة 6؛ و4 لا يستطيع Q التحقق منها حتى تشارك المزيد.",
    );
    expect(translate("ar", "Hi Mariam Al Nuaimi, I'm Q.")).toBe(
      "مرحباً Mariam Al Nuaimi، أنا Q.",
    );
  });
});

describe("Automatic follows the device (QO-45)", () => {
  it("picks the first of the browser's languages, by tag then primary language", async () => {
    const { deviceLanguageOf, uiLanguageOf } =
      await import("../src/features/i18n/messages");
    expect(uiLanguageOf("AUTO", "ar-EG,ar;q=0.9,en;q=0.8")).toBe("ar-EG");
    expect(uiLanguageOf(null, ["fr-FR", "en"])).toBe("fr-FR");
    // Quality decides the order, not the position.
    expect(deviceLanguageOf("en;q=0.5,ar;q=0.9")).toBe("ar");
    // English in any region is English; nothing usable is English.
    expect(deviceLanguageOf("en-GB,ar;q=0.5")).toBe("en");
    expect(deviceLanguageOf("*")).toBe("en");
    expect(uiLanguageOf("AUTO")).toBe("en");
    // A saved language is never overridden by the device.
    expect(uiLanguageOf("en", "ar-EG")).toBe("en");
  });
});
