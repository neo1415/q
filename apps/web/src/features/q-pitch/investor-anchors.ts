import type { AnchorPlacement } from "./section-light";

/**
 * Where the investor track's sections are, by the pages' own stable markers
 * (inventory: docs/specs/q-pitch/V6-PLAN.md §2, production DOM 17 Oct).
 * Keeping the table here means no page encodes a tour step number; a page
 * that renames a marker fails apps/web/test/q-pitch-investor-anchors.test.ts
 * and the step falls back honestly instead of lighting the wrong thing.
 */
const OVERVIEW = (key: string): AnchorPlacement => ({
  select: `[data-profile-section="${key}"]`,
});

export const INVESTOR_ANCHORS: Readonly<Record<string, AnchorPlacement>> = {
  // 2. The three best fits, as answer cards; open = into the spotlight.
  "inv.02.match.card-1": {
    select: '[data-ac-cards] [data-ac-rank="1"]',
    tap: "[data-ac-strip], .cq-ac-head-main",
  },
  "inv.02.match.card-2": {
    select: '[data-ac-cards] [data-ac-rank="2"]',
    tap: "[data-ac-strip], .cq-ac-head-main",
  },
  "inv.02.match.card-3": {
    select: '[data-ac-cards] [data-ac-rank="3"]',
    tap: "[data-ac-strip], .cq-ac-head-main",
  },
  // 3. Discover.
  "inv.03.discover.card": {
    select: '[data-q-control="carousel.feed"] article[data-company-id]',
  },
  "inv.03.discover.why": {
    select: '[data-q-control="carousel.feed"] article[data-company-id] h3',
  },
  // 4. The profile's Overview, section by section.
  "inv.04.profile.overview": { select: "[data-profile-carousel]" },
  "inv.04.profile.problem": OVERVIEW("problem"),
  "inv.04.profile.solution": OVERVIEW("solution"),
  "inv.04.profile.business-model": OVERVIEW("business_model"),
  "inv.04.profile.moats": OVERVIEW("moats"),
  "inv.04.profile.ask": OVERVIEW("ask"),
  // 5. Diligence: folds open as Q reaches them.
  "inv.05.profile.questions": {
    select: '[data-overview-fold="company-assumptions"]',
  },
  "inv.05.profile.raise": { select: '[data-overview-fold="company-raise"]' },
  "inv.05.profile.unknowns": {
    select: '[data-overview-fold="company-unknowns"]',
  },
  "inv.05.profile.evidence": { select: '[data-deeper-view="evidence"]' },
  // 6-9. The other tabs.
  "inv.06.profile.elevator": { select: "[data-profile-elevator]" },
  "inv.07.profile.dataroom": { select: "[data-data-room]" },
  "inv.07.profile.requestable": {
    select: '[data-room-document="REQUESTABLE"]',
  },
  "inv.08.profile.deck-read": { select: "[data-deck-read]" },
  "inv.08.profile.deck": { select: "[data-deck-carousel]" },
  "inv.09.profile.team": { select: '[data-profile-panel="team"]' },
  // 10. Explore.
  "inv.10.explore.mosaic": { select: "[data-explore]" },
  "inv.10.explore.tile": { select: '[data-explore-tile][data-rank="0"]' },
  // 11-13. One relationship.
  "inv.11.relationship.hero": { select: "[data-relationship-hero]" },
  "inv.11.relationship.history": {
    select: '[data-q-control="section.relationship-history"] > *',
  },
  "inv.11.relationship.notes": { select: "[data-relationship-notes]" },
  "inv.11.relationship.next": { select: "[data-relationship-brief]" },
  "inv.12.relationship.chat": { select: "[data-relationship-chat]" },
  "inv.13.relationship.schedule": { select: "[data-relationship-schedule]" },
  // 14. Capital.
  "inv.14.capital.commitments": { select: "section#commitments" },
  "inv.14.capital.needs-you": { select: 'section[aria-label="Needs you"]' },
  "inv.14.capital.mandate": { select: "section#mandate" },
  // 15-16. The CRM.
  "inv.15.crm.needs-you": { select: "section#needs-you" },
  "inv.15.crm.portfolio": { select: "section#portfolio" },
  "inv.15.crm.period": {
    select: '[data-q-control="section.hub-overview"] > *',
  },
  "inv.16.crm.pipeline": { select: "[data-relationships-list]" },
  // 17-18. Q Work.
  "inv.17.work.running": { select: "[data-work-running]" },
  "inv.17.work.needs-you": { select: "[data-work-needs-you]" },
  "inv.17.work.done": { select: "[data-work-done]" },
  "inv.18.work.team": { select: "[data-workforce-team]" },
  "inv.18.work.plan": { select: "[data-workforce-plan]" },
  // 19. The Q Daily.
  "inv.19.daily.lead": { select: "[data-daily-lead]" },
  "inv.19.daily.take": { select: "[data-daily-edition]" },
  // 20. GateQ.
  "inv.20.gateq.brief": {
    select: 'section[aria-label="Submitted investment brief"]',
  },
  "inv.20.gateq.transcript": {
    select: '[data-q-control="disclosure.gateq-transcript"] > details',
  },
  "inv.20.gateq.shared": { select: "[data-gateq-shared]" },
  // 21. Documents.
  "inv.21.documents.list": { select: "[data-documents-list]" },
};
