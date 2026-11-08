# Conversational depth (DECISIONS 81): design

Status: **PROPOSED**, for the owner's review before build (batch 14).
Author: W5, 8 Nov 2026.
Base: integration `fix/resume-asking-cv9ru3` at 73c14b64c.
Governed by: D81, within D77 (required set, no loops) and D79 (every profile field mandatory, no advertised optionality).

## The problem, in run 8's own words

E2e run 8 finished cleanly in the technical sense, but it reads like a form.

**Founder:**

> Q: "Let's cover the financial picture: which currency do you use, roughly how much did you bill last month, and has revenue been growing, flat, declining or lumpy?"
>
> Q: "What are your approximate gross margin, monthly spend beyond revenue, cash in the bank, and runway?" (asked seven times, reworded)

**Investor:**

> Q: "What's off the table for you: anything you'd rather not see, anything that should never be shown to you, or none?"
>
> Them: "None."
>
> Q: "What kind of company fits you: …?"

What goes wrong:

- **Generic questions.** "The financial picture" bundles four numbers into one question.
- **No "why".** Nothing follows a stated preference: "repeat founders and capital efficiency" goes straight to "how firm is that?".
- **No playback.** Nothing is played back in their words before it is saved, except figures, which are read back as a field dump at the very end ("From what you said: Deploying now: Actively investing Minimum cheque: …").

## Principle: reuse, don't rebuild (D77)

No new engine. Four existing pieces carry the five behaviours:

| Piece                     | Where                                                                                                                                     | Today                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **A. Typed reply prompt** | `ONBOARDING_TYPED_REPLY` (q-core, v10 active), used by the typed engine (`typed-onboarding.ts`, which every typed turn takes)             | Writes Q's next message from the checklist and the conversation    |
| **B. Checklist / brief**  | `briefOf` (`onboarding-conversation.ts`), shared by typed and live voice                                                                  | The topics, their status, their choices, the theme questions       |
| **C. Live voice prompt**  | `livePrompt` INTERVIEW block (`voice/live/prompt.ts`)                                                                                     | The realtime voice conversation's rules                            |
| **D. Held read-back**     | `holdInferred` and pending recommendations; `finishingLine`'s set read-back; `heldOfferedIn`, `isPlainYes` and `restatedHeld` for the yes | Figures and inferences wait for their yes; read back at the finish |

The interview agent (`INTERVIEW_AGENT` v16 and `onboarding-flow` notes) is the fallback typed path and the voice "think" path. It gets the same rules as A, as turn-note lines, so all three surfaces agree.

## The five behaviours, mapped

### 1. Ask the question that gets a real answer

A specific, easy question, never a generic one. One concrete thing per question, anchored in something they can picture.

| Instead of                   | Ask                                                       |
| ---------------------------- | --------------------------------------------------------- |
| "the financial picture"      | "Roughly what did you bill last month?"                   |
| "What's your traction?"      | "How many paying customers do you have today?"            |
| "What sectors do you avoid?" | "Is there a kind of company you'd pass on straight away?" |

- **A (template, v11):** a new rule says to ask about one concrete thing, anchored in something they can picture or remember, in words a person would use. Never bundle several unrelated figures into one question; group only what belongs together (smallest, typical and largest cheque), as today.
- **B (brief):** the founder finance topics are listed as separate, concrete questions. Today's run-on "financial picture" wording comes from the model bundling four topics.
  - The three investor theme questions (batch 9) keep their exact words, which code detects. Each gets a concrete example in the brief, so the model can open with it.
- **C (live):** the same rule in the INTERVIEW block.
- **finishingLine:** its code-written questions are SPOKEN_QUESTIONS, short and specific already. Unchanged except behaviour 3.

### 2. Follow up on why

When they state a preference or a dislike (a must-have, an exclusion, a "never", a strong lean), Q asks once why, or what they are trying to achieve, before moving on.

- **Once per stated preference.** Never for a plain none or "no preference", never twice for the same topic, never a chain of whys.
- **Their why is kept with that topic** as its note, in their words: the response `note`, from migration 20261006120000_onboarding_response_note. It is never a separate field.
- **A (template, v11):** the rule above. The result schema gains `probing: <topic id> | null`, the topic whose why this message asks.
- **Code (typed engine), the guarantee:** a per-session set of topics already probed.
  - A reply probing a topic a second time has that question taken out, and the next topic is asked instead, through the same mechanism as batch 13's `parkRepeated`.
  - A why question also counts toward D77's per-step ask limit, so depth can never become a loop.
- **B / C:** the same rule for voice. The live prompt says it in words; code can't count there, so it says "once".

### 3. Offer choices to react to

For a choice topic, Q offers the choices ("this, this or this, or none?") and accepts mixes ("mostly the first, a bit of the second").

- **B (brief):** already lists `(choices: …)`. For strength and preference topics it now marks them "offer these choices".
- **A / C:** the rule says to offer two or three choices as something to react to, and that a mix is an answer. A mix across topics ("a must for West Africa, nice to have for fintech") answers each topic it names. Today the template only says choices "may help as examples".
- **finishingLine, code:** the first ask of a strength or preference step now offers its choices too. Since batch 11, only the second ask does. So "Are those musts, or more of a preference?" becomes "Are those musts, or more of a preference: must match, strong preference or nice to have?".
- **Mixes in the reading:** already handled. A multi-select records several; single-select strengths are one per focus.

### 4. Play it back before anything is saved

This is the one structural change.

**Today:**

- A stated answer is saved by the background reading as soon as it is read.
- Only figures, inferences and long answers wait for a yes, and the figures are read back at the finish.

**Proposed: per-topic playback and confirm.**

1. **Topics.** The journey's own phases are the topics, grouped as the profile shows them:
   - Investor:
     - firm and role;
     - deployment and cheques;
     - where and what (geography, sectors and their firmness);
     - the three themes (off the table; company fit; what makes them lean in);
     - portfolio;
     - inbound;
     - their firm in their words.
   - Founder:
     - the company;
     - team;
     - traction;
     - the raise;
     - finances;
     - the profile sections (F9, which already say back).
2. **Held, not saved.** While a topic is open, what their words state is held for their yes, exactly as figures are today (`holdInferred`, pending recommendations), not committed. Nothing new is stored: the held store, its rationale ("From what you said: …") and its expiry already exist.
3. **The playback (code, deterministic).** When Q's next question would move to a different topic, or they ask to finish, and the topic has held values, code puts the playback first, as that turn's one question. It uses their words where they gave them, and labels, never questions (the batch 11 rule):
   - "Let me get this right: you lead and co-invest, cheques from $250k to $1m, usually $500k. Is that right?"
   - The next topic's question waits for the turn after their yes.
4. **Their yes** accepts exactly what was played back. This reuses `heldOfferedIn`, `isPlainYes` and `restatedHeld`, and `port.accept` still checks each value was said.
5. **A correction** ("not 500k, 400k") is read as a correction of that topic's held value. Code replays the corrected topic ("Got it, so: … $400k typical. Is that right?") until they say yes. Each replay is the corrected set, never the old one.
6. **finishingLine's read-back** is unchanged: it reads back anything still held at the finish, which per-topic playback leaves nearly empty. The final review (D-OWN-3) still shows the whole record before the mandate goes live.

Where it lives:

- **Code (typed engine):** a `topicPlayback` step after the reply, before the line is kept. It is the same place batch 13's `parkRepeated` runs.
- **A / C:** the template is told that playback is code's. Q's own message never says a topic back unless asked, so there is never a double playback.
- **Live voice:** the realtime model holds the conversation. The INTERVIEW block gets the "Let me get this right" rule. The saving still happens in the background reading, so the held, not saved, path (2) applies to voice too.

What stays immediate:

- **Explicit nones** settled by code (batches 10–12) are explicit answers, not readings. They stay immediate, and the topic's playback includes them ("…, nothing off the table"), so a correction can still change them. **Question 1 below.**

### 5. Not in a rush

Depth before completion, while still collecting the mandatory set.

- **A / C:** remove the pressure.
  - No "quickly", no counting down what is left.
  - One follow-up per topic is welcome (the why, or "tell me more" on a vague answer) before moving on.
  - The opening keeps "about N minutes" (it is useful), and the minutes are recomputed for the extra turns.
- **The D77 guards stay** and bound depth:
  - one why per preference;
  - a needed question asked at most twice, then its reason, then left for now (batches 11 and 13);
  - one playback per topic, with replays only on a correction.
- **finishingLine** still collects whatever needed topic is open at the end, so nothing required is lost to depth.

## Three example exchanges (fictional), target against run 8

**1. Investor: a preference, the why, and playback** (run 8 Q12 and Q14–16)

> Q: What makes you lean in when you meet a founding team: the founders themselves, signs of traction, or something else?
>
> Them: Repeat founders, and capital efficiency.
>
> Q: Why repeat founders: is it speed, or that they've already been through a raise?
>
> Them: Mostly speed. They hire faster and don't make the first-timer mistakes.
>
> Q: Got it. How firm is capital efficiency for you: a must-match, a strong preference, or nice to have?
>
> Them: Strong preference, but not for climate hardware.
>
> Q: Let me get this right: you lean in for repeat founders, because they move faster, and capital efficiency is a strong preference, except in climate hardware. Is that right?
>
> Them: Yes.

Run 8 went straight from the answer to three separate "how firm is …?" questions, with no why and no playback.

**2. Founder: specific questions, a correction replayed** (run 8 Q5–18)

> Q: Roughly what did Tamarind Ledger bill last month?
>
> Them: About 18 thousand dollars.
>
> Q: And is that growing, flat or lumpy month to month?
>
> Them: Growing, maybe 10% a month.
>
> Q: What's your monthly spend beyond that revenue, roughly?
>
> Them: Burn's around 25k.
>
> Q: Let me get this right: you billed about $18k last month, growing around 10% a month, and you burn about $25k a month beyond revenue. Is that right?
>
> Them: Billing was 16k, not 18.
>
> Q: Thanks. So: about $16k last month, growing around 10% a month, burning about $25k beyond revenue. Is that right?
>
> Them: Yes.

Run 8 asked for four figures in one question, seven times.

**3. Investor: choices to react to, a mix, a dislike's why** (run 8 Q8–10)

> Q: How firm is West Africa for you: a must-match, a strong preference, or nice to have?
>
> Them: Must for West Africa. Fintech's more of a preference.
>
> Q: Clear. Is there a kind of company you'd pass on straight away?
>
> Them: Gambling, and anything crypto-speculative.
>
> Q: What puts you off speculative crypto: the regulation, or the business models?
>
> Them: Regulation. Our LPs won't touch it.
>
> Q: Let me get this right: West Africa is a must and fintech a strong preference; you pass on gambling and speculative crypto, because your LPs won't touch it. Is that right?

Run 8 asked "How firm is your focus on West Africa" and "on fintech" as two questions, then "What's off the table…" with no why.

## What code can assert (tests for batch 14)

1. **Playback precedes save.** At the typed-engine level, a topic's stated answers are held, not committed, until their yes to the playback. After the yes, they are committed exactly as played back.
2. **A correction replays the corrected summary.** The replay carries the corrected value, never the old one, and repeats until a yes.
3. **Choices for strength and preference steps.** finishingLine's first ask offers them, and the brief marks them.
4. **A why once per stated dislike.** A second probe of the same topic is taken out and the next topic is asked; why questions count toward D77's per-step limit.

Prompt quality, plus a small live check:

- `ONBOARDING_TYPED_REPLY` v11 and the live INTERVIEW block, with a lock regen.
- An Anthropic-only live check of about 10 turns per journey, only if estimated under $2 (budget about $42.5 of $50 used). Never OpenAI.

## Questions for the owner

1. **Explicit nones:** keep code's explicit nones immediate and in the playback (proposed), or hold them for the yes too?
2. **Simple identity facts** (website, role, country): played back with their topic (proposed), or saved at once as today?
3. **Why answers:** kept as that topic's note (proposed), or also shown on the profile? Today a response note is private working text.
