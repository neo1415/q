# Unicorn Potential Discover — 17 October 2026

Owner: isolated `codex/unicorn-discover-oct17`, based on `32f0f4d7`. Integration and production release remain with the main workstream owner.

Implemented explicit optional `unicornPotentialMin` (0–100) and `unicornPotentialSort` Discover filters in the existing contracts, query serialization, browser draft/apply controls and slate reader. Default filters and `fit-order.v2` remain unchanged. The choice is labelled Premium and carries the growth-characteristics caveat.

The optional `UnicornPotentialDiscoverPort.readMany({actor,companyIds})` returns an authorized persisted score map, or null for denied premium access. Empty IDs must still check entitlement. Root composition must wire the existing billing check and source-current assessment store, and map `UnicornPotentialDiscoverDeniedError` to 403. No assessment recomputation or model calls occur here.

Premium selection reads only the existing bounded slate and existing plan-volume cut; current eligibility, suppression, cards and other filters run before score lookup. Unavailable scores are withheld rather than converted to zero. Explicit sorting has deterministic canonical-rank tie breaks. Continuations retain the original slate-rank keyset and a digest of the currently authorized ordered company IDs; changes restart safely. Scores are not embedded in cursors or page DTOs. Every page reauthorizes; there is no assessment cache in this lane.

Local validation: discovery dependency build passed all 17 targets (3 cache hits); 45 focused contracts/slate-reader tests passed. Changed backend lint and formatting are checked before push. The integrated web filter test, web typecheck, protected CI and authenticated browser acceptance remain integration-owner gates, as agreed to avoid another large dependency build. No migration, deployment or authenticated production acceptance is performed by this lane. Broader API/Q entitlement composition and assessment persistence are independently owned.
