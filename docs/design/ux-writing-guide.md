# Capital Q — UX writing guide

Status: binding for every user-facing string in `apps/web`, Q's spoken lines (`apps/q-api/src/voice`) and the stage labels in `@capital-q/contracts`. Serves R37 (minimal, clear, human) and R38 (no search theatre). Where this guide and a locked product source disagree, the product source wins and the conflict is flagged.

## 1. Voice

Capital Q sounds like a senior analyst at a good firm: calm, exact, brief, on the person's side.

- **Plain.** Short words, short sentences. One idea per sentence. Cut "please", "simply", "just", "easily", "seamlessly".
- **Specific.** Say what happened and to what. "Tarmacly saved." beats "Action completed."
- **Active.** The actor is named or obvious. "Q prepared a brief." not "A brief has been prepared."
- **Evidence before opinion.** State what is known, then what it means. Never present inference as fact; never invent a percentage.
- **No hype.** No exclamation marks, no "amazing", "powerful", "unlock", "supercharge", "magic", "AI-powered". No celebration when a match or interest lands.
- **Human, not cute.** No jokes in errors, no emoji, no "Oops".

Tone shifts with the moment, the voice does not: neutral for routine work, careful for money and consent, direct for errors, quiet for success.

## 2. Mechanics

- **Sentence case** everywhere: headings, buttons, tabs, labels, menu items. Capitalise only the first word and proper nouns (Capital Q, Q, Discover, Capital, Saved, Relationships, Settings, Q Card, Gmail).
- Headings and labels have **no full stop**. Sentences in body text, empty states, errors and toasts do.
- Use numerals: "3 companies", not "three companies". Use the Oxford comma only when needed for clarity.
- Contractions are fine ("can't", "didn't") and read as human.
- Never show a raw enum, code, id, key, stack trace or HTTP status. Map every value to words; unknown values read "Not stated".
- Never name an internal system, specialist, model, provider or prompt ("the gateway", "the turn reader", "Bright Data", "GPT").
- Second person for the reader ("your raise"), third person for Q ("Q found"). Q speaks in the first person only in its own voice (answers and spoken lines).

## 3. Terms (one name per concept)

| Use                    | Meaning                                                                         | Don't use                                                         |
| ---------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Q**                  | The one intelligence the person talks to                                        | the AI, the assistant, the bot, agents                            |
| **Q Card**             | A company's or investor's shareable card with its handle and QR code            | QCard, Q card, profile card, business card                        |
| **raise**              | A company's current capital objective (amount, instrument, timing)              | round, fundraise, deal, campaign                                  |
| **mandate**            | What an investor declares they invest in (sectors, stages, geographies, cheque) | thesis (except the free-text thesis field), criteria, preferences |
| **cheque size**        | Amount an investor puts in per company                                          | ticket, check size                                                |
| **interest**           | An investor's explicit, server-confirmed signal to a company                    | like, match, request, lead                                        |
| **Save / Saved**       | Keep a company to revisit. Private. Never interest                              | bookmark, favourite, shortlist                                    |
| **Pass**               | Not for me, for now. Neutral, never red                                         | reject, decline (of a company), dismiss                           |
| **relationship**       | The one company-investor record and where it stands                             | deal, connection, match, lead, pipeline                           |
| **evidence / sources** | What supports a statement; "Sources" is the tap target                          | proof, citations, references                                      |
| **verified**           | Capital Q or a trusted source confirmed it                                      | approved, certified, trusted                                      |
| **approve**            | The person's explicit yes to an exact proposed change                           | confirm (for consequential actions), OK                           |
| **visibility**         | Who can see a company in Discover and at what depth                             | privacy settings, sharing                                         |
| **pitch**              | The company's pitch video and deck                                              | reel, clip, story                                                 |
| **organisation**       | UK spelling throughout (organisation, favourite, colour, cheque)                | organization, color, check                                        |

## 4. Buttons and links

- Start with a verb that names the result: "Save", "Pass", "Express interest", "Approve change", "Upload pitch", "Try again", "Open Discover".
- One or two words where possible; never "Submit", "OK", "Click here", "Yes"/"No" alone, or "Continue" when a more exact verb exists.
- The confirming button repeats the action in the dialog title: title "Remove pitch video?" → button "Remove video".
- Destructive actions name what is lost; the cancel button reads "Cancel" or "Keep …".
- Links read as their destination ("Open Relationships"), never "here" or "learn more" alone.

## 5. Errors

Pattern: **what happened. what to do.** Never blame the person; never apologise twice.

- "Saved list couldn't load. Try again in a moment."
- "That file is over 25 MB. Choose a smaller file."
- "Your change wasn't saved. Check your connection and try again."
- Field errors sit next to the field and say what is needed: "Enter an amount in USD."
- If nothing is lost, say so: "Nothing is lost."
- No "Something went wrong", "Error:", "Failed to …", codes or technical detail. If support needs an id, label it "Reference".

## 6. Empty states

Say what will be here and the one next step. Never a dead end.

- "No saved companies yet. Save a company in Discover to come back to it." + "Open Discover"
- "No relationships yet. They start when an investor expresses interest or you answer one."
- Unknown is a valid state: "Not stated", "Not shared yet", never "0" or "N/A" for missing data.

## 7. Confirmations, approvals and status

- Success is quiet and past tense, one line: "Saved.", "Interest sent.", "Pitch uploaded."
- Q prepares; the person approves. Before approval, say plainly nothing has changed: "Not saved yet. Tap Approve to apply this change."
- After approval: "Applied." or the specific result ("Profile updated."). Never "Done!".
- Pending, server-confirmed actions show the state in place: "Sending…", then "Interest sent." Use a real ellipsis (…).
- Consent and money lines state the consequence first: "The company will see your name and organisation."

## 8. Q's spoken and written style (R23, R38)

- Answer first, in one or two sentences. Evidence and sources are behind "Sources", never dumped by default.
- No fillers or wait lines: never "One second", "Let me check", "Still working on it", "Great question".
- **No search theatre.** Q never says or shows "Searching the web", "Checking the internet", "Browsing", "Looking it up online". Web research runs quietly; the answer arrives with Sources on tap. The visible working stage is neutral ("Looking into it").
- Say where facts come from only when it changes trust: "From public sources:" or "You told me …", once, briefly.
- Uncertainty is stated plainly: "Not enough evidence to say." Never guessed, never hedged three times.
- Status and approvals in speech mirror §7: say what is proposed, then that it waits for their approval.
- Never read out ids, enums, URLs in full, or internal names.

## 9. Numbers, money and dates

- Money: currency code or symbol plus amount, compact above 1,000: "$2.5M", "£750K", "€1.2B". Ranges use an en dash: "$250K–$1M". Never a float artefact ("$2.4999999M").
- Percentages: "12%", no space. Multiples: "3.2×".
- Dates: "27 Sep 2026"; with time "27 Sep 2026, 14:05". Relative times for recent events: "2 min ago", "Yesterday". Never ISO strings or raw timestamps.
- Counts pluralise correctly: "1 company", "2 companies".
- Missing numbers are "Not stated", never "0" or "—" alone.

## 10. Checklist before merging copy

1. Sentence case, no Title Case headings.
2. Verb-first buttons; no "Submit"/"OK"/"Click here".
3. Every error says what to do next; every empty state has a next step.
4. Terms match §3.
5. No raw enums, ids, codes or internal names.
6. No exclamation marks, hype or search theatre.
7. Numbers and dates follow §9.
