# Q Card S6: design critique notes (2026-10-22)

Screenshots in this folder come from the fixture harness `/dev/q-card-identity` (`?subject=company|investor&audience=public|participant&empty=1`). The harness uses synthetic data and makes no API, database or provider call. It renders with the public `black_gold` preset (`PublicBrandStyle`).

Each file is named `<subject>-<audience>-<scheme>-<width>.png`:

- subject: company or investor;
- audience: public (anonymous) or participant (signed in);
- scheme: light or dark;
- width: 390 or desktop (1280).

`company-empty-light-390.png` shows a company that has shared nothing.

## What changed and why

- **One identity object, one dossier.** The landscape Q Card stays the hero, as the founder designed it on 2026-09-28. Below it, the sections sit on a single surface with hairline dividers, in place of a stack of folding cards. That avoids cards around everything and card-in-card, and it reads like an identity document.
- **The story order is the owner's line**, used as stable anchors for the Q Story beats #48–49: Story → Numbers → The raise → Intelligence → Relationships, then Team and Documents on request.
  - Selector: `[data-card-section="<id>"]`.
  - Element id: `card-<id>`.
- **Numbers carry their truth.** Each figure is large tabular type over its label and period, then one line saying how it is supported and what it is. Examples:
  - "Document-supported · Company's statement";
  - "✓ Verified by Capital Q · Verified fact".

  Meaning is never carried by colour alone: the tick always comes with words. There are no percentages of confidence. Contradicting readings of a fact sit side by side.

- **Q's reading is labelled as Q's.** The band and confidence are given in words, with "Q's inference, not a verified fact or a recommendation". "Not enough evidence yet" says outright that this is not a verdict on quality. It is built from the investor-facing InvestIQ view, never the founder-private readiness diagnosis.
- **Empty is quiet and uniform.** A section with nothing for this visitor is one row: the label, then "Not shared yet". It uses the same words whether the owner never filled it, kept it to members, or kept it private, so it hides what is behind it without blurring or teasing.
- **Members marker.** "Shown to Capital Q members" sits on any section a participant sees because of `network_visible`. It never appears on an anonymous page.
- **Mobile first.**
  - Numbers sit in two columns even at 390 px. They are short, and a single column was 4× taller.
  - Relationships use a 2×2 grid at 390 px and four across on desktop.
  - Section headers wrap rather than collide with the marker.
- **Typography.** The name moved from 700 to 600 weight, because ADR 0017 prohibits weights of 700 and above. Large numbers use `tracking-tight` and `cq-numeric`.
- **Link preview.** The OG image now draws the `black_gold` dark card, with a gold edge, ivory name and champagne "Q Card · Capital Q". It still uses public_external fields only.

## Known gaps (named, not hidden)

- **No PERSON subject type.** The task asks for a person card (investor/founder). A card is still per organisation (COMPANY or INVESTOR_ORGANISATION).
  - The investor card covers the firm's role and type, its mandate summary, what they look for, verification and now its team (names and titles, members only).
  - A true per-person card needs:
    - a PERSON subject on `core.handles` and `core.shareable_identities` (a check-constraint migration);
    - self-ownership authorization in place of `handle.manage`.

  That touches shared authorization, so it is proposed rather than built in this lane.

- **Use of funds** is the owner's own `use_of_funds_summary` on the active capital objective, shown only when they put "The raise" on the card. The amount committed so far is not shown: no actor-free read of commitments exists, and unknown is left out rather than guessed.
- The public page is still `force-dynamic`. The read is per visitor, because a signed-in participant gets a wider projection. A cached anonymous read is a follow-up; signed image URLs expire and need care.
