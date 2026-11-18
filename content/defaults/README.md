# Default content

Default copy for the content editor (CMS, decision 107). The CMS imports these files as version 1 of each page or section. After import, the CMS owns the content. These files are the seed, not the live copy.

Spelling is UK English throughout. Every file is Markdown with YAML front matter.

## Front matter

| Field            | Required               | Meaning                                                                                                                            |
| ---------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `slug`           | yes                    | Stable id and URL segment (for example `terms` → `/legal/terms`, `pricing` → `/pricing`). Never reuse a slug for different content |
| `title`          | yes                    | Page or section title                                                                                                              |
| `kind`           | yes                    | `legal`, `pricing`, `faq` or `landing-section`                                                                                     |
| `version`        | yes                    | Integer. Starts at `1`; the CMS increments it on each publish                                                                      |
| `effective_date` | yes                    | ISO date as a quoted string (`"2026-11-18"`)                                                                                       |
| `summary`        | yes                    | One or two sentences for listings, meta descriptions and the CMS index                                                             |
| `status`         | yes                    | `DRAFT_PENDING_LEGAL_REVIEW` on every legal page: do not publish until a lawyer has approved it. `DRAFT` on everything else        |
| `order`          | landing only           | Position of the section on the landing page, from 0                                                                                |
| `anchor`         | landing only, optional | In-page anchor id (`hero`, `how`, `gateq`), used by the navigation links                                                           |
| `currency`       | pricing only           | ISO currency of the prices shown                                                                                                   |

String values are quoted, so a colon in a summary cannot break the YAML.

## Body conventions (so the CMS can turn it into blocks)

- `#`, `##`, `###` headings start sections; each heading and the content under it can become one block.
- **Summary box:** on legal pages, the first blockquote that starts with `**In short**` is the plain-language summary box. Render it as a highlighted panel.
- **Lawyer notes:** lines of the form `<!-- LAWYER: ... -->` are review notes for the lawyer. They are HTML comments, so they never render. The CMS should show them to editors and list them on the review screen. Remove each one once resolved.
- Tables are plain GitHub-flavoured Markdown tables.
- On landing sections, list items of the form `- Button: [Label](href)` are buttons, `- Link: [Label](href)` are links, and a line starting `Caption:` is the small caption under an illustration. Other list items are plain text.
- In `faq.md` and the end of `pricing.md`, each `###` heading is a question and the paragraphs under it are its answer. `##` headings are FAQ groups.
- Internal links use the planned routes: `/pricing`, `/faq`, `/legal/<slug>`.

## Placeholders

The product's name is not decided ("Capital Q" is being replaced). Replace these at render time from one settings record, never by editing each page:

| Placeholder              | Meaning                                              |
| ------------------------ | ---------------------------------------------------- |
| `{{COMPANY_NAME}}`       | The brand name                                       |
| `{{LEGAL_ENTITY}}`       | The registered company name                          |
| `{{REGISTERED_ADDRESS}}` | Registered office address                            |
| `{{CONTACT_EMAIL}}`      | Contact, privacy and data protection officer address |
| `{{GOVERNING_LAW_CITY}}` | City for the arbitration seat or courts              |

## Files

| File                          | Kind            | Route                                                                |
| ----------------------------- | --------------- | -------------------------------------------------------------------- |
| `terms-of-service.md`         | legal           | `/legal/terms`                                                       |
| `privacy-policy.md`           | legal           | `/legal/privacy`                                                     |
| `cookie-policy.md`            | legal           | `/legal/cookies`                                                     |
| `acceptable-use-policy.md`    | legal           | `/legal/acceptable-use`                                              |
| `ai-investment-disclaimer.md` | legal           | `/legal/ai-disclaimer` (also has the footer and Q surface lines)     |
| `meeting-recording-notice.md` | legal           | `/legal/meeting-recording` (also has the exact consent lines Q says) |
| `data-processing-addendum.md` | legal           | `/legal/dpa` (an outline; the signed DPA is supplied on request)     |
| `pricing.md`                  | pricing         | `/pricing`                                                           |
| `faq.md`                      | faq             | `/faq`                                                               |
| `landing-*.md`                | landing-section | `/`, in `order`                                                      |

## Accuracy notes for whoever publishes

The copy was checked against the code on `fix/resume-asking-cv9ru3` on 18 November 2026. Before publishing, check these points, which depend on work still in progress:

- **Self-serve data download and account deletion** (decision 107) were not built yet. The privacy policy and FAQ say "from your settings where available, or by writing to {{CONTACT_EMAIL}}". Update once Settings has both.
- **Cookie settings link and analytics consent.** No analytics runs today, so nothing needs consent yet. The cookie policy and footer refer to a "Cookie settings" link that must exist before any analytics is switched on.
- **Billing is not live.** Settings shows "Free while Capital Q launches". Publish `pricing.md` only when payments are switched on. The 80% and 100% allowance messages, voice minute warnings and top-up packs are the designed behaviour in the launch plan, not yet built.
- **Plan perks follow the launch plan (§4) and decision 106.** Two changes from the launch plan's table, for the owner to confirm: the data room and charts and tables are listed on every plan (the launch plan's own note turns them into allowances, not locks), and the Readiness Blueprint is left out because it is not built (the route is a stub).
- **Meetings:** Q joins Google Meet calls only. If someone asks Q to leave in the call, Q records the request and stays until the organiser removes it (ADR 0039). The meeting notice says so.
- **Hosting region:** "mainly in the European Union" matches staging (Railway europe-west4, Supabase eu-central-1). Confirm for the new production project (decision 104).
