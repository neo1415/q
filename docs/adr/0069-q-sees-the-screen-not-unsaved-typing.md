# ADR 0069: Q sees what is on screen, as references, and never unsaved typing

- Status: **Accepted** (2026-10-15, Lane W). Extends the Q room R1 page manifest (`q.screen.v2`); no version bump.
- Number: 0069 was the next free number on `claude/rc-oct15-k`. The lead renumbers it if another lane took it.

## Context

The owner asked that "Q should always be able to see exactly what is on screen". The page manifest already sends sections, tab, filters, dialogs, focus, controls and the drawn Q object, as ids and closed kinds that the Q API reads back as the person. It did not say which records are visible now, what video is playing, or whether an error, an empty state, a loading frame or a toast is showing. It also did not cover every page.

## Decision

1. **Still references only.** The new optional fields are `section.visible` (refs visible now, from one shared IntersectionObserver), `notices` (ERROR / EMPTY / LOADING / TOAST, with closed codes) and `media` (the pitch on screen: company and media ids, PLAYING / PAUSED / BUFFERING / ENDED / FAILED, and a coarse position). The browser sends no screenshots, no DOM text and no toast wording. The Q API names a record or pitch only through the person's own reads. A ref that does not resolve is dropped.
2. **Unsaved input is never sent.** Text a person is typing and has not saved or sent stays out of the manifest. This includes field values and even a "has typed" flag. Q is told this every turn and answers "I can't see what you're typing until you save or send it". This line is deliberate. A draft can hold founder-private numbers that have not been through the Write Gate or a visibility decision.
3. **Every page registers.** `apps/web/test/manifest-page-coverage.test.ts` fails unless each `app/**/page.tsx` registers a manifest section, either itself or through a component it imports, or is exempt with a reason. The exempt pages are the operations console, the dev harness, public, auth and callback pages, onboarding and redirects.

## Consequences

- Deploy the Q API (contracts, model-gateway, q-specialists) **before** the web app. The manifest schema is strict, so an older Q API refuses a manifest that carries the new fields or section kinds. An older web keeps working against a newer Q API.
- Rows mark themselves with `qRef(kind, id)` so `visible` can list them. Lists without marks report section-level `inView` only.
