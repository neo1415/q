import type { FounderResults, InvestorResults } from "@capital-q/contracts";
import { documentToPdf, type ArtifactDocument } from "@capital-q/deck-render";

/**
 * The results report a person takes into their real business (spec §5):
 * the same read model as the Results page, as CSV (one file, a block per
 * section, formula-safe) and as a branded Capital Q PDF through the
 * documents engine. Figures only from recorded events; unknown reads "Not
 * stated", never 0.
 */

const STATE_WORDS: Readonly<Record<string, string>> = {
  DISCOVERED: "Discovered",
  INTEREST_EXPRESSED: "Interest expressed",
  CONNECTED: "Connected",
  DECLINED: "Declined",
  CLOSED: "Closed",
};

const REASON_WORDS: Readonly<Record<string, string>> = {
  STAGE_IN_RANGE: "Stage in range",
  SECTOR_MATCH: "Sector",
  GEOGRAPHY_MATCH: "Geography",
  BUSINESS_MODEL_MATCH: "Business model",
  CUSTOMER_TYPE_MATCH: "Customer type",
  DECLARED_DEPLOYING: "Deploying",
  PROFILE_COMPLETE: "Profile complete",
};

export function stateWords(state: string): string {
  return STATE_WORDS[state] ?? sentence(state);
}

export function reasonWords(kind: string): string {
  return REASON_WORDS[kind] ?? sentence(kind);
}

function sentence(code: string): string {
  const text = code.replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function grouped(amount: string): string {
  const [whole = "0", fraction] = amount.split(".");
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = fraction === undefined ? "" : fraction.replace(/0+$/, "");
  return cents.length === 0
    ? withCommas
    : `${withCommas}.${cents.padEnd(2, "0").slice(0, 2)}`;
}

export function money(currencyCode: string, amount: string): string {
  return `${currencyCode} ${grouped(amount)}`;
}

function floored(value: {
  readonly value: number | null;
  readonly belowFloor: boolean;
}): string {
  return value.belowFloor ? "Fewer than 3" : String(value.value ?? 0);
}

// --- CSV -----------------------------------------------------------------------

function cell(value: string | number): string {
  const text = String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function csv(rows: readonly (readonly (string | number)[])[]): string {
  return `${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}

export function resultsCsv(results: FounderResults | InvestorResults): string {
  const rows: (string | number)[][] = [
    ["Capital Q results report"],
    ["Organisation", results.organisationName],
    ["Period", results.window.label],
    [],
  ];
  if (results.side === "FOUNDER") {
    rows.push(["Raise"]);
    if (results.raise === null) {
      rows.push(["Not stated"]);
    } else {
      rows.push([
        "Target",
        results.raise.target === null
          ? "Not stated"
          : money(
              results.raise.target.currencyCode,
              results.raise.target.amount,
            ),
      ]);
      for (const total of results.raise.totals) {
        rows.push(["Confirmed", money(total.currencyCode, total.confirmed)]);
        rows.push(["Soft", money(total.currencyCode, total.soft)]);
      }
      rows.push(["Remaining", results.raise.remaining ?? "Not stated"]);
      rows.push(["Investors in conversation", results.raise.inConversation]);
      rows.push([]);
      rows.push(["Investor", "Commitment", "Status"]);
      for (const investor of results.raise.committedInvestors) {
        rows.push([
          investor.investorName,
          money(investor.currencyCode, investor.amount),
          investor.bucket === "CONFIRMED" ? "Confirmed" : "Soft",
        ]);
      }
    }
    rows.push([], ["Investor engagement (recorded events)"]);
    rows.push(["Interests received", results.engagement.interestsReceived]);
    rows.push(["Connections", results.engagement.connections]);
    rows.push(["Meetings held", results.engagement.meetingsHeld]);
    rows.push([
      "Investor firms that opened your profile",
      floored(results.engagement.profileOpens),
    ]);
    rows.push([
      "Investor firms that watched your pitch",
      floored(results.engagement.pitchWatches),
    ]);
    rows.push([], ["Pipeline", "Stage", "Since"]);
    for (const row of results.pipeline.rows) {
      rows.push([
        row.investorName,
        stateWords(row.state),
        row.since.slice(0, 10),
      ]);
    }
    rows.push([], ["Rehearsals", "Outcome", "Score", "Ratings"]);
    for (const r of results.rehearsals) {
      rows.push([
        `${r.at.slice(0, 10)} · ${r.counterpart}`,
        r.outcome === null ? "Not stated" : sentence(r.outcome),
        r.score === null ? "Not stated" : r.score,
        r.ratings
          .map((x) => `${sentence(x.dimension)}: ${sentence(x.rating)}`)
          .join("; "),
      ]);
    }
    rows.push([], ["Documents made", "Count"]);
    for (const d of results.documents) rows.push([sentence(d.type), d.count]);
  } else {
    rows.push(["Deal flow (distinct companies)"]);
    rows.push(["Seen", results.funnel.seen]);
    rows.push(["Saved", results.funnel.saved]);
    rows.push(["Interest expressed", results.funnel.interest]);
    rows.push(["Connected", results.funnel.connected]);
    rows.push(["Met", results.funnel.met]);
    rows.push(["Committed", results.funnel.committed]);
    rows.push([], ["Meetings held", results.meetings.held]);
    rows.push(["Upcoming meeting", "Starts (UTC)"]);
    for (const m of results.meetings.upcoming)
      rows.push([m.companyName, m.startsAt]);
    rows.push([], ["Q's work for you", "Count"]);
    for (const run of results.qWork.runs)
      rows.push([sentence(run.capability), run.runs]);
    rows.push(["Errands run", results.qWork.errands]);
    rows.push(["Documents prepared", results.qWork.documents]);
    rows.push([], ["Pipeline", "Stage", "Mandate fit"]);
    for (const row of results.pipelineFit) {
      rows.push([
        row.companyName,
        stateWords(row.state),
        row.excluded
          ? "Hits a declared exclusion"
          : row.reasons.length === 0
            ? results.hasMandate
              ? "No declared overlap yet"
              : "No mandate on file"
            : row.reasons
                .map((r) => `${reasonWords(r.kind)}: ${r.detail}`)
                .join("; "),
      ]);
    }
  }
  return csv(rows);
}

// --- PDF -----------------------------------------------------------------------

function lines(
  entries: readonly (readonly [string, string | number])[],
): string {
  return entries.map(([term, value]) => `${term}: ${String(value)}`).join("\n");
}

export function resultsDocument(
  results: FounderResults | InvestorResults,
  generatedOn: string,
): ArtifactDocument {
  const sections: { heading: string; body: string; findings: never[] }[] = [];
  if (results.side === "FOUNDER") {
    const raise = results.raise;
    sections.push({
      heading: "Raise progress",
      body:
        raise === null
          ? "Not stated. Set a raise on Capital to track it here."
          : [
              `Target: ${raise.target === null ? "Not stated" : money(raise.target.currencyCode, raise.target.amount)}`,
              ...raise.totals.map(
                (t) =>
                  `Confirmed ${money(t.currencyCode, t.confirmed)} · Soft ${money(t.currencyCode, t.soft)}`,
              ),
              `Remaining: ${raise.remaining ?? "Not stated"}`,
              `Investors in conversation without a commitment: ${String(raise.inConversation)}`,
              ...raise.committedInvestors.map(
                (i) =>
                  `${i.investorName}: ${money(i.currencyCode, i.amount)} (${i.bucket === "CONFIRMED" ? "confirmed by both sides" : "soft"})`,
              ),
            ].join("\n"),
      findings: [],
    });
    sections.push({
      heading: "Investor engagement",
      body: lines([
        ["Interests received", results.engagement.interestsReceived],
        ["Connections", results.engagement.connections],
        ["Meetings held", results.engagement.meetingsHeld],
        [
          "Investor firms that opened your profile",
          floored(results.engagement.profileOpens),
        ],
        [
          "Investor firms that watched your pitch",
          floored(results.engagement.pitchWatches),
        ],
      ]),
      findings: [],
    });
    sections.push({
      heading: "Pipeline",
      body:
        results.pipeline.rows.length === 0
          ? "No relationships yet."
          : [
              results.pipeline.byState
                .map((s) => `${stateWords(s.state)}: ${String(s.count)}`)
                .join(" · "),
              ...results.pipeline.rows
                .slice(0, 60)
                .map(
                  (r) =>
                    `${r.investorName} — ${stateWords(r.state)} since ${r.since.slice(0, 10)}`,
                ),
            ].join("\n"),
      findings: [],
    });
    sections.push({
      heading: "Rehearsals",
      body:
        results.rehearsals.length === 0
          ? "No finished rehearsals in this period."
          : results.rehearsals
              .slice(0, 30)
              .map(
                (r) =>
                  `${r.at.slice(0, 10)} with ${r.counterpart}${r.score === null ? "" : ` · score ${String(r.score)}`}${
                    r.ratings.length === 0
                      ? ""
                      : ` · ${r.ratings.map((x) => `${sentence(x.dimension)} ${sentence(x.rating).toLowerCase()}`).join(", ")}`
                  }`,
              )
              .join("\n"),
      findings: [],
    });
    sections.push({
      heading: "Documents made",
      body:
        results.documents.length === 0
          ? "None in this period."
          : results.documents
              .map((d) => `${sentence(d.type)}: ${String(d.count)}`)
              .join("\n"),
      findings: [],
    });
  } else {
    const f = results.funnel;
    sections.push({
      heading: "Deal flow",
      body: lines([
        ["Seen", f.seen],
        ["Saved", f.saved],
        ["Interest expressed", f.interest],
        ["Connected", f.connected],
        ["Met", f.met],
        ["Committed", f.committed],
      ]),
      findings: [],
    });
    sections.push({
      heading: "Meetings",
      body: [
        `Held in this period: ${String(results.meetings.held)}`,
        ...results.meetings.upcoming.map(
          (m) =>
            `Upcoming: ${m.companyName}, ${m.startsAt.slice(0, 16).replace("T", " ")} UTC`,
        ),
      ].join("\n"),
      findings: [],
    });
    sections.push({
      heading: "Q's work for you",
      body: [
        ...results.qWork.runs.map(
          (r) => `${sentence(r.capability)}: ${String(r.runs)}`,
        ),
        `Errands run: ${String(results.qWork.errands)}`,
        `Documents prepared: ${String(results.qWork.documents)}`,
      ].join("\n"),
      findings: [],
    });
    sections.push({
      heading: "Mandate fit of your pipeline",
      body:
        results.pipelineFit.length === 0
          ? "No open relationships."
          : results.pipelineFit
              .slice(0, 60)
              .map(
                (row) =>
                  `${row.companyName} (${stateWords(row.state)}): ${
                    row.excluded
                      ? "hits a declared exclusion"
                      : row.reasons.length === 0
                        ? results.hasMandate
                          ? "no declared overlap yet"
                          : "no mandate on file"
                        : row.reasons
                            .map(
                              (r) =>
                                `${reasonWords(r.kind).toLowerCase()} ${r.detail}`,
                            )
                            .join(", ")
                  }`,
              )
              .join("\n"),
      findings: [],
    });
  }
  return {
    kind: "Results report",
    title: `${results.organisationName} — results`,
    summary: `${results.window.label}. Counts of recorded events on Capital Q.`,
    dateline: `Generated ${generatedOn}`,
    sections,
    gaps: [],
    notice:
      "Built from what was recorded on Capital Q. Commitments count as confirmed only when both sides confirmed them. Not financial advice.",
  };
}

export async function resultsPdf(
  results: FounderResults | InvestorResults,
  generatedOn: string,
): Promise<Uint8Array> {
  return documentToPdf(resultsDocument(results, generatedOn), {
    title: `${results.organisationName} — results`,
    company: results.organisationName,
  });
}
