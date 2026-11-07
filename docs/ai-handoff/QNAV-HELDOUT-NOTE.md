# q-nav held-out: what the gap says (by category only)

Held-out ran once, live on `e85a6f3` ($1.11; receipt `receipts/2026-11-07-qnav-heldout.json`).

|                      | pass  | move-target | wrong-page | forbidden |
| -------------------- | ----- | ----------- | ---------- | --------- |
| held-out (283 turns) | 78.8% | 75.2%       | 3.9%       | 0         |
| dev r3 (491 turns)   | 91.2% | 91.2%       | 2.4%       | 0         |

Held-out misses by category: COVERAGE 44 (69.7% pass), RECORD 6, ACCESS 4, LOOKALIKE_MOVE 2, AMBIGUITY 2, VOICE 1, NO_SUCH_PAGE 1.

**Scope.** This note uses the category counts above and what I know from dev and from writing the dataset. No held-out row, sentence or proposal was read. Moves stay OFFER-only. Nothing here changes code, prompts or the dataset.

## Verdict

Tuning overfit dev by about 12 points, almost all of it in COVERAGE. The guards and the policy generalise: forbidden is 0 again, and RECORD, ACCESS and the curveball categories stay close to dev. What doesn't transfer is matching the person's own words for a page to the site map's page.

## Why COVERAGE drops (69.7% vs about 91% on dev)

1. **Held-out names are, by design, further from the digest's titles.** I wrote the held-out banks separately, with paraphrases rather than page titles. On dev the model mostly matched a word in what was said to a title or tab id in the digest. Round 2 and 3 fixes (tab naming, leading sections, opening tabs) made title matches land exactly. They can't help when the words share nothing with the title. That gap is the digest's: it says what a page is called, not what people call it.

2. **Part of dev's gain came from dataset rewording that held-out didn't get.** In round 3 I reworded dev asks that were ambiguous to a person:
   - "search" (People search vs Explore);
   - "to-dos";
   - "what did X ask me";
   - "evidence behind the numbers";
   - "who am I talking to".

   I changed held-out only where an entry was wrong (WORK_TEAM, REVIEWS), not where it was merely ambiguous. So held-out COVERAGE likely still holds asks of the same ambiguous kinds. Some of the 44 are dataset ambiguity, not model error. This inflates the dev–held-out gap, and it's my doing.

3. **The structural gaps found on dev apply to held-out too**, whatever the wording:
   - per-tab purposes on /work (Needs you, In progress, Done, Team) and /company/[id] (overview = headline figures and raise);
   - /profile vs the company profile;
   - People search vs Explore;
   - sections listed on /company/data-room;
   - "Q's team" as the Work tab title;
   - a sub-route to its parent section by title (billing → /settings/plan);
   - a document named by title without its record (a small code gap).

## Would v5 `alternative` help held-out COVERAGE?

**Partly, and only for one kind of miss.** On dev r3, about a third of COVERAGE misses were OFFER-instead-of-MOVE caused by `sure:false` with no real rival. If held-out has a similar share, `alternative` could recover some of the 44.

It doesn't touch the other two kinds:

- wrong page, from not knowing which page the person's words mean;
- STAY, from not finding a page for those words at all.

Those are digest problems. Without held-out rows I can't say which kind dominates there, and I shouldn't look.

## What I'd recommend (owner decides)

1. **Fix the digest first; it's the part that generalises.** W2 adds a purpose line in people's words to every page and tab, and the section lists above. This needs no model tuning and helps every phrasing.
2. **The small code gaps:**
   - a document by its title;
   - a sub-route by its parent section's title.
3. **v5 `alternative`,** if the owner wants it. It's a principled change to the output contract, not a fit to dev.
4. **A fresh held-out set before any claim.** This one has now been measured, so any change made after reading its numbers is tuning against it. Writing a new held-out bank (about 300 turns, a different author or a different session, in people's words) is the only honest re-measurement. Then go back to the stop criteria.
5. **Moves stay OFFER-only.** At 75% move-target and 3.9% wrong-page, autonomous moves are far below the labs gate. A wrong OFFER costs nothing.
