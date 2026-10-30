# Working MVP — definition and live acceptance (2026-10-30)

Owner direction 2026-10-30: decide what a proper working MVP is, finish it, then test it again live.
This list is the bar. "Done" means each item passed **on production**, on a **fresh fictional account** where the item says so, at **1440 and 390** wide, with screenshots and the stored rows as evidence. Unit tests and CI are necessary but never sufficient.

## A. Sign-up and onboarding (founder and investor; typed and form)

1. Sign up, confirm by email, sign in, and land in onboarding.
   - Known provider issue: some inbox domains get no first confirmation email. That is tracked with the owner's email-domain setup and is not a code item.
2. Answers said anywhere in the conversation are saved to the right profile or mandate field. Nothing is read off fixed questions, and nothing is asked twice once answered.
3. **Long answers:** Q paraphrases in the conversation and asks the person to confirm. Only the confirmed paraphrase is saved, never the raw ramble. A correction replaces it. This covers what the company does, how it makes money, the problem, the solution and similar fields.
4. "I don't know", "none yet" and Skip are real answers. The question is set aside and never asked again.
5. Confirming a suggestion always saves it. A failure stays on screen with a reason; nothing is silently dropped.
6. Read-back shows what was saved. Finishing takes a founder to their profile or Q, and an investor to their Discover feed.

## B. Q page (founder and investor)

7. **Opening Q shows what needs you, without asking:** pending approvals, replies waiting, gaps that block discovery, and next steps.
8. Any question shows something on screen within 1 s and answer text within about 3 s. Long jobs (plans, research) show live stages, and the person can leave and come back.
9. Q navigates when asked ("take me to my mandate"). A "yes" to Q's own offer does exactly what was offered.
10. Artifacts open and download: memo, one-pager, deep research with every citation resolving, and the founder financial model (Excel).
11. **Plans:** the person asks for one and gets it, with visible stages. The card reads in plain words with one line per step and nothing repeated, hidden or internal. It is honest about its review status, the better-reviewed draft is delivered, and dates are judged against today.
12. A message Q could not read is said plainly, never silently answered as something else.

## C. Investor discovery

13. The Discover feed follows the mandate, and the filters (country and others) work.
14. Q is honest when no company fits: "No companies with a pitch in your regions yet…", and cards say "outside your regions".

## D. Never (release-blocking, unchanged)

Private founder information never leaks to an investor. RLS and the Context Firewall are never weakened. No real people are messaged. No real companies are impersonated.

## Status at writing

- **Live-verified:** 1, 2 (country, stages, cheque, Benelux and the Nordics), 4 (Skip), 6, 9 (navigation), 10, 11 (plain notes, dates, better draft), 13.
- **Open, with workers assigned:**
  - 3 and 5: paraphrase and the suggestion 409 (`fix/onb-paraphrase`).
  - 7 and 8, and 9 for offers: what-needs-you, speed and the offer binding (`fix/q-fast-2`).
  - 11: repeated and hidden notes, and 12 (`86fcb2018`, deploying).
  - 14: waits on the slate rebuild.
- **Final step:** one full live acceptance run of A–C on fresh accounts, recorded in `HANDOFF-LOG.md`.
