// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/relationships",
  useSearchParams: () => new URLSearchParams(),
}));

import { dealFixture } from "../app/dev/deal-close/fixtures";
import { DOCUMENTS_AR } from "../src/features/i18n/catalog/documents";
import { RELATIONSHIPS_AR } from "../src/features/i18n/catalog/relationships";
import { LanguageProvider } from "../src/features/i18n/language";
import { translate } from "../src/features/i18n/messages";
import { localiseDate } from "../src/features/i18n/patterns";
import {
  DealGuide,
  DealStageStrip,
} from "../src/features/relationships/deal-stage-strip";
import { NotScannedNote } from "../src/features/documents/not-scanned-note";
import { RelationshipsEmpty } from "../src/features/relationships/relationships-empty";

/**
 * The whole app in Arabic (multilingual Q, 2026-10-16): each area's
 * catalogue is well formed, sentences with a name or a figure translate
 * whole, and an area's screens render in Arabic under the provider while
 * English stays exactly as it was.
 */

afterEach(cleanup);

const ARABIC_LETTER = /[؀-ۿ]/u;
const PLACEHOLDERS = /\{[A-Za-z][A-Za-z0-9]*\}/gu;

const AREAS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  relationships: RELATIONSHIPS_AR,
  documents: DOCUMENTS_AR,
};

describe("the area catalogues", () => {
  for (const [area, catalogue] of Object.entries(AREAS)) {
    it(`${area}: every entry is Arabic and keeps its placeholders`, () => {
      for (const [english, arabic] of Object.entries(catalogue)) {
        // A product name or a code (SAFE, CSV) may stay as it is.
        if (arabic === english) continue;
        // Words become Arabic; punctuation around a quote may only change.
        if (/[A-Za-z]{2}/u.test(english.replace(PLACEHOLDERS, ""))) {
          expect(ARABIC_LETTER.test(arabic), english).toBe(true);
        }
        const keys = (english.match(PLACEHOLDERS) ?? []).toSorted();
        const values = (arabic.match(PLACEHOLDERS) ?? []).toSorted();
        expect(values, english).toEqual(keys);
      }
    });
  }
});

describe("sentences with a name, a figure or a date", () => {
  it("translates the whole sentence and keeps the name as written", () => {
    expect(translate("ar", "Waiting on Acme Robotics Ltd.")).toBe(
      "بانتظار Acme Robotics Ltd.",
    );
    expect(translate("ar", "Answered 2 of 5")).toBe("أُجيب عن 2 من 5");
  });

  it("translates a catalogue word inside the sentence (a stage)", () => {
    expect(translate("ar", "Next: Terms.")).toBe("التالي: الشروط.");
  });

  it("matches a figure only where a figure belongs", () => {
    expect(translate("ar", "3 updates")).toBe("3 تحديثات");
    // Someone's own words are never taken for a figure.
    expect(translate("ar", "Sent the investor updates")).toBe(
      "Sent the investor updates",
    );
  });

  it("writes dates with Arabic month names and Western digits", () => {
    expect(localiseDate("18 Sept")).toBe("18 سبتمبر");
    expect(localiseDate("27 Sept 2026, 06:54")).toBe("27 سبتمبر 2026, 06:54");
    expect(localiseDate("Sept is a month")).toBeUndefined();
    expect(translate("ar", "Call with Ada Obi on 7 Oct.")).toBe(
      "مكالمة مع Ada Obi في 7 أكتوبر.",
    );
    expect(translate("en", "7 Oct")).toBe("7 Oct");
  });
});

describe("CRM in Arabic", () => {
  it("renders the deal strip and its guide in Arabic, right to left", () => {
    const view = dealFixture("terms", "INVESTOR");
    const { container } = render(
      <LanguageProvider language="ar">
        <DealStageStrip view={view} />
        <DealGuide view={view} />
      </LanguageProvider>,
    );
    expect(
      container.querySelector("[data-ui-language]")?.getAttribute("dir"),
    ).toBe("rtl");
    expect(
      screen.getByRole("list", { name: "أين تقف هذه الصفقة" }),
    ).toBeTruthy();
    expect(screen.getByText("العناية الواجبة")).toBeTruthy();
    expect(screen.getByText("التالي: موقّعة.")).toBeTruthy();
    expect(container.textContent).not.toMatch(/Diligence|Soft commit/u);
  });

  it("keeps English unchanged without Arabic chosen", () => {
    const view = dealFixture("terms", "INVESTOR");
    render(
      <LanguageProvider language="en">
        <DealStageStrip view={view} />
        <RelationshipsEmpty
          sentence="No relationships yet."
          href="/discover"
          action="Open Discover"
        />
      </LanguageProvider>,
    );
    expect(
      screen.getByRole("list", { name: "Where this deal is" }),
    ).toBeTruthy();
    expect(screen.getByText("Diligence")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Discover" })).toBeTruthy();
  });

  it("says the empty CRM in Arabic", () => {
    render(
      <LanguageProvider language="ar">
        <RelationshipsEmpty
          sentence="No relationships yet. Expressing interest in a company from Discover starts one."
          href="/discover"
          action="Open Discover"
        />
      </LanguageProvider>,
    );
    expect(screen.getByRole("link", { name: "افتح اكتشف" })).toBeTruthy();
    expect(screen.getByText(/لا توجد علاقات بعد/u)).toBeTruthy();
  });
});

describe("Documents and data rooms in Arabic", () => {
  it("says a file is not virus-scanned, in Arabic", () => {
    render(
      <LanguageProvider language="ar">
        <NotScannedNote />
      </LanguageProvider>,
    );
    expect(screen.getByText("لم يُفحص من الفيروسات بعد")).toBeTruthy();
  });

  it("translates a sentence whose parts are themselves sentences", () => {
    expect(translate("ar", "asked 18 Sept · waiting 3 days")).toBe(
      "طُلب 18 سبتمبر · بالانتظار منذ 3 أيام",
    );
    expect(
      translate(
        "ar",
        "4 documents you can see, in 2 folders. 1 are open to you now.",
      ),
    ).toBe("4 مستندات يمكنك رؤيتها، في 2 مجلدات. 1 منها مفتوحة لك الآن.");
    expect(translate("ar", "Cap table and equity")).toBe(
      "جدول الرسملة وحقوق الملكية",
    );
  });
});
