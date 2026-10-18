// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { QAnswerCardsBlock } from "@capital-q/contracts";

import type { QTurnObjectBlock } from "../src/features/q/conversation";

/**
 * RECOVERY-2026-10 E4 (audit E-08), in the rendered DOM: investor
 * references by name with their profile, comparison headers named,
 * tables with linked columns, charts that say what their figures are,
 * maps at country level with the same places as a list, timelines in
 * order, and an answer's own map and published fit basis.
 */

const APEX = "3ab2cc02-160f-4812-a6b1-8be7e43afd3e";
const NORTHWIND = "4ab2cc02-160f-4812-a6b1-8be7e43afd3e";
const HIDDEN = "5ab2cc02-160f-4812-a6b1-8be7e43afd3e";

const referenceNamesAction = vi.fn(
  (input: { investors: readonly string[]; companies: readonly string[] }) =>
    Promise.resolve({
      investors: Object.fromEntries(
        input.investors.map((id) => [
          id,
          id === APEX ? "Apex Capital" : id === NORTHWIND ? "Northwind" : null,
        ]),
      ),
      companies: {},
    }),
);
vi.mock("../src/features/q/room/reference-names", () => ({
  referenceNamesAction: (input: {
    investors: readonly string[];
    companies: readonly string[];
  }) => referenceNamesAction(input),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/home",
}));

const { QResultBlocks } = await import("../src/features/q/q-result-blocks");
const { AnswerCanvas } = await import("../src/features/q/answer-canvas");
const { forgetSubjectNames } =
  await import("../src/features/q/blocks/use-subject-names");

afterEach(() => {
  cleanup();
  forgetSubjectNames();
});

const investor = (id: string) => ({
  kind: "INVESTOR_ORGANISATION" as const,
  investorOrganisationId: id,
});

describe("E-08: investors are named and open their profile", () => {
  it("names an investor reference and links its profile; a hidden one stays 'Investor'", async () => {
    const blocks: QTurnObjectBlock[] = [
      { kind: "INVESTOR_REFERENCE", investorOrganisationId: APEX },
      { kind: "INVESTOR_REFERENCE", investorOrganisationId: HIDDEN },
    ];
    render(<QResultBlocks blocks={blocks} onAsk={vi.fn()} />);
    expect(await screen.findByText("Apex Capital")).toBeTruthy();
    expect(screen.getByText("Ask Q about Apex Capital")).toBeTruthy();
    const links = [...document.querySelectorAll("[data-q-investor-open]")].map(
      (link) => link.getAttribute("href"),
    );
    expect(links).toEqual([`/investors/${APEX}`, `/investors/${HIDDEN}`]);
    expect(screen.getByText("Ask Q about them")).toBeTruthy();
  });

  it("heads comparison columns with names, not 'Investor 1'", async () => {
    render(
      <QResultBlocks
        blocks={[
          {
            kind: "COMPARISON",
            subjects: [investor(APEX), investor(NORTHWIND)],
            rows: [{ label: "Based in", values: ["United Kingdom", ""] }],
          },
        ]}
      />,
    );
    await waitFor(() => {
      const heads = [
        ...document.querySelectorAll("[data-q-comparison-head]"),
      ].map((head) => head.textContent);
      expect(heads).toEqual(["Apex Capital", "Northwind"]);
    });
    expect(screen.getByText("Not known")).toBeTruthy();
  });
});

describe("E4: tables, charts, maps and timelines", () => {
  it("renders each kind with its text equal", async () => {
    render(
      <QResultBlocks
        blocks={[
          {
            kind: "TABLE",
            title: "Side by side",
            columns: [
              { label: "Apex Capital", subject: investor(APEX) },
              { label: "Northwind", subject: null },
            ],
            rows: [{ label: "Based in", cells: ["GB", ""] }],
          },
          {
            kind: "CHART",
            chart: "BAR",
            title: "Monthly revenue",
            unit: "a month",
            currency: "USD",
            series: [
              {
                label: "Revenue",
                truthClass: "USER_CLAIM",
                evidenceStatus: "DOCUMENT_SUPPORTED",
                source: "From the bank statements they uploaded.",
                points: [
                  { label: "Aug", value: 1200 },
                  { label: "Sep", value: 1800 },
                ],
              },
            ],
          },
          {
            kind: "MAP",
            title: "Where they're based",
            basis: "Head-office country, as each investor publishes it.",
            places: [
              {
                label: "Apex Capital",
                countryCode: "GB",
                subject: investor(APEX),
                note: null,
              },
              {
                label: "Halyard",
                countryCode: null,
                subject: null,
                note: null,
              },
            ],
          },
          {
            kind: "TIMELINE",
            title: "Your relationship",
            events: [
              {
                at: "2026-09-12",
                label: "Interest expressed",
                note: null,
                subject: null,
              },
              {
                at: "2026-10-03",
                label: "Meeting booked",
                note: "Tuesday 10:00",
                subject: null,
              },
            ],
          },
        ]}
      />,
    );
    // Table: a linked, named column; an empty cell is "Not known".
    const table = document.querySelector("[data-q-table]");
    expect(table?.querySelector("th a")?.getAttribute("href")).toBe(
      `/investors/${APEX}`,
    );
    expect(table?.textContent).toContain("Not known");
    // Chart: it says what the figures are, and lists them.
    expect(
      document.querySelector("[data-q-chart-standing]")?.textContent,
    ).toContain("Claimed by the company, backed by a document");
    expect(
      document.querySelector("[data-q-chart-table]")?.textContent,
    ).toContain("$1,800");
    // Map: the list carries every place; the unpublished one is not placed.
    const list = document.querySelector("[data-q-map-list]")?.textContent ?? "";
    expect(list).toContain("Apex Capital");
    expect(list).toContain("United Kingdom");
    expect(document.querySelector("[data-q-map-unplaced]")?.textContent).toBe(
      "Halyard · Location not published",
    );
    await waitFor(() => {
      expect(document.querySelector("[data-q-map-drawn]")).not.toBeNull();
    });
    expect(document.querySelector('[data-q-map-country="GB"]')).not.toBeNull();
    // Timeline: in order, dated.
    const events = [
      ...document.querySelectorAll("[data-q-timeline-event]"),
    ].map((event) => event.textContent);
    expect(events[0]).toContain("Interest expressed");
    expect(events[1]).toContain("Tuesday 10:00");
  });
});

describe("E4: an answer's own map and published fit basis", () => {
  it("shows why each investor fits from what they publish, and where they are", async () => {
    const block: QAnswerCardsBlock = {
      kind: "ANSWER_CARDS",
      shape: "SIDE_BY_SIDE",
      title: "The three side by side",
      cards: [
        {
          key: "apex",
          name: "Apex Capital",
          line: null,
          hue: 1,
          fit: null,
          reasons: ["Invests at Seed"],
          measures: [{ label: "Based in", level: "UNKNOWN", value: "UK" }],
          view: null,
          said: null,
          sourceCount: 0,
          subject: investor(APEX),
          fitBasis: ["Invests at Seed", "Their published gate: 1 met"],
        },
        {
          key: "northwind",
          name: "Northwind",
          line: null,
          hue: 2,
          fit: null,
          reasons: ["Invests in Africa"],
          measures: [{ label: "Based in", level: "UNKNOWN", value: "KE" }],
          view: null,
          said: null,
          sourceCount: 0,
          subject: investor(NORTHWIND),
        },
      ],
      followUps: [],
      map: {
        title: "Where they're based",
        basis:
          "Head-office country, as each investor publishes it on Capital Q.",
        places: [
          {
            label: "Apex Capital",
            countryCode: "GB",
            subject: investor(APEX),
            note: null,
          },
          {
            label: "Northwind",
            countryCode: "KE",
            subject: investor(NORTHWIND),
            note: null,
          },
        ],
      },
    };
    render(
      <AnswerCanvas
        block={block}
        asked="Compare these investors and where they're based"
        said=""
        focus={0}
        presence={null}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      document.querySelector("[data-ac-fit-basis]")?.textContent,
    ).toContain("Their published gate: 1 met");
    const map = document.querySelector("[data-ac-map]");
    expect(map?.textContent).toContain("Kenya");
    expect(map?.textContent).toContain("as each investor publishes it");
  });
});
