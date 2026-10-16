// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Server components in Arabic (multilingual Q): a page awaits serverT(),
 * which remembers the language for the request, and synchronous server
 * components below translate with serverTNow(). Outside a request React's
 * cache does not hold, so here the request's remembered language is
 * stood in for: Arabic, as a page for an Arabic reader would leave it.
 */
vi.mock("../src/features/i18n/server-now", async () => {
  const { translate } = await import("../src/features/i18n/messages");
  return {
    rememberServerLanguage: vi.fn(),
    serverTNow: () => (english: string) => translate("ar", english),
  };
});

import { DailyArchive } from "../src/features/daily/archive";
import { translate } from "../src/features/i18n/messages";
import { DecisionRecord } from "../src/features/relationships/decision-record";

afterEach(cleanup);

describe("server components in Arabic", () => {
  it("renders The Q Daily's archive with Arabic words and dates, Western digits", () => {
    render(
      <DailyArchive
        items={[
          {
            id: "00000000-0000-4000-8000-0000000000d1",
            number: 12,
            editionDate: "2026-10-14",
            frequency: "DAILY",
            headline: null,
          },
        ]}
        nextCursor="2026-10-13"
      />,
    );
    expect(screen.getByRole("heading", { name: "إصدارات سابقة" })).toBeTruthy();
    expect(screen.getByText("إصدار هادئ")).toBeTruthy();
    expect(screen.getByRole("link", { name: "إصدارات أقدم" })).toBeTruthy();
    expect(document.body.textContent).toMatch(/14 أكتوبر 2026/u);
    expect(document.body.textContent).toMatch(/العدد 12/u);
  });

  it("renders a CRM decision record in Arabic", () => {
    render(
      <DecisionRecord
        decision={{
          state: "IN_DILIGENCE",
          title: "Diligence started",
          at: "2026-10-09T10:00:00.000Z",
          details: [],
          earlier: [{ title: "Paused", at: "2026-10-02T10:00:00.000Z" }],
        }}
      />,
    );
    expect(screen.getByText(/بدأت العناية الواجبة/u)).toBeTruthy();
    expect(document.body.textContent).toMatch(/9 أكتوبر/u);
    expect(document.body.textContent).toContain(
      `سابقاً: ${translate("ar", "Paused")} 2 أكتوبر`,
    );
  });
});
