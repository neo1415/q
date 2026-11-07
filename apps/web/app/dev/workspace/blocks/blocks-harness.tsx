"use client";

import type { QTurnObjectBlock } from "@/features/q/conversation";
import { demoTop, DEMO_COMPARE } from "@/features/q/answer-canvas-fixtures";
import { QResultBlocks } from "@/features/q/q-result-blocks";
import { LanguageProvider } from "@/features/i18n/language";

const BLOCKS: readonly QTurnObjectBlock[] = [
  demoTop(3),
  demoTop(5),
  DEMO_COMPARE,
  {
    kind: "COMPARISON_CARDS",
    title: "Ledgerfold and Kivu Freight",
    items: [
      { name: "Ledgerfold", subtitle: "Seed · Lagos", points: ["USD 40k MRR"] },
      {
        name: "Kivu Freight",
        subtitle: null,
        points: ["Not known", "Pre-seed"],
      },
      {
        name: "Tamarind Pay",
        subtitle: "Series A · Nairobi",
        points: ["USD 1.2M ARR"],
      },
    ],
  },
  {
    kind: "TABLE",
    title: "Side by side",
    columns: [
      { label: "Portside", subject: null },
      { label: "Souqsheet", subject: null },
      { label: "Ledgerfold", subject: null },
    ],
    rows: [
      { label: "Stage", cells: ["Seed", "Pre-seed", "Series A"] },
      { label: "Raising", cells: ["$1.8M", "", "$6M"] },
    ],
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
          { label: "Oct", value: 2600 },
        ],
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
  {
    kind: "SUMMARY",
    title: "Kivu Freight in brief",
    points: [
      {
        text: "Cold-chain trucking between Kigali and Goma.",
        truthClass: "VERIFIED",
        evidenceStatus: "PLATFORM_VERIFIED",
      },
      {
        text: "Revenue is thirty-eight thousand dollars a month.",
        truthClass: "USER_CLAIM",
        evidenceStatus: "DOCUMENT_SUPPORTED",
      },
    ],
    missing: [],
  },
];

const WIDTHS = [320, 380, 480, 640, 1000] as const;

/** R7: each width a real Q pane (the container the blocks size to). */
export function BlocksHarness() {
  return (
    <LanguageProvider language="en">
      <main className="flex flex-col gap-10 p-6">
        {WIDTHS.map((width) => (
          <section key={width} data-harness-width={width}>
            <h2 className="cq-label mb-2">{width} px pane</h2>
            <div
              className="cq-stage cq-q-pane"
              style={{ width, height: "auto" }}
              data-harness-pane={width}
            >
              <div className="flex flex-col gap-4 p-4">
                <QResultBlocks blocks={BLOCKS} turnId={`harness-${width}`} />
              </div>
            </div>
          </section>
        ))}
      </main>
    </LanguageProvider>
  );
}
