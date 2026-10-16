// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/relationships",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("../src/features/gateq/gateway-actions", () => ({
  openGatewayAction: vi.fn(),
}));

import { WorkforceOverviewDtoSchema } from "@capital-q/contracts";

import { dealFixture } from "../app/dev/deal-close/fixtures";
import { ADMIN_AR } from "../src/features/i18n/catalog/admin";
import { DAILY_AR } from "../src/features/i18n/catalog/daily";
import { DOCUMENTS_AR } from "../src/features/i18n/catalog/documents";
import { GATEQ_AR } from "../src/features/i18n/catalog/gateq";
import { RELATIONSHIPS_AR } from "../src/features/i18n/catalog/relationships";
import { WORK_AR } from "../src/features/i18n/catalog/work";
import { WorkforceCost } from "../src/features/work/workforce-cost";
import { LanguageProvider } from "../src/features/i18n/language";
import { translate } from "../src/features/i18n/messages";
import { localiseDate } from "../src/features/i18n/patterns";
import {
  DealGuide,
  DealStageStrip,
} from "../src/features/relationships/deal-stage-strip";
import { NotScannedNote } from "../src/features/documents/not-scanned-note";
import {
  CopyButton,
  OpenGatewayButton,
} from "../src/features/gateq/gateway-controls";
import {
  ErrorBlock,
  GateqChrome,
} from "../src/features/gateq/page/gateq-chrome";
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
  gateq: GATEQ_AR,
  work: WORK_AR,
  daily: DAILY_AR,
  admin: ADMIN_AR,
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
    expect(
      screen.getByRole("link", { name: translate("ar", "Open Discover") }),
    ).toBeTruthy();
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

describe("GateQ in Arabic", () => {
  const arabic = (english: string) => translate("ar", english);

  it("renders the investor's tabs and an unloaded block from a server translator", () => {
    render(
      <GateqChrome t={arabic} role="INVESTOR" active="inbox">
        <ErrorBlock t={arabic} what="Your search" retryHref="/gateq?tab=find" />
      </GateqChrome>,
    );
    expect(screen.getByRole("link", { name: "الوارد" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "بوابتك" })).toBeTruthy();
    expect(screen.getByText("تعذّر تحميل بحثك")).toBeTruthy();
    // The shared word wins: the same English means the same everywhere.
    expect(
      screen.getByRole("link", { name: translate("ar", "Try again") }),
    ).toBeTruthy();
  });

  it("keeps the same blocks English without a translator", () => {
    render(
      <GateqChrome role="FOUNDER" active="applications">
        <ErrorBlock what="Search" retryHref="/gateq?tab=claim" />
      </GateqChrome>,
    );
    expect(screen.getByRole("link", { name: "Applications" })).toBeTruthy();
    expect(screen.getByText("Search didn't load")).toBeTruthy();
  });

  it("renders the gateway controls in Arabic under the provider", () => {
    render(
      <LanguageProvider language="ar">
        <OpenGatewayButton />
        <CopyButton text="https://example.test/g/abc" label="Copy gate link" />
      </LanguageProvider>,
    );
    expect(screen.getByRole("button", { name: "افتح بوابتي" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "انسخ رابط البوابة" }),
    ).toBeTruthy();
  });

  it("says a founder's fit with the fund's name kept as written", () => {
    expect(translate("ar", "You fit Kiln Ventures's mandate")).toBe(
      "أنت تتوافق مع تفويض Kiln Ventures",
    );
    expect(translate("ar", "Replies within 10 working days")).toBe(
      "يردّ خلال 10 أيام عمل",
    );
  });
});

describe("Q Work and notifications in Arabic", () => {
  it("renders the cost of Q's work in Arabic, figures as written", () => {
    const overview = WorkforceOverviewDtoSchema.parse({
      month: "2026-10",
      spentUsd: "4.2",
      limitUsd: "25",
      paused: false,
      byRole: [{ role: "WRITER", usd: "1.5" }],
      team: [],
      jobs: { open: 1, needsYou: 0 },
    });
    render(
      <LanguageProvider language="ar">
        <WorkforceCost overview={overview} jobs={[]} />
      </LanguageProvider>,
    );
    expect(screen.getByRole("heading", { name: "هذا الشهر" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "حسب المتخصص" })).toBeTruthy();
    expect(
      screen.getByRole("meter", { name: "المُنفق من حدك الشهري" }),
    ).toBeTruthy();
    expect(
      screen.getByText(/يوقف Q العمل الجديد ويسألك عند \$25/u),
    ).toBeTruthy();
  });

  it("says jobs, drafts and times in Arabic, keeping names and figures", () => {
    expect(translate("ar", "Waiting for Ada Obi to reply")).toBe(
      "بانتظار رد Ada Obi",
    );
    expect(translate("ar", "Next run Thu 09:03.")).toBe(
      "التنفيذ التالي الخميس 09:03.",
    );
    expect(translate("ar", "Show 3 more")).toBe("عرض 3 أخرى");
    expect(translate("ar", "Notifications, 4 new")).toBe("الإشعارات، 4 جديدة");
  });
});
