---
title: Founder live test on the deployed site, 2026-09-27 (after the cd05882 / e4e41eb deploys)
project: capital-q
date: 2026-09-27
tags: [fixture, acceptance, q, voice]
---

# Founder live test, 2026-09-27

The founder's verdict: "already better than before". Everything below is still to fix. **Map every failure to a general capability (ADR 0011/0016). No phrase patches.** Use this transcript as an acceptance fixture: replay it with paraphrases, not the exact words.

## Failures to fix (grouped by owning capability)

1. **Approval by conversation.**
   - "Approved. Go ahead." / "I approve it." after a prepared change was NOT executed. Q said "no clearly confirmed approval" (turns 9-10, 31-33, 53).
   - Yet the country change was prepared and executed in one flow (17-19), and the description only succeeded on a retry (49-52).
   - Required: when exactly one proposal is pending, an explicit spoken or typed approval that refers to it approves THAT exact payload and executes it through the Approval Engine (payload-bound, idempotent). A modified payload still needs re-approval.
   - Q must never say "ready for approval" and "done" about the same change without a record. Its claims come from the proposal's real status.
2. **Contradictory or verbose status talk.** "The authorised conversation record states…", "no record states…" is backend language. Say it plainly: "Saved." / "Not saved yet: tap Approve on the card." Apply R23 and R37 (UX writing).
3. **Screen awareness (R21).** Q answered "I can't see your screen". It must know the current screen and entities (R21 plus the `runs.screen` follow-up) and say so truthfully: "You're on your profile."
4. **Client actions missing from the registry (R20/R33):**
   - change theme (light/dark/system);
   - refresh or reload the page;
   - open an external website the person names (a new tab, their own declared site);
   - read Q Card status ("is my card saved?"): the Q Card read tool must be registered.
   - These are app capabilities, so Q does them or truthfully offers them.
5. **Navigation to a non-existent page.** "Take me to the queue page" went Home silently. Unknown destination: say it doesn't exist and offer the nearest real page.
6. **Own company, and names misheard by speech-to-text.**
   - Q asked "Which company should the deck be about?" twice for the person's own company (78, 87). Own-company context (E3 f1009a4) must bind; verify on the deployed voice path.
   - Research ran on the misheard "Zener Aviation" instead of the recorded company name "Zino Aviation / ZINO AVIATION LTD" (83, 95). Resolve spoken names against the person's own records before researching.
   - Add the person's own company, person and firm names as Deepgram keyterms, so speech-to-text hears them right.
7. **Multi-document request.** "A PDF of my mandate AND a PPTX pitch deck for my company" must produce both artifacts, with their cards, in one turn. It only asked a question.
8. **Discovery for investors.** "No discoverable companies in your slate": the seeded world isn't eligible on hosted. This is R43, auto-verifying synthetic accounts. Also, "find founders who might be interested" should fall back to the platform's visible companies plus cited public research (Q-030/E3 prospects pattern), not a dead end.
9. **Voice fragmentation.**
   - Partial user utterances show as separate messages ("Okay.", "Okay. That that makes sense.", …), and Q sometimes answers fragments.
   - Q's long answer rendered as one row per sentence (88-99).
   - One utterance is one turn and one row; one Q reply is one row.
10. **Fillers.** "One moment." (removed in 3693ec8a), "One second.", "Checking the public web on that." All must go (R38: search is quiet). Grep `apps/q-api/src/voice/progress.ts` and similar for every spoken progress line.
11. **"Evidence · N" chips on every reply.** UXM's Sources disclosure (ux/minimal-q) must replace them. Merge it.

## Transcript (verbatim, as pasted by the founder)

```
So tell me, um, can you find any... it doesn't matter whether they fit my mandate or not or whatever. Um, can you help me find any founders right now that exist that might be interested?
1. Q: There are currently no discoverable companies or founders in your Capital Q slate to identify as potentially interested. This does not establish that no founders would be interested generally; it means none are presently available in the authorised discovery results. To identify specific founders, we would need discoverable company profiles or another authorised source. [Evidence· 6]
2-3. You: Okay. / Okay. That that makes sense.
4. You: ... I want to edit my profile, specifically my headline. So come up with a headline for me.
5. Q: A concise headline you could use is: "Founder and angel investor backing exceptional pre-seed founders across software, fintech and consumer markets." [Evidence· 2]
6. You: Okay. Can you just... that that is my profile and save that as my headline.
7. Q: The headline is ready for your approval: "..." [Evidence· 5]
8-9. You: Alright. / Alright. Approved. Go ahead.
10. Q: Your headline change is ready for approval, but this message does not provide a clearly confirmed approval of the exact wording. No profile update has been recorded.
11. You: Okay. Show it to me in the profile page.   12. Q: Opening your profile.
14. You: ... can you see my profile right now? Can you see my screen?
15. Q: I can't see your screen. I can only work with information shared in this conversation and records returned through Capital Q.
16. You: ... The country is not added. Uh, make the country Nigeria.
17. Q: Understood.  18. Q: I've prepared this for your approval: Update your investor profile. Country: NG. ...  19. Q: Done. Your investor profile now reads: Country: NG.
21-22. You: ... a description ... Can you help me with the description and add that to the profile ... come up with one for me?
23. Q: A suitable profile description is: "..." I can prepare this as a profile change for your approval.
24-25. You: ... do you think maybe we should add a bit more? What do you think?
26. Q: Yes... I would use: "... typically investing around €3 million ..." One point to consider: the stated €3 million typical cheque is unusually large for a pre-seed profile ... I have not changed your profile.
27-28. You: That's great. So, yeah, lock that in. Let that be my description now. Add it.
29. Q: Nothing has been changed yet.   30. Q: I've prepared this for your approval: Update your investor profile. Description: ... Approve it and it goes in; decline and nothing changes.
31-32. You: Uh, not to complete it. Just add it like that. Approved. I approve it.
33. Q: Your profile description change is ready for approval. Nothing has been changed or recorded yet.
34. You: Are you certain that it has not been added or you're just not sure?
35. Q: I'm certain based on the authorised conversation record: ... The earlier statement that it had been added was not supported by the later record ...
36-37. You: But you are able to add and record the headline. So why can't you do the same thing for the description?
38. Q: The distinction is not that a description cannot be recorded. The authorised record only confirms that the headline was prepared and approved ... I can prepare the description again ...
41. You: Take me to the queue page, please.   42. Q: Taking you home now.
43. You: Show me the transcript.   44. Q: The transcript is already visible in this conversation above. ...
45. You: I want to check something in my profile, please.   46. Q: Opening your profile.
47-49. You: This is weird, dude ... Try again. That same description ... I approve it. Just try again.
50. Q: It has not been added yet.  51. Q: I've prepared this for your approval: ...  52. Q: Done. Your investor profile now reads: Description: ...
53. You: No need to repeat it anymore ... Just go ahead and approve it. I approve it, I mean.
54. Q: The profile description approval is already reflected in the conversation record. No further action is needed here.
55. You: Have you done it?   56. Q: Yes. The conversation record states that your investor profile description was approved ...
59. You: ... can you refresh the page?   60. Q: I can't refresh the page directly from here. Please use your browser's refresh button ...
63-64. You: ... take me to Xeno Aviation dot com. That is my website. I open it?   (no reply)
67-68. You: ... my card, as it is now, is it saved? I hope it is.
69. Q: I can't confirm from the authorised record that your current card is saved. ...
72. You: ... change my screen by the mode. Change it to, uh, light mode.
73. Q: I can't change the screen mode from here. You can switch to light mode using the appearance or theme setting ...
74. You: You take me back home.   75. Q: Taking you home now.
76-77. You: ... give me ... a quick PDF of my mandates. And then now assume that I'm a founder. Everything that you can find about me both online and here, create a ... PPTX ... pitch deck for me. So you are giving me two documents, the PDF and the pitch deck that is PPTX. Do that.
78. Q: Which company should the deck be about?
79. You: You shouldn't be asking me that question. I said my company. What other company would this be?
80. Q: You're right. The deck should be about Zino Aviation, your company. The earlier request remains unresolved because no pitch deck has been confirmed as created or delivered.
81-82. You: ... create ... the pitch deck for Zener Aviation on everything that you can find ... just do it with whatever you can find.
83. Q: The public sources I found on Zener Aviation don't say enough about the company to fill a deck. If you have a website or a document for it, give me that and I'll build it from there.
84. You: What is the Zen eye vision? Is it Zeno? Like, my company, Zeno Aviation.
85. Q: Your company name is recorded as **Zino Aviation** — spelled **Z-I-N-O Aviation** — and its confirmed legal identity is **ZINO AVIATION LTD**. ...
86. You: ... create a pitch deck on it ... whatever information that you have ... Just go ahead and give it to me.
87. Q: Which company should the deck be about?  88. Q: You're right.  89. Q: The deck should be about Zino Aviation, your company.  90. Q: The earlier request did not specify a different company, so that clarification was unnecessary.  91. Q: The company-specific material currently established includes Zino Aviation, legally ZINO AVIATION LTD, registered in the UK, company number 13100002, ...  92. Q: One moment.  93. Q: One second.  94. Q: Checking the public web on that.  95. Q: The public sources I found on Zener Aviation don't say enough about the company to fill a deck.  96. Q: If you have a website or a document for it, give me that and I'll build it from there.  97. Q: Your company is Zino Aviation — spelled Z-I-N-O Aviation.  98. Q: The authorised record identifies its legal name as ZINO AVIATION LTD.  99. Q: "Zener Aviation" and "Xeno Aviation" appeared in earlier conversation, but those names were not established as the company's confirmed identity.
(UI chrome at the bottom: Mute End | Female Male | Ask Q | Investor private · Zino Aviation)
```
