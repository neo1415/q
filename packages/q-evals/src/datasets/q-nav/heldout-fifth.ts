import { type CaseSet, decide, dest, turn } from "./build.js";
import type { QNavSide } from "./contracts.js";

/**
 * Q-NAV fifth held-out split (20 Nov 2026): the destinations added after
 * the third and fourth sets were sealed (the organisation admin, its
 * sections and the pipeline import). Kept apart so the earlier sealed
 * sets stay byte-for-byte as measured; sealed itself (heldout-seal.ts).
 * Phrased from each page's purpose, not from the dev banks or page names
 * in page-request.ts.
 */

const I: QNavSide = "INVESTOR";
const F: QNavSide = "FOUNDER";

const ROWS: readonly (readonly [QNavSide, string, string, string])[] = [
  [
    I,
    "Bring up the admin area for our firm.",
    "ORGANISATION",
    "the organisation admin",
  ],
  [
    F,
    "I need the place where our company account is managed.",
    "ORGANISATION",
    "the organisation admin",
  ],
  [
    I,
    "Let me see who has a seat on our account.",
    "ORGANISATION_MEMBERS",
    "members and usage",
  ],
  [
    F,
    "Show me everyone who belongs to our organisation on here.",
    "ORGANISATION_MEMBERS",
    "members and usage",
  ],
  [
    I,
    "Pull up what each role in our firm is permitted to do.",
    "ORGANISATION_ROLES",
    "the organisation roles",
  ],
  [
    F,
    "Where's the page explaining admin versus member rights?",
    "ORGANISATION_ROLES",
    "the organisation roles",
  ],
  [
    I,
    "Take me to our firm's subscription and invoices.",
    "ORGANISATION_PLAN",
    "the organisation's plan and billing",
  ],
  [
    F,
    "Open the billing for our whole company account.",
    "ORGANISATION_PLAN",
    "the organisation's plan and billing",
  ],
  [
    I,
    "Go to the import part of our organisation's admin.",
    "ORGANISATION_IMPORT",
    "the organisation's import section",
  ],
  [
    F,
    "Open the data import section in our org admin.",
    "ORGANISATION_IMPORT",
    "the organisation's import section",
  ],
  [
    I,
    "Show me the log of what people at our firm have changed.",
    "ORGANISATION_ACTIVITY",
    "the activity log",
  ],
  [
    F,
    "I want the record of who did what in our account.",
    "ORGANISATION_ACTIVITY",
    "the activity log",
  ],
  [
    I,
    "Take me where I can upload the deal list from our old CRM.",
    "PIPELINE_IMPORT",
    "the pipeline import",
  ],
  [
    F,
    "Open the screen for bringing my investor spreadsheet in.",
    "PIPELINE_IMPORT",
    "the pipeline import",
  ],
];

export function heldoutFifth(cases: CaseSet): void {
  for (const [side, user, page, why] of ROWS) {
    cases.add("COVERAGE", side, [
      turn(user, decide(side).move(dest(page), why)),
    ]);
  }
}
