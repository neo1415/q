# Q Card portrait and single card — 2026-11-04 (branch `feat/qcard-portrait`)

Screenshots come from this branch's web app run locally (`next dev`) against the production api and q-api, signed in as the fictional investor `investor.savanna-seed@fictional.capitalq.local`. Reads only; nothing was written. The "N" badge is Next's dev indicator.

1. **Profile photo on the card.**
   - The bug: the owner's preview (`QCardSection` → `QCard`) never passed `portraitUrl`, so the profile page always showed initials, even when a photo or logo existed. The public page already passed the audience-filtered photo.
   - The fix: the section now passes the person's own avatar for the personal card, and the organisation's logo for the company or firm card.
   - Proof: `apps/web/test/q-card-section-portrait.test.tsx` checks a fixture photo renders as `[data-card-photo]` with that `src`, and that initials show when there is none.
   - The shots still show "SP" initials because this fictional firm has no logo. No photo was uploaded to production to demonstrate it.
2. **Adding a photo.** This already exists, so nothing new was needed:
   - person photo: the profile header (`OwnProfileHero`, `profile-image-editor`);
   - company and firm logo: `OrganisationImages` in "Your company" / "Your firm";
   - both use the existing signed-storage actions in `profile-image-actions.ts`.

   No migration and no bucket were added.

3. **One card.** The page now has one "Q Card" section. The company or firm card leads. "Your personal Q Card" is a collapsed, secondary item beneath it, with a 44 px tap target. A person with no organisation sees the personal card as the section.

Files: `after-local-qcard-{light,dark}-{1440,390}.png`.
