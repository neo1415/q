# Proposal: a "Raising now" filter on Discover

Status: **PROPOSED**. Nothing is built. It needs the coordinator's approval, and the owner's if it changes the filter sheet.
Origin: QA F-114 (25 Oct 2026, savanna-seed, 07a748ac), plus a fix to F-114 itself.

## Problem

"Only fintech ones in Kenya or Nigeria that are raising now." is answered in the thread from the catalog, where `discover_companies {raising: true}` keeps companies that state a current raise the reader may see. The fix to F-114 stops Q from sending this narrowing to the Discover page unless the person asked for it.

When they do ask ("show me those on Discover"), the page has no way to say "raising now":

- `DiscoverFilters` (`packages/contracts/src/http/discovery.ts`) only has `raiseDisclosedOnly`, which means "the raise is shared with this reader". That is a different thing. A raise stated in a pitch counts as raising for the rank, but it is not a shared raise.
- `raise {min,max,currency}` is a range, not a state.

So today Q can either drop "raising now" from the page, or approximate it with `raiseDisclosedOnly`. The approximation is what produced "No companies match these filters". The current fix drops it, and the thread answer carries it.

## Proposed contract change

1. `DiscoverFiltersSchema` gains `raisingNow: z.boolean().default(false)`. It is additive and defaults to false. Old clients and stored URLs parse as before.
2. Meaning: only companies whose current raise the reader may see. This is the same read the Discover rank and the cards use (`raisesOf`, `discover-companies.ts`). It is never inferred from absence: a company with no raise on record is left out of this view, not marked "not raising" (unknown stays unknown).
3. The rule is the same in both places, `discover_companies` and the Discover slate, so the thread and the page agree on the count.
4. The URL and the filter sheet get one chip, "Raising now", next to the raise controls. `activeDiscoverFilterCount` counts it inside the raise group.
5. `set_discover_filters` gains `raisingNow`. The tool-port rule (`discoverFilterDecision`) keeps it only when the turn reader read `raising: true`, like the other stated qualifiers. It is never derived from `raiseDisclosedOnly`.

## Owners and order

- Contracts plus slate filter: the discovery lane. This touches the precomputed slate read projection. It is a filter over the existing raise read, not a new ranking feature. No LLM is involved.
- Filter sheet chip: the web Discover lane.
- Tool argument plus port rule: Lane 8, after the contract lands.

## Tests (when built)

- Slate: the filter keeps companies with a visible current raise. It drops companies with none on record, and does not label them "not raising". It respects each reader's raise visibility, with a cross-tenant negative test.
- Contract: the default is false, old payloads parse, and the filter count is correct.
- Port: a reading with `raising` sets `raisingNow`, and a model-added `raisingNow` without the reading is dropped.
