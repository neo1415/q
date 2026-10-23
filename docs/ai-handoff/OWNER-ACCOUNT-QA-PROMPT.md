# Owner-account QA: the session prompt (start it yourself)

Start a new Claude Code session on `neo1415/q`, branch `speed/q-oct20`. Start it AFTER you add the `USABLE_PASSWORD` environment variable, because a new session picks it up. Paste the prompt below, then tell the session which account email to use.

---

You test Capital Q on production as my own real accounts. I'm the owner and I'm asking you to. Report your findings to the coordinator session (session_01SxtUYQjYXwv8hH5D5RGfsK) with send_message.

**Credentials**

- The password is in the environment variable `USABLE_PASSWORD`. Never print it, log it, commit it, show it in a screenshot or put it in a message.
- Use only the account email(s) I give you in this session.
- Don't approve outward actions (interest, connection, email, chat, booking) or change settings unless I say so here. Reading, asking Q, navigating and preparing actions are fine.

**Read first**

- `CLAUDE.md`
- `docs/ai-handoff/START-HERE.md`
- `docs/ai-handoff/QA-PREMIUM-SCORECARD.md` (investor jobs I1–I22, founder jobs F1–F15, UI checks U1–U10, and the findings log)

**What to do**

1. Run browser QA on https://capital-qweb-production.up.railway.app with Playwright (`executablePath: '/opt/pw-browsers/chromium'`, `NODE_USE_ENV_PROXY=1`).
2. Work through the investor's day like a demanding investor:
   - what needs my attention;
   - the best companies for my mandate, and filtered lists;
   - screening and comparing companies, and cheque fit;
   - founder backgrounds;
   - a 12-month plan or research document, then "save it to my Work board" and "work on those items for me";
   - first contact with a note, and call prep;
   - the pipeline, voice and navigation;
   - cards, mobile at 390 px, and dark mode.
3. Try to break it.
4. Record evidence and findings in the scorecard format on branch `qa/owner-accounts`, under `docs/ai-handoff/evidence/qa-owner/`. Push often. Every 60–90 minutes, send the coordinator the findings (id, evidence, severity, suspected cause) in 25 lines or fewer.
5. Fix UI and copy issues yourself, in small PRs into `speed/q-oct20`. Gates: package build, root tsc, eslint and prettier on the changed files, targeted vitest with provider keys set to `disabled-locally-000000000000`. Send everything else to the coordinator.

**My rules:** no keyword or phrase lists deciding behaviour; fix root causes; premium quality.
