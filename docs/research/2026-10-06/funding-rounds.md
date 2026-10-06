# Funding rounds: journeys, edge cases, and what Capital Q supports

Plan P8 (autopilot 2026-10-06). Founder ask: "the different rounds of raising and stuff, make sure the UX and the database and schema support it fully ... research what the user journeys may be like there as well as edge cases and stuff people may not even know they want or need."

This note is product research, not legal advice. It sets the scope of the round model built in P8 (migration `20261209090000_capital_round_lifecycle.sql`).

## 1. How rounds actually happen

- **The stage ladder isn't a straight line.** The usual path is pre-seed, seed, Series A, but bridges and extensions now carry a large share of capital. On Carta in Q2 2025, 16.6% of venture capital raised came through bridge rounds, and 22.5% at Series A. A company often has a "Seed", then a "Seed extension" or "Seed+" from new and existing investors, then a Series A. A bridge mostly comes from existing investors, while an extension often brings in new ones ([Carta: seed extensions](https://carta.com/data/seed-extensions-2023/); [Causo: bridge rounds 2026](https://hub.causo.ai/guides/bridge-rounds-extensions-2026); [VC Beast: extension rounds](https://vcbeast.com/extension-rounds-when-to-bridge-how-to-structure)).
- **Instruments.**
  - SAFEs are pre- or post-money, with a valuation cap, a discount and sometimes an MFN clause.
  - Convertible notes add interest and a maturity date.
  - UK founders use the Advance Subscription Agreement (ASA, e.g. SeedFAST), which is SEIS/EIS friendly.
  - Priced equity rounds carry a pre- or post-money valuation.

  For each SAFE, record the principal, cap, discount, MFN, date and pro-rata rights ([Cake Equity: multiple SAFEs](https://www.cakeequity.com/guides/faq-how-to-model-multiple-safes-mfn); [Carta SAFE calculator](https://carta.com/blog/safe-and-convertible-note-calculator/); [SeedLegals: SeedFAST](https://seedlegals.com/raise/raise-before-a-round/); [Torys: pre- vs post-money SAFE](https://www.torys.com/insights/publications/2021/02/pre-money-versus-post-money-safe)).
- **Closes.** Notes and SAFEs close one investor at a time (a rolling close). Priced rounds have a first close and then later closes before the final close. Money can also come in tranches tied to milestones. A round can be oversubscribed and reopened for a second close, as AngelList did with an extra $44M after its Series B ([Daphni/Carta: issuing SAFEs](https://www.daphni.com/media-hub/the-simplest-way-to-issue-and-fund-safes); [Fortune: AngelList second close](https://fortune.com/2022/04/22/angellist-raises-44-million-from-10-percent-of-customer-base)).
- **Pro-rata.** Pro-rata is a right to buy into a later round to keep your ownership. It usually comes through a side letter, often only for "major investors" above a check-size threshold. YC's side letter ends at the round the SAFE converts in. Example: $2M on a $10M post-money SAFE is about 20%, which the investor can keep through the Series A ([1984 Ventures: post-money SAFE](https://1984.substack.com/p/everything-you-should-know-about-the-new-post-money-safe-agreement-e90f09b9d3a8); [Raise Memo: pro rata in a SAFE](https://theraisememo.beehiiv.com/p/what-is-pro-rata-in-a-safe)).
- **What the tools show.**
  - Carta and Pulley model the cap table and conversions.
  - Visible and DocSend track the investor pipeline and deck engagement.
  - SeedLegals runs the legal process.

  None of them treats a round's lifecycle as a relationship-linked, evidence-aware record, and that is where Capital Q fits ([Visible: fundraising](https://visible.vc/fundraising/); [Pulley](https://pulley.com/use-cases/founders)).

## 2. Journeys we support (P8)

| # | Who | Journey | How |
|---|-----|---------|-----|
| J1 | Founder | Records past rounds raised before Capital Q, e.g. "Pre-seed, 2024, $300k on a SAFE at an $8M cap". | Record a past round: status `CLOSED`, opened and closed dates, and a **reported raised** amount, shown as founder-reported and never mixed with received money. |
| J2 | Founder | Plans the next round, with a target, close date and terms that can stay unknown. | `PLANNED` round with optional terms. It becomes current only when no other round is current. |
| J3 | Founder | Opens the round and tracks commitments, with raised, confirmed and pledged shown against the target. | Unchanged money flow. Commitments still hang off the canonical relationship. |
| J4 | Founder | First close, later closes, and tranches. | Round steps `CLOSE` and `TRANCHE`, each dated with an optional amount and label. The first close moves `OPEN` to `FIRST_CLOSED`. |
| J5 | Founder | Final close. | `FINAL_CLOSE` moves the round to `CLOSED`, which is never current. Closing with nothing received is allowed after a plain-language warning. |
| J6 | Founder | Extends or reopens a closed round (a second close or an extension). | `REOPEN` takes `CLOSED` back to `FIRST_CLOSED` and `CANCELLED` back to `OPEN`, and the event history keeps the earlier close. |
| J7 | Founder | Cancels a round that never happened. | `CANCEL` works from `PLANNED` or `OPEN`. A round where money has closed can't be cancelled; it is final-closed instead. |
| J8 | Founder | Corrects terms (cap, discount, valuation, lead, target). | `REVISE` uses optimistic concurrency (`expectedRevision`). Each revision appends an event with the previous values. Nothing is overwritten silently. |
| J9 | Founder | Names the lead investor. | The lead is either the canonical company-investor relationship or an off-platform name typed by the founder. It is never a parallel CRM record. |
| J10 | Founder | Bridge or extension of a round. | A separate round with `extends_round_id` pointing at the original round of the same company, e.g. "Seed extension" extends "Seed". |
| J11 | Investor | Sees their commitments per round, with the round's terms and status. | Their ledger lists each commitment with the round summary, but only after both sides have confirmed the commitment. |
| J12 | Investor | Asks "what's my ownership and pro-rata?" | The page shows an indicative ownership estimate: their amount divided by the post-money valuation, or by the cap on a SAFE or ASA. It is labelled as an estimate. It also shows the round's pro-rata rights (none, major investors, all, or unknown). |
| J13 | Q | "Open a seed round", "record our first close", "the cap is $10M now", "cancel the bridge". | The `change_my_raise` tool gains `ROUND_STEP` and `REVISE_ROUND`. Every change goes Prepare, then approval card, then execute. Q's round read includes status, terms and closes. |

## 3. Edge cases handled (friendly copy, never a stack trace)

- **Overlapping rounds**, for example a bridge open while the seed is still open: the notice `OVERLAPS_OPEN_ROUND` says "Another round is open at the same time. Investors may ask which one their money goes to." It is allowed, because SAFE bridges really do overlap.
- **Commitment currency differs from the round currency**: the notice `OTHER_CURRENCY` reads "Some commitments are in another currency and aren't counted in this meter." Amounts are never converted.
- **Committed above target (oversubscribed)**: the notice `OVER_TARGET` says the round is oversubscribed. `OVER_HARD_CAP` appears if a hard cap is set.
- **Final close with nothing received**: the founder confirms first ("Nothing has been received in this round on Capital Q. Close it anyway? You can add what it raised outside Capital Q."). The notice `CLOSED_EMPTY` stays until a reported amount exists.
- **Past the target close date** while the round is still open: the notice `PAST_TARGET_CLOSE` nudges the founder to extend the date or close.
- **Reopening**: allowed with a reason, and the earlier close stays in the history.
- **Stale edit** (two founders editing at once): a `409` returns "Someone changed this round while you were editing. Refresh to see the latest."
- **Invalid terms**: a discount must be between 0 and 100. The hard cap must be at least the target. All money is in the round's own currency, so terms can't mix currencies. A date can't fall before the round opened.
- **Unknown stays unknown**: there is no default cap, valuation or pro-rata. A `null` value means "not said", never zero.

## 4. Deliberately not in P8

- Cap-table modelling and SAFE conversion maths. That is Carta's and Pulley's job, and the ownership estimate is labelled as an estimate.
- Note interest and maturity.
- MFN chains.
- Pay-to-play.
- Secondaries (an investor selling to an investor doesn't change the company's round).
- Per-investor side letters. Pro-rata is held at round level, as "major investors" or "all".
- Multi-currency conversion.

These are candidate follow-ups. Each would need its own evidence model.

## 5. Disclosure

- Round rows and their history can be read only by members of the company's organisation (RLS plus the `capital_objective.view` capability).
- An investor sees a round's summary only through their own confirmed commitment in it. They see the name, instrument, status, cap or valuation, discount and pro-rata rights, which are terms they agreed to. They never see the target, totals or other investors.
- Q reads rounds through the same services and capabilities that the Capital page uses.
