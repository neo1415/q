/* eslint-disable no-console -- a developer CLI that says where it put the files */
/**
 * Write a sample deck (QX-004 §5, §6, §7).
 *
 * Composes a deck from a synthetic company's findings exactly as Q does,
 * lays it out, reports anything the inspector finds, and writes the SVG,
 * PPTX and PDF so a person can open them. Nothing here talks to a model
 * or a database: it is the rendering path on its own, which is the part
 * you want to look at with your eyes rather than read a test about.
 *
 *   node scripts/deck-sample.mjs [outDir] [--direction DARK_TECHNICAL]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Imported from the built packages by path: the repository root is not
// a workspace consumer, and a developer script should not become one.
import { composePitchDeck } from "../packages/q-specialists/dist/index.js";
import {
  deckToPdf,
  deckToPptx,
  deckToSvg,
  inspectDeck,
  layOutDeck,
} from "../packages/deck-render/dist/index.js";

const args = process.argv.slice(2).filter((a) => a !== "--");
const directionAt = args.indexOf("--direction");
const direction =
  directionAt === -1 ? "MINIMAL_INSTITUTIONAL" : (args[directionAt + 1] ?? "");
const outDir = resolve(
  args.find((a) => !a.startsWith("--") && a !== direction) ?? "deck-sample",
);

const COMPANY = "f0000000-0000-4000-8000-000000000001";
let seq = 0;
const finding = (dimension, statement, truthClass = "USER_CLAIM") => {
  seq += 1;
  return {
    findingId: `a0000000-0000-4000-8000-0000000000${String(seq).padStart(2, "0")}`,
    type: "FACT",
    statement,
    truthClass,
    evidenceStatus:
      truthClass === "VERIFIED" ? "DOCUMENT_SUPPORTED" : "SELF_REPORTED",
    confidence: "MODERATE",
    subjects: [{ kind: "COMPANY", companyId: COMPANY }],
    evidenceRefs: [],
    dimension,
    derivation: "MODEL",
  };
};

const result = {
  companyId: COMPANY,
  specialistVersion: "company-intelligence/v1",
  asOf: new Date().toISOString(),
  blocked: null,
  findings: [
    finding(
      "DESCRIPTION",
      "Northstar Logistics moves freight between Lagos, Abuja and Kano.",
    ),
    finding(
      "PRODUCT",
      "A mobile app that books spare capacity on trucks already making a journey.",
    ),
    finding(
      "MARKET",
      "Nigerian road freight, where most capacity is booked by phone and half of return legs run empty.",
    ),
    finding(
      "BUSINESS_MODEL",
      "A commission on each booking, taken from the carrier rather than the shipper.",
    ),
    finding("CUSTOMERS", "Eleven shippers under contract, four of them FMCG."),
    finding("TRACTION", "Completed 320 deliveries in June."),
    finding("TRACTION", "Completed 480 deliveries in July."),
    finding("TRACTION", "Completed 610 deliveries in August."),
    finding(
      "TEAM",
      "Three founders; two spent six years operating fleets at a national haulier.",
      "VERIFIED",
    ),
    finding(
      "STRATEGY",
      "Open the Port Harcourt corridor next, where the same shippers already run.",
    ),
    finding(
      "CAPITAL_OBJECTIVE",
      "Raising to fund a second corridor and the operations team to run it.",
    ),
  ],
  coverage: [],
  materialChanges: [],
  contradictions: [],
  informationConfidence: "MODERATE",
  synthesis:
    "Northstar Logistics moves freight between Lagos, Abuja and Kano, selling spare capacity on trucks that are already running.",
  research: null,
  recordedStatements: [],
  artifactRequest: null,
  telemetry: {},
};

const composed = composePitchDeck({
  companyName: "Northstar Logistics",
  result,
  direction,
});
if (composed === null) {
  console.error("the record was too thin to compose a deck from");
  process.exit(1);
}

const laid = layOutDeck(composed.content.deck);
const issues = inspectDeck(laid);

mkdirSync(outDir, { recursive: true });
deckToSvg(laid).forEach((svg, index) => {
  writeFileSync(
    resolve(outDir, `slide-${String(index + 1).padStart(2, "0")}.svg`),
    svg,
    "utf8",
  );
});
writeFileSync(
  resolve(outDir, "deck.pptx"),
  await deckToPptx(laid, {
    title: composed.title,
    company: "Northstar Logistics",
  }),
);
writeFileSync(
  resolve(outDir, "deck.pdf"),
  await deckToPdf(laid, {
    title: composed.title,
    company: "Northstar Logistics",
  }),
);

// One page that shows every slide at once, for looking at.
writeFileSync(
  resolve(outDir, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>${composed.title}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 24px; background: #f2f4f6; font: 15px/1.5 system-ui, sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p { margin: 0 0 20px; color: #5b6570; }
  figure { margin: 0 0 20px; box-shadow: 0 1px 3px rgba(0,0,0,.2); }
  svg { display: block; width: 100%; height: auto; }
</style>
<h1>${composed.title}</h1>
<p>${String(laid.slides.length)} slides · ${issues.length === 0 ? "no layout faults" : `${String(issues.length)} layout faults`}</p>
${deckToSvg(laid)
  .map((svg) => `<figure>${svg}</figure>`)
  .join("\n")}`,
  "utf8",
);

console.log(
  `direction  ${laid.theme.background === "#ffffff" ? direction : direction}`,
);
console.log(`slides     ${String(laid.slides.length)}`);
console.log(`gaps       ${composed.content.gaps.join(", ") || "none"}`);
console.log(
  issues.length === 0
    ? "layout     no faults"
    : `layout     ${String(issues.length)} faults:\n${issues.map((i) => `  slide ${String(i.slide + 1)}: ${i.fault} — ${i.detail}`).join("\n")}`,
);
console.log(`written to ${outDir}`);
