import { ProductCapabilitySnapshotSchema } from "./schema.js";

/**
 * Reviewed public product metadata only. This is the one versioned source
 * returned by Q's product-status reader, not specifications as shipped facts.
 * Evidence summaries omit accounts, company names, credentials and private
 * receipts. Updates require release-owner review of the bounded proof.
 */
export const PRODUCT_CAPABILITY_SNAPSHOT = ProductCapabilitySnapshotSchema.parse({
  schemaVersion: 1,
  version: "2026-10-14.1",
  publishedOn: "2026-10-14",
  coverage: "BOUNDED",
  entries: [
    {
      id: "q.discover.analysis-comparison", name: "Discover, company analysis and comparison", statusAtVerifiedRevision: "LIVE",
      evidenceRevision: "37b5414e0cf7cfe09b21ab91544c391605f193a7", verifiedOn: "2026-10-14",
      proof: { kind: "LIVE_BROWSER", summary: "An authorized investor browser journey rendered three genuine mandate-fit company cards, findings bound to the selected company, its risk follow-up and an exact two-company comparison." },
      limits: ["Bounded investor acceptance at the stated revision; not every company, account or model response was tested.", "Mandate fit is not quality, investment interest or a verified financial claim.", "No p50, p95 or voice latency guarantee follows from this acceptance."],
    },
    {
      id: "gateq.interview", name: "GateQ founder interview", statusAtVerifiedRevision: "PARTIAL",
      evidenceRevision: "62bd144af47e20212d3cfe8827a09e7d28132e0f", verifiedOn: "2026-10-14",
      proof: { kind: "LIVE_API", summary: "A fresh authorized application opened its interview, answered, corrected an existing fact and replayed completed retries without duplicated turns. Saved fact history and transcript were checked." },
      limits: ["This proof does not establish the complete Evidence, review, submission and immutable investor dossier journey.", "Qualification, evidence coverage and investment quality remain separate."],
    },
    {
      id: "relationships.hub-overview", name: "Relationship Hub overview", statusAtVerifiedRevision: "PARTIAL",
      evidenceRevision: "a24120bf867882394dd0b30b7d63526e8b4c08d3", verifiedOn: "2026-10-14",
      proof: { kind: "CODE_REVIEW", summary: "Integrated role-aware overview uses authorized Results data and preserves the canonical board. Local real-browser investor/founder desktop/mobile checks and desktop Q navigation passed; protected release CI passed, production rollout acceptance is pending." },
      limits: ["Local browser proof does not establish production rollout or complete Hub acceptance.", "Expanded views, saved filters and cross-artifact workspace behavior are outside this proof."],
    },
    {
      id: "relationships.hub-expanded", name: "Expanded relationship workspace", statusAtVerifiedRevision: "UNVERIFIED",
      evidenceRevision: "a24120bf867882394dd0b30b7d63526e8b4c08d3", verifiedOn: "2026-10-14",
      proof: { kind: "NOT_VERIFIED", summary: "The bounded inventory has no completed acceptance proof for the complete expanded Hub behavior." },
      limits: ["No absence claim follows: existing relationship, meeting, Evidence and Work features may already implement individual behaviors.", "Plans and prototype interactions are not production capability."],
    },
    {
      id: "rehearsal.tavus", name: "Tavus audiovisual rehearsal", statusAtVerifiedRevision: "PARTIAL",
      evidenceRevision: "a24120bf867882394dd0b30b7d63526e8b4c08d3", verifiedOn: "2026-10-14",
      proof: { kind: "CODE_REVIEW", summary: "The existing bounded Tavus rehearsal bridge is implemented. This inventory has no completed audiovisual founder rehearsal and saved-review acceptance proof." },
      limits: ["Conversation creation is not proof of intelligent audiovisual interviewing, reconnect behavior, the three-minute limit or persisted review.", "Provider entitlement and authorized usage limits still apply."],
    },
  ],
});
