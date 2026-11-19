# Admin, organisation admin and public pages: design (phase 1)

- Status: **PROPOSED**, 2026-11-19. This phase covers design only and adds no feature code. It folds in decision 109: clean up what exists now, and outline the future platform admin product.
- Audit this builds on: [`../audit-2026-11-19/AUDIT.md`](../audit-2026-11-19/AUDIT.md), with screenshots.
- Mockup: [`mockup.html`](mockup.html). Open `#overview`, `#organisations`, `#organisation` or `#members`; add `-k` for the command palette and `?theme=dark` for the dark theme. PNGs sit next to it as `<screen>-<desktop|phone>-<light|dark>.png`.
- Binding: root `CLAUDE.md` (UX, design and prohibited-visual rules), ADR 0017, `docs/design/ux-direction-2026-09.md`, ADR 0033 (operator roles, step-up, break-glass), ADR 0034/0036 (plans), decisions 106 and 107, `--cq-*` tokens only, and WCAG 2.2 AA in light and dark.
- Earlier design this extends rather than replaces: `docs/specs/admin/2026-11-18-admin-ledger-billing-design.md`. That file covers the ledger, spend and billing data. This one covers the shell, the IA and the page templates.

## 0. The problem in one paragraph

The work exists but nobody can find it, and where it can be found it doesn't look like an admin. The platform console is a normal app page with 16 peer tabs in a horizontal strip, and no grouping, search, tables, filters, bulk actions or system health. Organisations and Accounts are blank until you type two characters. Organisation admin has no home: Team, Plan, Usage, Activity, Data and Security hang off a personal Settings page as rows among Q's voice and theme. Brand and Etiquette are linked from personal Settings, but they are platform-wide operator settings, so everyone else gets a 404. On production, the pricing and legal pages show "This page is being prepared", because nothing is published in the CMS. CRM import is reachable only from inside the CRM. The [audit](../audit-2026-11-19/AUDIT.md) grades every screen.

## 1. What "enterprise-level admin" means here

Seven reference products, and the pattern each one proves. We copy the pattern, not the look.

| Pattern                                         | Who does it best                              | What we take                                                                                                                                                                            |
| ----------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persistent left sidebar, grouped by job         | Stripe Dashboard, Okta Admin, Vercel          | 6–7 labelled groups, a count on each queue, and the current page marked by shape (a bar) as well as colour                                                                              |
| Global search and command palette (⌘K / Ctrl K) | Linear, Vercel, GitHub                        | Entities (organisations, people, runs) plus "Go to" commands, scoped to what the role can read. Every open is audited                                                                   |
| Dense data tables                               | Stripe (Payments), Retool                     | 44 px rows, sticky header, sortable columns, column chooser, cursor pagination and tabular numerals                                                                                     |
| Filters as chips, plus saved views              | Linear (views), Stripe (filters)              | Dashed chips that turn solid when set. Saved views appear as tabs above the table, with counts                                                                                          |
| Bulk actions                                    | Stripe, GitHub (issues)                       | A bar replaces the toolbar when rows are selected. Consequential bulk actions need step-up and a reason                                                                                 |
| Export                                          | Stripe, Okta (reports)                        | CSV now, from the current filter. XLSX, JSON and PDF come later (§B). Each export is audited                                                                                            |
| Entity detail = header + tabs + timeline        | Stripe (Customer), Okta (User), GitHub (Org)  | Fixed header (name, facts, primary actions). The tabs are the entity's sub-records. The activity timeline mixes the customer's actions with operator actions, and labels which is which |
| Audit log                                       | Okta (System Log), GitHub (audit log), Vercel | Filters by actor, target, action and time. Each row links to both actor and target. Reads are logged as well as writes                                                                  |
| Roles and permissions                           | Okta, GitHub org roles, Vercel teams          | Fixed, named roles with a "what this role can do" matrix. Elevated actions need step-up                                                                                                 |
| Overview KPIs                                   | Stripe Home                                   | One band of 6 figures. Each one links to its list and shows its comparison window. Unknowns are stated ("38 calls unpriced"), never hidden                                              |
| Environment and system health                   | Vercel (deployments), GitHub status           | Per-service status with one honest number each, plus the deployed version in the sidebar footer                                                                                         |
| Page header and breadcrumbs                     | All of them                                   | The same header on every page: breadcrumb, title, one-sentence purpose, then actions on the right                                                                                       |
| Keyboard                                        | Linear, GitHub                                | ⌘K; `G` then a letter to go to a section; `/` to filter; `J`/`K` to move through table rows; `X` to select; `Esc` to clear                                                              |
| Skeleton loading                                | Stripe, Vercel                                | Skeleton rows matching the table's real geometry. No spinners in place of a page                                                                                                        |
| Empty states with a next action                 | Linear, Vercel                                | Say what would be here and why it is empty, then offer one action. "Type 2 characters" is never an empty state for a list that has data                                                 |

What makes it "enterprise" is predictability rather than decoration. Every list works the same way, every record has the same anatomy, every consequential action has the same confirmation (step-up plus reason), and every action is recorded.

## 2. The two-level model

```
              Capital Q operators                          Each customer tenant
   ┌──────────────────────────────────────┐   ┌─────────────────────────────────────────┐
   │ (a) PLATFORM CONSOLE  /admin          │   │ (b) ORGANISATION ADMIN  /organisation     │
   │ who: identity.platform_admins         │   │ who: owner / admin of THIS organisation  │
   │ roles: owner, operator, T&S, support, │   │ roles: Owner, Admin, Member (+ viewer     │
   │        analyst (ADR 0033)             │   │        later)                             │
   │ scope: every tenant, least privilege, │   │ scope: one organisation_id, enforced by   │
   │        step-up for writes, break-glass│   │        the API and RLS on every request   │
   │        for private content            │   │                                           │
   │ later: admin.<domain> (§B)            │   │ stays inside the product                  │
   └──────────────────────────────────────┘   └─────────────────────────────────────────┘
                  both read and write through the same API, the same audit trail
```

**Authorisation.** Neither level gates anything on the client. The sidebar shows only the sections a role holds, but hiding a section is a courtesy. The authority is the API check (`requirePermission` for operators, the membership capability for org admins) and RLS. Both refuse whatever the page renders. The design shows this with the scope bar and a one-line note on org-admin pages ("Capital Q checks the role on every request, not just here"). It never shows a "locked" control that implies the lock lives in the page.

### 2.1 Route map: every existing route, placed

**(a) Platform console** (sidebar group → page). ✱ marks a gap.

| Group      | Page                    | Existing route                                                       | Change                                                                                                                                    |
| ---------- | ----------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| —          | Overview                | `/admin`                                                             | Rebuild as KPI band + Needs you + health + recent operator activity                                                                       |
| —          | Needs you               | `/admin/queue` (+ redirects `/admin/verification`, `/admin/reviews`) | Becomes the unified inbox for verification, reviews, safety, claims, break-glass and one-sided ledger entries                             |
| Customers  | Organisations           | `/admin/organisations`, `/[organisationId]`                          | Browsable table by default; detail gets tabs                                                                                              |
| Customers  | People                  | `/admin/accounts`, `/[userId]`                                       | Rename "Accounts" to "People" (matches the product's vocabulary); browsable table                                                         |
| Trust      | Verification and claims | `/admin/claims` (+ queue tab)                                        | Merge claims and verification under one page with tabs                                                                                    |
| Trust      | Safety and break-glass  | `/admin/safety`, `/safety/break-glass/[requestId]`                   | Keep; adopt the shared table and detail templates                                                                                         |
| Trust      | Documents and scans ✱   | —                                                                    | New: scan results, blocked files, document access (from the 18 Nov spec §1.1)                                                             |
| Q          | Runs and errors         | `/admin/q`, `/q/runs/[runId]`                                        | Split the Q monitor into Runs (table) and Model spend                                                                                     |
| Q          | Model spend             | part of `/admin/q` and `/admin/billing`                              | One spend page: by day, organisation, person, provider; unpriced count always shown                                                       |
| Money      | Plans and billing       | `/admin/billing`                                                     | Plans assigned, overrides, invoices (when B2/B3 land)                                                                                     |
| Money      | Facilitation ledger     | `attribution.csv` + Overview "Attribution" table                     | Own page per the 18 Nov spec §L                                                                                                           |
| Platform   | Site content            | `/admin/content`, `/content/[slug]`                                  | Keep the editor; add a status column (Published / Draft / Never published) and a banner when a public page is unpublished                 |
| Platform   | Email                   | `/admin/email`                                                       | Keep                                                                                                                                      |
| Platform   | Kill switches           | `/admin/flags`                                                       | Keep                                                                                                                                      |
| Platform   | Analytics               | `/admin/analytics`                                                   | Today this is privacy settings only; rename the section "Analytics" and put the privacy settings under a tab ✱ product analytics is a gap |
| Platform   | Brand                   | `/admin/brand`                                                       | Platform look (preset + accent). Move under Platform; **remove the link from personal Settings**                                          |
| Platform   | Q house guide           | `/admin/etiquette`                                                   | The platform-wide guide. Keep under Platform; personal Settings keeps "How Q speaks for you" only                                         |
| Platform   | System health ✱         | —                                                                    | New: services, deploy SHA, outbox lag, scanner, email auth, provider breakers                                                             |
| Governance | Audit log               | `/admin/audit` (+ CSV)                                               | Shared table template; reads included                                                                                                     |
| Governance | Operators and roles     | `/admin/team`                                                        | Rename "Team" to "Operators and roles" so it isn't confused with an org's team                                                            |

**(b) Organisation admin**: new home `/organisation` with a section index. Each row says where the content comes from today.

| Group        | Page                     | Comes from                                                     | Notes                                                                                  |
| ------------ | ------------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Organisation | General                  | profile/company record                                         | Name, logo, website, country, ownership transfer                                       |
| Organisation | Members and usage        | `/settings/team`, `/settings/team/[userId]`, `/settings/usage` | Members table, invitations, roles, seats and allowance meters (mockup `#members`)      |
| Organisation | Roles                    | role card in `/settings/team`                                  | "What each role can do" matrix (read-only until custom roles exist)                    |
| Organisation | Plan and billing         | `/settings/plan` (`/settings/billing` redirects there)         | Allowances, top-ups, invoices. Plans size usage and never lock features (decision 106) |
| Data         | Import investors         | `/relationships/import`                                        | Same page, now linked from here, the CRM header and the empty pipeline                 |
| Data         | Connections              | Settings → Connections                                         | Google, the Q inbound email address                                                    |
| Data         | Export and deletion      | `/settings/data`                                               | Organisation export; per-person rights stay in personal Settings                       |
| Data         | Privacy                  | Settings → Privacy (org-level parts)                           | Who can see the organisation; network visibility                                       |
| Q and brand  | How Q speaks for us      | Settings → "How Q speaks for you" (org guide)                  | The org's own guide; the house guide stays platform-only                               |
| Q and brand  | Gateway and Q Card brand | GateQ gateway appearance                                       | The org's brand on its gateway and cards. This is **not** `/admin/brand`               |
| Governance   | Activity log             | `/settings/activity`                                           | The org's own audit trail                                                              |
| Governance   | Security ✱               | `/settings/security` is personal                               | Gap: require two-step for members, session list, SSO later                             |

Personal Settings keeps only personal items: profile, account, own security, appearance, Q preferences, notifications, and own data rights.

### 2.2 Gaps, named

1. No browse lists: Organisations and People need a default table, not a search box.
2. No system health page; the deployed version is not shown anywhere in the console.
3. No documents or scans view (18 Nov spec §1.1).
4. No unified spend view by organisation and person, and the unpriced count is not surfaced.
5. Admin reads are not audited (18 Nov spec §1.1). The design assumes they will be ("Every view and change here is recorded"), so building the console requires it.
6. No organisation admin home; org security policy (require two-step) doesn't exist.
7. No public pricing or legal content on production. The CMS shows no warning when public pages are unpublished.
8. No command palette, saved views, bulk actions or keyboard model in the console.

## 3. Shell and navigation

### 3.1 Platform console shell

```
┌ sidebar 240 ─────────┬──────────────────────────────────────────────────────────────┐
│ ◯ Capital Q          │ SCOPE BAR  Platform console │ Operator │ 🔒 Confirmed until 14:20 │
│   Operations console │──────────────────────────────────────────────────────────────│
│ Overview             │ Customers › Organisations                [⌕ Search…   ⌘K]   │
│ Needs you        14  │──────────────────────────────────────────────────────────────│
│ Customers            │ Organisations                                   [Export ▾]   │
│  Organisations   412 │ One sentence of purpose.                                     │
│  People        1,906 │ All 412 │ Founder companies │ Investor orgs │ … │ + Save view │
│ Trust ...            │ [⌕ Name, domain, ID] (Country: NG, KE ▾) (+ Plan) (+ Verif.) │
│ Q ...                │ ┌ table ────────────────────────────────────────────────┐    │
│ Money ...            │ │ ☐ Name  Type  Country  Plan  Seats  Verif.  Spend  ⋯   │    │
│ Platform ...         │ └───────────────────────────────── Prev │ Next ───────────┘    │
│ Governance ...       │                                                              │
│ ● All services up    │                                                              │
└──────────────────────┴──────────────────────────────────────────────────────────────┘
```

- **The scope bar is the console's one distinctive element.** It is a 36 px strip above everything that always says whose authority you act under: the console, your role, whether step-up is live and until when, and that views are recorded. In org admin the same strip names the organisation and your role there, with a switcher. It answers the question every admin tool leaves to memory: "what can this click touch?" It uses `--cq-charcoal`/`--cq-on-charcoal` in light. In dark it uses a sunken surface, not the light charcoal, so it doesn't glare. Propose `--cq-admin-scope` and `--cq-on-admin-scope` tokens for this.
- **Sidebar.** It has 7 labelled groups (Customers, Trust, Q, Money, Platform, Governance, plus top-level Overview and Needs you). Labels are 12 px, sentence case and tertiary, never uppercase or tracked. The active item gets `--cq-gold-action-soft` plus a 3 px gold bar, so the current page is shown by shape as well as colour (WCAG 1.4.1). Queue counts show on the right in `--cq-warning` when something is overdue. The sidebar footer shows overall health and the deployed short SHA.
- **Phone (< 1024 px).** The sidebar becomes a sheet behind the menu button. The scope bar wraps to two lines and drops the "recorded" sentence. Search collapses to an icon. Breadcrumbs keep the last two levels.
- **Leaving the console.** The console is separate from the product: no product sidebar, no Q Dock and no splash. A "Back to Capital Q" link sits in the account menu. When the console moves to `admin.<domain>` (§B), nothing else changes.

### 3.2 Organisation admin shell

- It lives inside the product shell (same sidebar, Q Dock allowed).
- The product sidebar gains a group named after the active organisation (for example "LedgerBridge") with two entries: **Organisation** (`/organisation`) and **Import investors**. Members see the group with Organisation only. The page then shows what a member may see (the members list, their own role) and hides admin controls. The API still refuses admin writes.
- Inside, a left section index (220 px) uses the same groups as §2.1(b). On a phone it becomes one "Section ▾" selector above the page title.
- The scope bar here is light (`--cq-surface-strong`). It names the organisation, your role and "Changes here apply to LedgerBridge only", with **Switch ▾** for people in several organisations (it reuses `org-switcher.tsx`).

### 3.3 Discoverability fixes (do these first)

| #   | Fix                                                                                                                                                                                                                                | Where                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| D1  | Add **Organisation** (owner/admin/member) and **Import investors** to the product sidebar under the org's name; add both to the mobile account menu                                                                                | `navigation.ts`, `mobile-navigation.tsx` |
| D2  | Add an **Import** button in the CRM page header (Pipeline view) and in the empty pipeline state, not only inside the import page                                                                                                   | `/relationships`                         |
| D3  | Rename the sidebar's "Admin console" entry to **Operations console**. Keep it only for platform admins (server-decided, as today) and give it a divider so it reads as leaving the product                                         | `navigation.ts`                          |
| D4  | Remove **Brand** and **Etiquette** links from personal Settings; link the org's own guide and gateway brand from `/organisation` instead                                                                                           | `settings-view.tsx`                      |
| D5  | Add **Plans and pricing** to the product (account menu and Plan page: "Compare plans") and to the public header on phones (now only in the footer)                                                                                 | site chrome                              |
| D6  | Publish default pricing, terms, privacy, cookies, acceptable use, AI disclaimer, recording consent and DPA (decision 107 requires default content). Until then, the CMS list flags unpublished pages linked from the public footer | `/admin/content`                         |
| D7  | Fix the double-active sidebar (Usage and Settings both highlighted on `/settings/usage`)                                                                                                                                           | `desktop-sidebar.tsx`                    |
| D8  | Use one name per place: the sidebar says "CRM", the page says "Fundraising Hub", and the import back-link says "Relationships". Use one                                                                                            | copy                                     |
| D9  | Console: retire the horizontal 16-tab strip for the grouped sidebar; add ⌘K                                                                                                                                                        | `console-ui.tsx`                         |

## 4. Page templates

Each one is a small composition over existing `@capital-q/ui` parts (`PageHeader`, `EmptyState`, `ErrorState`, `InlineNotice`), not new primitives where one exists.

| Template                | Anatomy                                                                                                                                                                                                                                                          | Used by                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **T1 Overview**         | Page header with a period selector and Export. Then a KPI band (6 cells, hairline-divided, one panel). Below it, a 2 : 1 grid: Needs you + one chart on the left, health + recent activity on the right                                                          | Console overview; later an org overview                                          |
| **T2 List**             | Page header, saved-view tabs with counts, a toolbar (filter field, filter chips, Columns) and a bulk bar when rows are selected. Then the table with a sticky header and cursor pagination. On a phone, a two-line row list with the same data                   | Organisations, People, Runs, Audit, Documents, Ledger, Email deliveries, Members |
| **T3 Record**           | Breadcrumb, an entity header (avatar, name, facts line, primary actions with destructive actions last and marked with a lock when step-up applies), tabs with counts, then a 2 : 1 body: record and allowance panels on the left, activity timeline on the right | Organisation, Person, Run, Break-glass request                                   |
| **T4 Queue**            | A list on the left (age, type, one-line reason) and the item on the right. Decision buttons need a reason; the next item loads after a decision. On a phone, list → item                                                                                         | Needs you, Verification, Safety                                                  |
| **T5 Settings section** | Section index, then a page header, then panels made of rows (label, one-sentence explanation, control). Save per row or per panel, never one global Save                                                                                                         | Org admin sections, platform Brand/Flags/Analytics privacy                       |

**States, for every template:**

- **Loading:** skeleton rows at the table's real row height and column widths. KPI cells show a grey bar where the figure goes. No full-page spinner.
- **Empty:** what would be here, why it's empty, and one next action. For example: "No organisations match Nigeria and Plan: Fund. Clear the plan filter."
- **Error:** what failed, that nothing changed, and Retry. It never shows a raw status code.
- **Partial:** a figure that is incomplete says so beside the number ("38 calls unpriced"). It never pretends to be the total.

**Consequential actions** (suspend, assign plan, change an allowance, decide verification, break-glass):

1. The button carries a lock icon when step-up is needed.
2. A dialog names the exact target and effect: "Suspend LedgerBridge: its 3 members can't sign in; nothing is deleted".
3. The dialog requires a reason and takes step-up if it isn't live.
4. The action is server-confirmed (no optimistic UI) and lands in the audit log with the reason.
5. Approval binds to the exact payload, per CLAUDE.md. Editing the payload after approval needs approval again.

## 5. Components

| Component                                                | Status                         | Notes                                                                                                                                       |
| -------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `ConsoleSidebar` (grouped, counts, health footer)        | New, replaces `ConsoleNav`     | Driven by the same `SECTIONS` + permission list, grouped                                                                                    |
| `ScopeBar`                                               | New                            | Platform and org variants                                                                                                                   |
| `CommandPalette`                                         | New                            | Server search endpoint scoped by permission; recent items; "Go to" commands; audited opens                                                  |
| `DataTable`                                              | New (one, shared)              | Sort, sticky header, row select, bulk bar slot, column chooser, cursor pager, skeleton, empty, phone list fallback; numerals `tabular-nums` |
| `FilterChip`, `SavedViews`                               | New                            | Views stored per operator (server), shareable by link                                                                                       |
| `KpiBand`                                                | New                            | 2–6 cells; value, label, comparison; each cell may link                                                                                     |
| `EntityHeader`, `RecordTabs`                             | New                            | Tabs are links (URL per tab), with counts                                                                                                   |
| `ActivityTimeline`                                       | New                            | Actor, action, target, reason, time, and "operator" / "read" markers                                                                        |
| `AllowanceMeter`                                         | Extract from `/settings/usage` | Bar in `--cq-text-secondary`, `--cq-warning` at ≥ 80 %; text always states "241 of 300" (never colour alone)                                |
| `StatusDot` + text                                       | New                            | Dot is decorative (`aria-hidden`); the word carries the meaning                                                                             |
| `StepUpButton` / reason dialog                           | Extend `StepUpProvider`        | Lock glyph, reason field, payload summary                                                                                                   |
| `PageHeader`, `EmptyState`, `ErrorState`, `InlineNotice` | Existing                       | Reused as they are                                                                                                                          |

## 6. Tokens and visual rules

Only existing `--cq-*` tokens are used. The mockup copies their light and dark values verbatim from `packages/ui/src/tokens/tokens.css`. One addition is proposed: `--cq-admin-scope` and `--cq-on-admin-scope` for the scope bar (light = charcoal; dark = `oklch(0.205 0 0)` on `oklch(0.95 0.005 92)`).

| Use                           | Token                                                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Page / sidebar / panels       | `--cq-canvas` / `--cq-panel-surface` / `--cq-surface` with `--cq-border-subtle` hairlines; no shadow on panels (doc 18 §27) |
| Text levels                   | `--cq-text-primary` (titles, values), `-secondary` (labels, meta), `-tertiary` (group labels, ages)                         |
| Primary action (one per page) | `--cq-gold-action` / `--cq-on-gold-action`; active nav `--cq-gold-action-soft` + gold bar                                   |
| Status                        | `--cq-positive`, `--cq-warning`, `--cq-danger`, always with a word beside the dot                                           |
| Focus                         | 2 px `--cq-focus-ring` outline, 2 px offset                                                                                 |
| Overlay (palette, dialogs)    | `--cq-overlay`, `--cq-shadow-overlay`, `--cq-z-modal`                                                                       |
| Type                          | `--cq-font-ui` system stack: 24/600 page titles, 15/600 panel titles, 13–14 body, 12 meta. `--cq-font-mono` only for IDs    |
| Radius                        | 12 panels, 8 controls, 6 nav items, full for chips                                                                          |

**Prohibited** here as everywhere: gradients, glow (Q only), uppercase tracked eyebrows, badge spam (one tag per row at most), cards around everything (tables sit in one panel; KPIs are one band, not six cards), `backdrop-blur`, raw hex, ad-hoc z-index. Charts use one neutral series with the gold highlight for the single point being called out.

**Accessibility (WCAG 2.2 AA):**

- Targets are ≥ 44 px on touch and ≥ 34 px rows on desktop pointer only, with 24 px minimum spacing (2.5.8).
- Tables have a `<caption>`, `aria-sort` on the sorted column, and a label on each row checkbox ("Select LedgerBridge").
- The palette is a `dialog` with a listbox and visible key hints.
- Focus is never hidden under the sticky header (2.4.11).
- Light mode is first-class.
- Reduced motion removes the colour transitions.

## 7. Clean-up now (A): slices over existing routes only

Each slice is small and shippable, and touches no contracts, migrations or authorisation beyond what is named. The order is by owner impact.

| Slice                           | Scope                                                                                                                                                                                                                                                                      | Touches                                                                            |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **A1 Discoverability**          | D1–D8 above: nav entries for Organisation and Import, Import in the CRM header, remove Brand and Etiquette from personal Settings, fix the double-active sidebar, naming                                                                                                   | web nav + copy only                                                                |
| **A2 Publish public pages**     | Seed default content for pricing and legal through the existing CMS (decision 107). Add a "Never published" status and a warning in `/admin/content`                                                                                                                       | CMS content + one list column; no schema change if status is derived from versions |
| **A3 Console shell**            | Grouped `ConsoleSidebar`, `ScopeBar`, consistent `PageHeader` + breadcrumbs on all 23 console pages, and the console outside the product chrome                                                                                                                            | `apps/web/app/(app)/admin/layout.tsx`, `features/admin/console-ui.tsx`             |
| **A4 DataTable + browse lists** | One shared table, adopted by Organisations, People and Audit, with a default listing (newest first), sort, filters by existing fields, and CSV from the current filter. Needs list endpoints with cursor pagination where only search exists today                         | `platform-admin` list queries (read-only, permission-checked), web                 |
| **A5 Record template**          | Organisation and Person detail get the entity header, tabs (as links) and activity timeline from existing audit and admin-action data                                                                                                                                      | web + one read endpoint per tab where missing                                      |
| **A6 Organisation admin home**  | `/organisation` with the section index. It re-homes Team, Usage, Plan, Activity, Data and Connections; old `/settings/*` routes redirect. It adds no new permissions: each section calls the same API it already calls, and the API's membership checks stay the authority | web routes + redirects                                                             |
| **A7 Overview**                 | Rebuild `/admin` as T1 from data the API already returns (queues, paused, attribution, disputes, Q figures) plus health from existing status endpoints                                                                                                                     | web                                                                                |
| **A8 Command palette**          | ⌘K over the existing admin search (accounts, organisations), plus "Go to" commands                                                                                                                                                                                         | web, existing search API                                                           |

Done means each slice is screenshotted at 1440 and 390 in light and dark, passes axe with no violations, keeps the existing admin RLS/permission tests green, and has a negative test showing a non-admin still gets the 404 and an org member can't reach owner/admin writes.

## 8. Future: platform admin product, spec outline (B)

This is an outline for the owner to commission. Each heading lists the decisions to take, not a full spec.

### B1. A separate application on `admin.<domain>`

- A new deployable `apps/admin` (Next.js, same `@capital-q/ui` and tokens) on its own subdomain. It talks to the **same** `apps/api` through `/v1/admin/*`; no direct database access and no second backend.
- Its own session cookie scoped to the admin host, phishing-resistant MFA (passkeys) required, a shorter session, and an IP or device allow-list as an option. It is never embedded in the product's origin.
- **Charts:** one charting dependency, chosen once, rendered from server-aggregated series (no raw-row download to the browser). Covers spend, usage, funnel, queue SLAs and facilitated money.
- **Exports:** CSV, XLSX, JSON and PDF, produced by a worker job (not the request), with a signed short-lived download link. Every export is audited with its filter, row count and purpose; PII columns need a permission of their own.
- **Scheduled reports and alerts:** operators subscribe to saved views as daily or weekly email digests. Alert rules (thresholds on queue age, spend, error rate, outbox lag, scanner down) go to email first and pager later. Rules are stored server-side and evaluated by the workers.
- **Decision to take:** when to split. Split once two or more non-owner operators exist or the first enterprise customer asks for it. Until then `/admin` in the main app with the A-slices is enough.

### B2. Access control model

| Model | What it is                                             | Fit for Capital Q                                                                                                                                                               |
| ----- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RBAC  | Permissions attached to named roles                    | Already used (ADR 0033 roles; org Owner/Admin/Member). Easy to audit and explain. Alone, it can't express "only this tenant", "only this region" or "only cases assigned to me" |
| ABAC  | Policies over subject, resource and context attributes | Expresses tenant, region, assignment, step-up freshness and data class. Harder to reason about if it is the whole model                                                         |
| DAC   | Owners grant access to their resources                 | Right for **customer data sharing** (data-room grants, relationship sharing), which already exists. Wrong for operators                                                         |
| MAC   | Central labels and clearances that nobody can override | Too rigid as the general model. The **visibility scopes** (`founder_private`, `investor_private`, and so on) already act as mandatory labels at the Context Firewall            |

**Recommendation:** RBAC as the backbone, with attribute and tenant conditions (RBAC + ABAC conditions). Roles grant permissions. Every check also evaluates conditions server-side:

- the tenant (`organisation_id` from the membership, never from the client);
- step-up freshness for writes;
- the data class: content behind break-glass;
- assignment, where queues use it.

Enforcement sits in the API and RLS. Every decision is audited (allow and deny). Break-glass is a separate, time-boxed, reason-bound, two-person grant that is logged per read (ADR 0033). The same engine serves operators (platform roles) and org admins (org roles), with different role sets, so there is one policy code path and one audit format. Custom roles for enterprise orgs come later, as named bundles of the same permissions.

### B3. Support

- **Inbox:** one support address, plus in-app "Contact us" that creates a ticket bound to the signed-in person and organisation. Tickets have a status, an assignee and SLA timers in the console (T4 queue). The decision to take is build versus a helpdesk adapter. Keep it behind a `SupportProvider` adapter either way.
- **Help centre:** CMS-backed articles (the existing site-content editor with an "article" type), public and searchable, with versions.
- **Q answers from the help centre:** published articles are indexed as public knowledge (`public_external`), so Q can cite them. They never mix with tenant knowledge, and Q links the article it used.
- **User-facing contact:** in the account menu, on the public footer and on error pages, with a promise of response time only where staffed.
- **Operator view of a ticket:** linked to the person and organisation records. A read-only "view as" is limited to what the customer sees, and break-glass is needed for anything private.

### B4. Business verification (KYB) worldwide

- A `VerificationProvider` adapter, with one interface per check type (registry lookup, director or UBO match, document check, liveness for persons), and region routing. Candidate providers:
  - Africa: Smile ID, Youverify, Dojah.
  - US: Middesk.
  - Global: Persona, Sumsub, Onfido.
  - Open registries: Companies House (UK) and OpenCorporates (global).
- Results become evidence on the existing **`verification_claims`** workflow, which stays separate from the truth, evidence and lifecycle axes (ADR-001). A provider result is a source with a timestamp and a raw-response reference, never an automatic "verified". Clear matches can be auto-accepted only by a declared rule; anything ambiguous goes to the operator queue.
- **Operator review queue** (T4): side by side, what was claimed against what each provider returned, with differences highlighted in words. Decide with a reason, re-run a check, or ask the customer for a document.
- **Decisions to take:**
  - provider per region and cost per check (paid calls need the owner's approval);
  - data retention for provider responses;
  - which checks are required for which badge.

### B5. See and do everything, safely

- **Universal search** across people, organisations, relationships, documents (metadata), runs, tickets, invoices and ledger entries, scoped by permission.
- **A 360° record page** for every entity, built on T3.
- **"View as":** a read-only rendering of what that customer sees, with a banner. It is time-boxed and audited per page, and needs break-glass for private content.
- **Actions** happen only through typed admin commands (no SQL console). Each command needs a permission, step-up and a reason, and idempotency keys are used throughout.
- **Least privilege by default:** support sees contact and status but not content; analysts see aggregates; Trust and Safety sees reported content only.
- **Every view and every change is in the audit log** (reads included), and operators can review their own trail.
- **Decision to take:** the retention period of the operator audit log, and who may export it.

## 9. Open questions for the owner

1. Org admin URL: `/organisation` (recommended) or `/settings/organisation`?
2. Should members (not just owners and admins) see the Organisation page read-only? This design says yes, with admin controls hidden and still refused server-side.
3. When should the console split onto its own subdomain (B1)?
4. Pricing and legal: publish the default drafts now (with the lawyer's review pending), or keep "being prepared" until reviewed?
