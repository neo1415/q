# Design audit: admin console, organisation admin, pricing, FAQ, legal and import

- Date: 2026-11-19. Base `fix/resume-asking-cv9ru3` @ `0b5581d3e` (production).
- Method:
  - **Public and organisation pages:** production, signed in as the fictional founder `founder.ledgerbridge@fictional.capitalq.local` (owner of LedgerBridge).
  - **Platform console:** a local stack at the same commit (Supabase CLI, migrations applied, local API and web). The console needs a platform-admin row, and the only one in production belongs to the owner's real account, which this audit must not use. Locally, the throwaway `dev-member@capitalq.local` was given `platform_owner` in the local database only. Local data is nearly empty, so these screenshots also show the empty states.
  - Screenshots: desktop 1440 × 900 and phone 390 × 844, light theme, full page capped at 3,600 px. Filenames are `<page>-<desktop|phone>.png`.
  - Heuristics: Nielsen H1–H10, Krug's navigation checks, posture (an admin console is _sovereign_: dense, keyboard-first, long sessions), and WCAG 2.2 AA.
- Grades: **A** enterprise-ready · **B** sound, needs polish · **C** usable but weak · **D** hard to use or find · **F** broken or absent.

## Verdict

The owner is right. The admin work exists in code, with 23 console pages, 40+ admin API routes and sound authorisation (ADR 0033: roles, step-up, break-glass, audited writes). The interface over it is not an admin product. It is a product page with a 16-item horizontal tab strip, with no grouping, browse tables, filters, bulk actions, search across entities, health or keyboard model. Organisation administration has no home at all. On production, pricing and every legal page say "This page is being prepared". What the owner "can't see" is real. Some of it is unpublished, and the rest is unreachable or unrecognisable as admin.

## Worst findings (severity 4 = blocks the task, 3 = major)

| #   | Sev | Finding                                                                                                                                                                                                                     | Evidence                                            | Principle                                 |
| --- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------- |
| 1   | 4   | **Pricing and all 7 legal pages are unpublished on production.** Visitors see "This page is being prepared", though decision 107 requires default content. The footer links all lead there                                  | `public-pricing-*.png`, `public-legal-terms-*.png`  | H1, goodwill (Krug)                       |
| 2   | 4   | **Organisations and People lists are blank until you type 2 characters.** An operator can't browse, sort or see how many there are                                                                                          | `admin-organisations-*.png`, `admin-accounts-*.png` | H6 recognition over recall, H7            |
| 3   | 3   | **The console nav is 16 peers in one horizontal scrolling strip,** with no groups or counts, and it wraps or hides on phones. Labels mix jobs ("Kill switches", "Analytics privacy", "Etiquette", "Team")                   | `admin-overview-*.png`                              | Hick, Miller, IA organisation             |
| 4   | 3   | **No organisation admin.** Team, Plan, Usage, Activity, Data and Connections are rows inside personal Settings, between Q's voice and the theme picker. An owner managing seats has to know to look under "Settings → Team" | `org-settings-*.png`, `org-team-*.png`              | Mental model, IA labelling                |
| 5   | 3   | **Settings links Brand and Etiquette to `/admin/*`,** which are platform-wide operator settings. Only operators see the links, but org owners have no equivalent for their own brand or guide                               | `settings-view.tsx` `canBrand`                      | H4 consistency, scope confusion           |
| 6   | 3   | **CRM import is linked only from inside the Pipeline view,** with no sidebar entry and no CRM header button. Three names for one place: sidebar "CRM", page "Fundraising Hub", back-link "Relationships"                    | `crm-desktop.png`, `crm-import-*.png`               | Discoverability, H4                       |
| 7   | 3   | **The Plan page shows "Not included" rows** (Viewer identity, Capital Readiness Blueprint) and "Not for your side". That reads as feature locks, against decision 106 (plans are allowances, never feature locks)           | `org-plan-desktop.png`                              | Product rule, H2                          |
| 8   | 3   | **The console overview is a stack of tables.** There are no KPIs, no "today", no health, no deployed version, and no chart anywhere in the console                                                                          | `admin-overview-*.png`                              | Posture (sovereign), H1                   |
| 9   | 2   | **Sidebar double-active:** on `/settings/usage` both Usage and Settings are highlighted                                                                                                                                     | `org-usage-desktop.png`                             | H1, "you are here"                        |
| 10  | 2   | Q's greeting bubble opens over Settings content on phones and repeats itself ("Your plan is ready, Your plan is ready")                                                                                                     | `org-settings-phone.png`                            | H8; flagged to the Q lane, not fixed here |
| 11  | 2   | No breadcrumbs anywhere in the console; record pages use a back-link only. Page titles repeat the strip label                                                                                                               | console pages                                       | Navigation (Krug)                         |
| 12  | 2   | Empty states in the console are text-only and offer no next action ("No entries", "Nothing to review")                                                                                                                      | admin pages                                         | Blank-slate pattern                       |
| 13  | 2   | The public phone header has no Pricing or FAQ link (footer only). The desktop header has them                                                                                                                               | `public-faq-phone.png`                              | Jakob's law                               |

## Page-by-page grades

Discoverability means how you get there. Density means information per screen for the job. Hierarchy means whether the main thing is the most prominent thing. Consistency means whether it matches its siblings. Empty means the empty state. Enterprise means readiness for a multi-operator, audited back office.

### Platform console (`/admin/*`)

| Page                                 | Disc. | Density | Hierarchy | Consist. | Empty | Enterprise | Notes                                                                                                                                      |
| ------------------------------------ | ----- | ------- | --------- | -------- | ----- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Overview `/admin`                    | C     | C       | D         | C        | C     | D          | Stacked sections: Waiting on you, figures as a definition list, Paused by Q, Attribution table, Disputes. No KPIs, period, health or chart |
| Accounts `/admin/accounts`           | C     | F       | C         | B        | D     | F          | Search-only; empty until 2 characters; no table, filters or export                                                                         |
| Account detail                       | C     | C       | C         | C        | C     | D          | Back-link, sections, suspend control; no tabs, timeline or breadcrumb                                                                      |
| Organisations `/admin/organisations` | C     | F       | C         | B        | D     | F          | Same as Accounts                                                                                                                           |
| Organisation detail                  | C     | C       | C         | C        | C     | D          | Plan, override and suspension sit in one column; no members or documents tabs                                                              |
| Queue `/admin/queue`                 | C     | B       | B         | B        | C     | C          | Tabs for verification and reviews; the nearest thing to a real tool                                                                        |
| Safety + break-glass                 | C     | B       | B         | B        | C     | C          | Sound flow; generic layout                                                                                                                 |
| Q monitor `/admin/q` + run trace     | C     | B       | C         | C        | C     | C          | Latency and spend tables exist; no chart; spend lives on two pages (Q and Billing)                                                         |
| Audit `/admin/audit`                 | C     | C       | C         | C        | C     | C          | Filters and CSV exist; list rows not a table; reads not logged                                                                             |
| Kill switches `/admin/flags`         | C     | B       | B         | B        | n/a   | C          | Fine as a settings page                                                                                                                    |
| Analytics privacy                    | D     | C       | C         | B        | n/a   | D          | Named "Analytics" in places, but it is a privacy toggle; no product analytics                                                              |
| Claims `/admin/claims`               | C     | C       | C         | C        | C     | C          | Separate from verification, though both are trust queues                                                                                   |
| Site content (CMS)                   | D     | B       | B         | B        | C     | C          | Editor exists; the list doesn't show that public pages are unpublished (→ finding 1)                                                       |
| Brand `/admin/brand`                 | D     | B       | B         | B        | n/a   | C          | Platform look, but linked from personal Settings (finding 5)                                                                               |
| Etiquette `/admin/etiquette`         | D     | B       | B         | B        | n/a   | C          | House guide; same placement issue                                                                                                          |
| Billing `/admin/billing`             | C     | C       | C         | C        | C     | D          | Fee rate, entries, model cost by tenant/person; no totals, ledger or invoices                                                              |
| Email `/admin/email`                 | C     | B       | B         | B        | B     | C          | Honest sender status and failures                                                                                                          |
| Team `/admin/team`                   | C     | B       | B         | B        | n/a   | C          | Roles matrix exists. "Team" collides with an org's team                                                                                    |

### Organisation pages (in personal Settings today)

| Page                          | Disc. | Density | Hierarchy | Consist. | Empty | Enterprise | Notes                                                                                                                        |
| ----------------------------- | ----- | ------- | --------- | -------- | ----- | ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Settings `/settings`          | B     | C       | C         | B        | n/a   | D          | One long page that mixes personal settings (voice, theme, sounds) with organisation administration (team, plan)              |
| Team `/settings/team`         | D     | C       | B         | B        | B     | C          | Clear invite form and role explanation; members as cards, not a table; no seat count, two-step status, last active or export |
| Plan `/settings/plan`         | C     | B       | C         | B        | n/a   | C          | Comparison grid reads as a public pricing page; "Not included" rows contradict decision 106                                  |
| Usage `/settings/usage`       | C     | C       | C         | B        | B     | C          | Is it personal or the organisation's usage? The page doesn't say. Six identical cards; double-active nav                     |
| Billing `/settings/billing`   | D     | n/a     | n/a       | n/a      | n/a   | D          | Redirects to Plan; no invoices or payment method                                                                             |
| Data `/settings/data`         | C     | B       | B         | B        | n/a   | C          | Personal data rights; no organisation export                                                                                 |
| Activity `/settings/activity` | D     | B       | B         | B        | B     | C          | The org's audit trail exists but is linked only from Team                                                                    |
| Security `/settings/security` | C     | n/a     | B         | B        | n/a   | D          | Personal only; no org policy (require two-step)                                                                              |

### Public pages and import

| Page                               | Disc. | Density | Hierarchy | Consist. | Empty | Enterprise | Notes                                                                                             |
| ---------------------------------- | ----- | ------- | --------- | -------- | ----- | ---------- | ------------------------------------------------------------------------------------------------- |
| Pricing `/pricing`                 | B     | F       | n/a       | B        | F     | F          | Unpublished placeholder on production                                                             |
| FAQ `/faq`                         | B     | B       | B         | B        | n/a   | B          | Clean accordion, grouped by audience; the best public page                                        |
| Legal `/legal/*`                   | B     | F       | n/a       | B        | F     | F          | All unpublished                                                                                   |
| CRM import `/relationships/import` | D     | B       | A         | B        | B     | B          | Clear 4-step stepper, safety note, private prospects. The page is good; the problem is finding it |

## What is good and must be kept

- **Authorisation:** non-admins get a 404 (`admin-as-founder-desktop.png`). Every write needs step-up and is audited. Break-glass is two-person and logged per read. The redesign changes presentation only.
- **Plain, honest copy:** "Amounts are approximate and nothing here is charged", "Nothing is imported until you approve", and the role explanations on Team.
- **Token discipline:** pages use `--cq-*` tokens and the shared `PageSection`/`EmptyState`/`ErrorState` parts, so a shared shell can be applied without rewriting each page.
- **The import flow and the FAQ** are good pages that only need a way in.

## Files

All PNGs in this folder. The design that answers this audit is [`../admin-2026-11-19/DESIGN.md`](../admin-2026-11-19/DESIGN.md), with the mockup.
