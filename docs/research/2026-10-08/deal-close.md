# Deal close: after the meeting, to a clean end (2026-10-08)

Founder: "After a meeting, how do we close deals? How do we end the user
journey of the investors and the founders and do it cleanly, and have reports
generated at every point that can be used as audit or reports."

Sources: working knowledge of early-stage practice (YC post-money SAFE user
guide, NVCA model documents, standard UK/US seed term sheets) and the public
product surfaces of Carta, AngelList, Visible and DealRoom-style deal tools.
Nothing here is a live-provider claim; it is background for the design.

## 1. How an early-stage round actually closes

| Step | What happens | Evidence that it happened |
| --- | --- | --- |
| Meeting(s) | Partner meeting, follow-ups, maybe a partner-meeting pitch | Calendar, notes |
| Diligence | Data room, reference calls, customer calls, cap table, financials | Questions asked/answered, documents shared |
| Soft commit | "We're in for $250k if the round comes together"; often conditional (lead found, round size, valuation) | Email / verbal; not binding |
| Terms | SAFE (cap, discount, MFN, pro-rata side letter) **or** convertible note (cap, discount, interest, maturity) **or** priced round term sheet (pre-money, option pool, liquidation pref, board, pro-rata, info rights). Term sheet usually non-binding except confidentiality/exclusivity | Term sheet / SAFE PDF |
| Confirmatory diligence + legal docs | Priced: SPA, SHA/IRA, articles; SAFE: the SAFE itself + side letter | Drafts, redlines |
| Signing | DocuSign/Carta signature by both sides | Signed PDF, signature certificate |
| Funds wired | Investor wires against wire instructions; founder confirms receipt (wire fraud: always verify instructions out-of-band) | Bank confirmation |
| Close | Company counter-signs/issues; cap table updated; share certificates / SAFE register; first close and later closes (tranches) are common | Closing set, cap table entry |
| Post-close | Investor update cadence (monthly or quarterly), board/observer seat, info rights, portfolio onboarding (who to contact, reporting template) | Updates sent |

Key facts for the model:

- **Soft commit is not money.** It is a stated intention, often conditional. Platforms that count soft commits as raised mislead founders.
- **Money counts when received**, not when signed or wired. The founder's side confirms receipt.
- **Rounds have multiple closes.** One relationship = one investor's participation; a round is the company's book across many relationships (Capital Q already models this: `core.capital_rounds`, commitments with `round_id`, raised = RECEIVED sum).
- **Terms are versioned.** A term sheet gets revised (cap moves, pro-rata added). Corrections are new versions, never edits.
- **Signature is a fact with a document**, not a checkbox. E-signature itself is out of scope; we record "signed" against the uploaded signed document.

## 2. Pass / decline etiquette

- Pass fast, pass clearly; "not now" beats silence. Founders rank "investors who ghost" as the worst behaviour.
- Give a reason when you can, in one or two honest lines (stage, sector, timing, valuation, team fit), without lecturing.
- Leave the door open only if you mean it ("keep us posted at Series A").
- Never forward the deck or materials after passing; data-room access should be revoked/expire.
- The pass reason stays private to the investor unless they choose to share it (already Capital Q's founder decision (a)).

## 3. What the platforms show

| Platform | Relevant surface | What we take |
| --- | --- | --- |
| Carta | Round closing workflow: investors, amounts, docs to sign, funds status per investor, then cap table issued; audit log of signatures | Per-investor checklist (terms → signed → funds → issued) and a closing set |
| AngelList (RUV/SPV/Stack) | Commitment → sign docs → wire → "Closed" with a closing statement per investor; post-close K-1s/updates | Clear final state + downloadable closing statement |
| Visible | Investor updates and portfolio reporting after close; update cadence templates | Post-close update cadence suggestion, portfolio entry |
| DealRoom / Affinity / DealCloud-style pipelines | Stage pipeline (Sourced → Met → Diligence → IC → Term sheet → Closed / Passed) with stage dates | One stage strip, both parties, dates per stage |
| Ironclad / DocSend / data rooms | Document version + who-viewed + signed copy | Documents attached to the stage they evidence |

## 4. Implications for Capital Q

1. **No deal record.** The ONE canonical relationship carries it. Stages are a deterministic reading of `network.relationship_events` (+ the commitment and terms rows), never stored state, never an LLM.
2. Reuse what exists: pass/pause/diligence (`relationship_*` events), commitments (SOFT/FIRM/INVESTED, transfer sent, received; round = tranche book). Add only what is missing: **terms** (versioned), **signed** (with the signed document), **closed** (both sides' clean end), and **reports**.
3. Final states keep the projection vocabulary: `INVESTED` (closed-invested) and `PASSED`. Closing is recorded by a new `deal_closed` event that the deal-stage reading folds into CLOSED; relationship-state.v2 treats it as activity (money already moved the state to INVESTED on receipt).
4. Each step is consequential (ADR 0043 TERMS/MONEY), approval-bound and idempotent; Q prepares and summarises, a person approves the exact card.
5. Reports are deterministic compilations of the record (audit-grade), versioned and append-only, with explicit visibility: investor-private memo and pass report; relationship-shared meeting, diligence and closing reports. PDF via the existing document renderer.
6. Clean ends: Closed → investor portfolio entry + founder "investor onboarded" checklist + update-cadence suggestion. Passed → archived (never deleted), respectful message drafted for approval, final state visible to both.
