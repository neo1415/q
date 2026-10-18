# Route / page inventory — before

Production web at 127.0.0.1:3000 (Railway backends, hosted Supabase), captured 2026-09-23 with Playwright at 1440×900 and 390×844, full page. Accounts: `z-design-new` (fresh person), `z-design-founder` / `z-design-founder-m` (founder journeys), `z-design-investor` (investor journey), all `@example.com`.

Not reachable in this inventory: `/dev/ui` (404 in production builds), artifact/deck views (no deck exists for a fresh company), video/feed surfaces (Discover is a list; no pitch video exists), company/investor profile pages (no such routes exist yet; Discover items do not link out). A true loading state could not be frozen; skeleton components exist in `packages/ui`.

## Signed out / auth

| Page                       | Desktop                                                            | Mobile                                                           | Note                                      |
| -------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- | ----------------------------------------- |
| `auth-check-email`         | [desktop](screenshots/before/auth-check-email-desktop.png)         | [mobile](screenshots/before/auth-check-email-mobile.png)         |                                           |
| `auth-forgot-password`     | [desktop](screenshots/before/auth-forgot-password-desktop.png)     | [mobile](screenshots/before/auth-forgot-password-mobile.png)     |                                           |
| `auth-sign-in`             | [desktop](screenshots/before/auth-sign-in-desktop.png)             | [mobile](screenshots/before/auth-sign-in-mobile.png)             |                                           |
| `auth-sign-in-error`       | [desktop](screenshots/before/auth-sign-in-error-desktop.png)       | [mobile](screenshots/before/auth-sign-in-error-mobile.png)       | wrong credentials                         |
| `auth-sign-up`             | [desktop](screenshots/before/auth-sign-up-desktop.png)             | [mobile](screenshots/before/auth-sign-up-mobile.png)             |                                           |
| `auth-update-password`     | [desktop](screenshots/before/auth-update-password-desktop.png)     | [mobile](screenshots/before/auth-update-password-mobile.png)     | reached without a recovery session        |
| `home-signed-out-redirect` | [desktop](screenshots/before/home-signed-out-redirect-desktop.png) | [mobile](screenshots/before/home-signed-out-redirect-mobile.png) | signed-out visit to /home                 |
| `root`                     | [desktop](screenshots/before/root-desktop.png)                     | [mobile](screenshots/before/root-mobile.png)                     | landing / redirect target when signed out |

## Arrival and Home (Q)

| Page                       | Desktop                                                            | Mobile                                                           | Note                                   |
| -------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- | -------------------------------------- |
| `after-sign-in-landing`    | [desktop](screenshots/before/after-sign-in-landing-desktop.png)    | [mobile](screenshots/before/after-sign-in-landing-mobile.png)    | where sign-in lands a fresh person     |
| `home-founder`             | [desktop](screenshots/before/home-founder-desktop.png)             | [mobile](screenshots/before/home-founder-mobile.png)             | Home with founder context              |
| `home-founder-q-answer`    | [desktop](screenshots/before/home-founder-q-answer-desktop.png)    | [mobile](screenshots/before/home-founder-q-answer-mobile.png)    | Q answer for a founder                 |
| `home-founder-q-working`   | [desktop](screenshots/before/home-founder-q-working-desktop.png)   | [mobile](screenshots/before/home-founder-q-working-mobile.png)   | Q working                              |
| `home-fresh`               | [desktop](screenshots/before/home-fresh-desktop.png)               | [mobile](screenshots/before/home-fresh-mobile.png)               | Home with no organisation context      |
| `home-fresh-dark`          | [desktop](screenshots/before/home-fresh-dark-desktop.png)          | —                                                                | dark scheme                            |
| `home-investor`            | [desktop](screenshots/before/home-investor-desktop.png)            | [mobile](screenshots/before/home-investor-mobile.png)            | Home with investor context             |
| `home-investor-q-answer`   | [desktop](screenshots/before/home-investor-q-answer-desktop.png)   | [mobile](screenshots/before/home-investor-q-answer-mobile.png)   | Q answer for a investor                |
| `home-investor-q-working`  | [desktop](screenshots/before/home-investor-q-working-desktop.png)  | [mobile](screenshots/before/home-investor-q-working-mobile.png)  | Q working                              |
| `home-q-answer`            | [desktop](screenshots/before/home-q-answer-desktop.png)            | [mobile](screenshots/before/home-q-answer-mobile.png)            | Q answer on Home                       |
| `home-q-working`           | [desktop](screenshots/before/home-q-working-desktop.png)           | [mobile](screenshots/before/home-q-working-mobile.png)           | Q working state right after a question |
| `home-signed-out-redirect` | [desktop](screenshots/before/home-signed-out-redirect-desktop.png) | [mobile](screenshots/before/home-signed-out-redirect-mobile.png) | signed-out visit to /home              |
| `welcome`                  | [desktop](screenshots/before/welcome-desktop.png)                  | [mobile](screenshots/before/welcome-mobile.png)                  | arrival: Q introduces itself           |
| `welcome-started`          | [desktop](screenshots/before/welcome-started-desktop.png)          | [mobile](screenshots/before/welcome-started-mobile.png)          | after Start: the role choice           |

## Q-led onboarding (conversation first)

| Page                                      | Desktop                                                                           | Mobile                                                                   | Note                                          |
| ----------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------- |
| `onboarding-founder-conversation`         | [desktop](screenshots/before/onboarding-founder-conversation-desktop.png)         | [mobile](screenshots/before/onboarding-founder-conversation-mobile.png)  | Q-led founder onboarding, conversation first  |
| `onboarding-founder-conversation-reply`   | [desktop](screenshots/before/onboarding-founder-conversation-reply-desktop.png)   | —                                                                        | Q reply in onboarding conversation            |
| `onboarding-founder-conversation-working` | [desktop](screenshots/before/onboarding-founder-conversation-working-desktop.png) | —                                                                        | Q working in onboarding                       |
| `onboarding-founder-f0-form`              | [desktop](screenshots/before/onboarding-founder-f0-form-desktop.png)              | [mobile](screenshots/before/onboarding-founder-f0-form-mobile.png)       | founder F0 structured form                    |
| `onboarding-investor-conversation`        | [desktop](screenshots/before/onboarding-investor-conversation-desktop.png)        | [mobile](screenshots/before/onboarding-investor-conversation-mobile.png) | Q-led investor onboarding, conversation first |
| `onboarding-investor-i0-form`             | [desktop](screenshots/before/onboarding-investor-i0-form-desktop.png)             | [mobile](screenshots/before/onboarding-investor-i0-form-mobile.png)      | investor I0 structured form                   |

## Founder onboarding form F0–F8

| Page                           | Desktop                                                                | Mobile                                                         | Note                                            |
| ------------------------------ | ---------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------- |
| `founder-f0-intent`            | [desktop](screenshots/before/founder-f0-intent-desktop.png)            | [mobile](screenshots/before/founder-f0-intent-mobile.png)      | What brings you to Capital Q?                   |
| `founder-f1-categories`        | [desktop](screenshots/before/founder-f1-categories-desktop.png)        | [mobile](screenshots/before/founder-f1-categories-mobile.png)  | Q-suggested taxonomy                            |
| `founder-f1-company`           | [desktop](screenshots/before/founder-f1-company-desktop.png)           | [mobile](screenshots/before/founder-f1-company-mobile.png)     | Your company                                    |
| `founder-f1-description`       | [desktop](screenshots/before/founder-f1-description-desktop.png)       | [mobile](screenshots/before/founder-f1-description-mobile.png) | In a sentence or two, what does the company do? |
| `founder-f1-stage`             | [desktop](screenshots/before/founder-f1-stage-desktop.png)             | [mobile](screenshots/before/founder-f1-stage-mobile.png)       | What stage is the company at?                   |
| `founder-f2-materials`         | [desktop](screenshots/before/founder-f2-materials-desktop.png)         | [mobile](screenshots/before/founder-f2-materials-mobile.png)   | document upload step                            |
| `founder-f3-review`            | [desktop](screenshots/before/founder-f3-review-desktop.png)            | [mobile](screenshots/before/founder-f3-review-mobile.png)      | Here's what I understood                        |
| `founder-f4-team`              | [desktop](screenshots/before/founder-f4-team-desktop.png)              | [mobile](screenshots/before/founder-f4-team-mobile.png)        | Your founding team                              |
| `founder-f5-traction`          | [desktop](screenshots/before/founder-f5-traction-desktop.png)          | [mobile](screenshots/before/founder-f5-traction-mobile.png)    | Business and traction                           |
| `founder-f6-capital-objective` | [desktop](screenshots/before/founder-f6-capital-objective-desktop.png) | —                                                              |                                                 |
| `founder-f7-follow-up`         | [desktop](screenshots/before/founder-f7-follow-up-desktop.png)         | —                                                              |                                                 |
| `founder-f8-snapshot`          | [desktop](screenshots/before/founder-f8-snapshot-desktop.png)          | —                                                              | first-value snapshot                            |

## Investor onboarding form I0–I12

| Page                              | Desktop                                                         | Mobile                                                                  | Note                                          |
| --------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------- |
| `investor-i0-role`                | [desktop](screenshots/before/investor-i0-role-desktop.png)      | —                                                                       | How do you invest?                            |
| `investor-i1-deployment`          | —                                                               | [mobile](screenshots/before/investor-i1-deployment-mobile.png)          | Are you deploying capital right now?          |
| `investor-i10-inbound`            | —                                                               | [mobile](screenshots/before/investor-i10-inbound-mobile.png)            | How should founders reach you?                |
| `investor-i11-additional`         | —                                                               | [mobile](screenshots/before/investor-i11-additional-mobile.png)         | Add something we missed                       |
| `investor-i11-mandate-review`     | —                                                               | [mobile](screenshots/before/investor-i11-mandate-review-mobile.png)     | Here's the mandate you've defined             |
| `investor-i12-handoff`            | —                                                               | [mobile](screenshots/before/investor-i12-handoff-mobile.png)            | Your mandate is ready                         |
| `investor-i2-stage-cheque`        | —                                                               | [mobile](screenshots/before/investor-i2-stage-cheque-mobile.png)        | Stage and cheque                              |
| `investor-i3-geography`           | [desktop](screenshots/before/investor-i3-geography-desktop.png) | —                                                                       | Where do you invest?                          |
| `investor-i3-sectors`             | [desktop](screenshots/before/investor-i3-sectors-desktop.png)   | [mobile](screenshots/before/investor-i3-sectors-mobile.png)             | Which sectors and product areas?              |
| `investor-i4-attributes`          | —                                                               | [mobile](screenshots/before/investor-i4-attributes-mobile.png)          | Business attributes                           |
| `investor-i5-founder-preferences` | —                                                               | [mobile](screenshots/before/investor-i5-founder-preferences-mobile.png) | Founding-team capabilities that matter to you |
| `investor-i6-green-flags`         | —                                                               | [mobile](screenshots/before/investor-i6-green-flags-mobile.png)         | Green flags                                   |
| `investor-i7-red-flags`           | —                                                               | [mobile](screenshots/before/investor-i7-red-flags-mobile.png)           | Red flags                                     |
| `investor-i8-portfolio`           | —                                                               | [mobile](screenshots/before/investor-i8-portfolio-mobile.png)           | A few representative portfolio companies      |
| `investor-i9-discovery-style`     | —                                                               | [mobile](screenshots/before/investor-i9-discovery-style-mobile.png)     | How adventurous should discovery be?          |

## Discover

| Page                | Desktop                                                     | Mobile                                                    | Note                     |
| ------------------- | ----------------------------------------------------------- | --------------------------------------------------------- | ------------------------ |
| `discover-founder`  | [desktop](screenshots/before/discover-founder-desktop.png)  | [mobile](screenshots/before/discover-founder-mobile.png)  |                          |
| `discover-fresh`    | [desktop](screenshots/before/discover-fresh-desktop.png)    | [mobile](screenshots/before/discover-fresh-mobile.png)    | Discover with no context |
| `discover-investor` | [desktop](screenshots/before/discover-investor-desktop.png) | [mobile](screenshots/before/discover-investor-mobile.png) |                          |

## Capital

| Page               | Desktop                                                    | Mobile                                                   | Note                |
| ------------------ | ---------------------------------------------------------- | -------------------------------------------------------- | ------------------- |
| `capital-empty`    | [desktop](screenshots/before/capital-empty-desktop.png)    | [mobile](screenshots/before/capital-empty-mobile.png)    | Capital empty state |
| `capital-founder`  | [desktop](screenshots/before/capital-founder-desktop.png)  | [mobile](screenshots/before/capital-founder-mobile.png)  |                     |
| `capital-investor` | [desktop](screenshots/before/capital-investor-desktop.png) | [mobile](screenshots/before/capital-investor-mobile.png) |                     |

## Profile, visibility

| Page                          | Desktop                                                               | Mobile                                                              | Note                       |
| ----------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------- |
| `company-visibility-founder`  | [desktop](screenshots/before/company-visibility-founder-desktop.png)  | [mobile](screenshots/before/company-visibility-founder-mobile.png)  |                            |
| `company-visibility-fresh`    | [desktop](screenshots/before/company-visibility-fresh-desktop.png)    | [mobile](screenshots/before/company-visibility-fresh-mobile.png)    | visibility with no company |
| `company-visibility-investor` | [desktop](screenshots/before/company-visibility-investor-desktop.png) | [mobile](screenshots/before/company-visibility-investor-mobile.png) |                            |
| `profile-dark`                | [desktop](screenshots/before/profile-dark-desktop.png)                | —                                                                   | dark scheme                |
| `profile-founder`             | [desktop](screenshots/before/profile-founder-desktop.png)             | [mobile](screenshots/before/profile-founder-mobile.png)             |                            |
| `profile-fresh`               | [desktop](screenshots/before/profile-fresh-desktop.png)               | [mobile](screenshots/before/profile-fresh-mobile.png)               |                            |
| `profile-investor`            | [desktop](screenshots/before/profile-investor-desktop.png)            | [mobile](screenshots/before/profile-investor-mobile.png)            |                            |

## Failures and unknowns (kept as evidence)

| Page                                                         | Desktop                                                     | Mobile                                                       | Note                                                     |
| ------------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------- |
| `founder-failure`                                            | [desktop](screenshots/before/founder-failure-desktop.png)   | [mobile](screenshots/before/founder-failure-mobile.png)      | TimeoutError: page.waitForURL: Timeout 30000ms exceeded. |
| =========================== logs =========================== |
| wa                                                           |
| `founder-unknown-0`                                          | [desktop](screenshots/before/founder-unknown-0-desktop.png) | —                                                            |                                                          |
| `fresh-person-failure`                                       | —                                                           | [mobile](screenshots/before/fresh-person-failure-mobile.png) | TimeoutError: page.goto: Timeout 45000ms exceeded.       |
| Call log:                                                    |
| [2m - navigating to "http://127.0.0.1:3000/capital", wait    |
| `investor-failure`                                           | [desktop](screenshots/before/investor-failure-desktop.png)  | [mobile](screenshots/before/investor-failure-mobile.png)     | TimeoutError: locator.waitFor: Timeout 45000ms exceeded. |
| Call log:                                                    |
| [2m - waiting for getByRole('heading', { name: 'Are          |
