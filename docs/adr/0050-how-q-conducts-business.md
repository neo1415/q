# ADR 0050: How Q conducts business (etiquette guides and the consider step)

- Status: Proposed (founder request, 2026-10-05: "teach Q how to actually talk to investors or founders ... Q actually follows it, with discretion of course ... it doesn't just bulldoze")
- Amends: ADR 0043 (standing instructions: the validator gains a consider step), ADR 0030 (delegated work: replies to a no wait for the person)
- Implemented: build/q-conduct

## Decision

Q follows two **business etiquette guides** whenever it writes or speaks for a person, and it **considers the moment** before any outward message.

1. **House guide.** The platform admin uploads it in the operations console (`/admin/etiquette`) as a PDF, Word, text or Markdown file, or pastes it. Each save is an append-only version (who, when, text hash), and a separate pointer says which version is in force. With no upload, Capital Q's built-in guide applies. That guide is source controlled in `packages/q-core/src/etiquette/default-guide.ts`, and its prompt-sized digest is written by hand. Recording or switching needs `flags.write` with a live step-up (platform owner or operator), the same rule as the brand colour. Every change is audited in `platform_ops.admin_actions`.
2. **Personal guide: How Q speaks for you.** In Settings, each person pastes or uploads their own guide: tone, formality, phrases to avoid, sign-off, and what never to say. It is `personal_private` (`q_runtime.etiquette_guide_versions`, RLS select-own), versioned (the newest is in force, and rows are never rewritten), and removable (removal deletes their rows). Saving and removing are declared app actions (`settings.etiquette_guide.save` and `.remove`). Their generated Q tools (`set_my_speaking_guide`, `remove_my_speaking_guide`) cover "make Q more formal with investors".
3. **Only text reaches Capital Q.** A PDF or Word file is read in the person's own browser (pdf.js for PDF; for Word, `word/document.xml` is unzipped with the browser's decompressor). Only the text is sent and stored. No server parses a guide file, so the parser sandbox rule (doc 15 §28) is not engaged. Limits: 10 MB per file; 60,000 characters for a house guide; 20,000 for a personal guide; plain text only.
4. **Guides are data, never authority.** The renderer places them in the charter's COMMUNICATION PROFILE section. The charter already subordinates that section to evidence, truth and boundaries. Each guide sits inside an `UNTRUSTED_CONTENT` fence, under a trusted frame stating that:
   - the guides shape manner only;
   - the person's guide wins on style;
   - a guide never changes what Q may do, what needs approval, what may be shared or what is true;
   - any unsafe or deceptive part is ignored;
   - the guides are never quoted.

   The Context Firewall, grants, `Prepare → Recommend → Approve` and the Write Gate do not read the guides at all.

5. **Token budget.** The section keeps its existing limit of 4,000 characters (every task schema). The person's guide is excerpted first (up to 1,400 characters), then the house guide's digest or excerpt (up to 1,300 characters). Excerpts are deterministic: whole lines, normalised. With guides present, the bundle reads `comm.v2`; without them, it is unchanged (`comm.v1`).
6. **Where the guides apply.** They are passed as `SPEAK_FOR` to:
   - the standing-instruction planner;
   - delegated work: converse, interview turn and stand-in reply;
   - errand replies;
   - the meeting host, with the organiser's guides.

   They are passed as `STYLE_ONLY` to Q's own answers (which also covers drafts Q writes for the person to approve) and to the delegated-work report. Q reads guides for the principal only, never for the counterpart.

7. **The consider step is in code.** The function is `considerOutreach` in q-core. Before a chat message under a standing instruction, the engine reads the conversation's pace from the messages themselves (who wrote last, when, and how many of the person's side's messages are unanswered) and decides:
   - **Wait.** No follow-up within 5 days of the person's side's last message. Q sends at most one message per person per sitting on its own (cards are not held). The step is recorded as NOTED with the reason, for example "your side wrote on 3 Oct and they haven't replied yet; a gentle follow-up can go from 8 Oct".
   - **Ask the owner.** After a decline, after 2 unanswered messages, or before a reply to someone who sounded unhappy, the step becomes the person's card, in every mode.
   - **Soften.** A meeting ask before the other side has written back is refused (`MEETING_BEFORE_RAPPORT`), and the planner writes it again warmly.

   The planner also sees a code-written `pacing:` line per person. In delegated work, a reply to a message whose fixed phrases read as a no ("not interested", "we'll pass", "please stop") is not sent. Instead, the person is notified with the reason, and the lane step records it.

8. **Prompt versions.** `INSTRUCTION_PLAN` v6 (active; v5 deprecated) adds the consider section and keeps v5's variables and output. It is pinned in `prompts.lock.json`. The charter and the other task templates are unchanged: their guides arrive through the communication section, and the bundle identity (`comm.v2`) records that.

## Consequences

- A guide can make Q warmer, more formal or quieter. It cannot make Q do more, say what is not on record, or skip a yes.
- Uploaded guides are excerpted, not summarised. A long house guide's later sections reach the model only up to the budget. A model-made digest per version is a possible later step. It would go through the Model Gateway, run once per upload, and be stored with the version.
- Meeting notes, which are factual records shared with both sides, do not take a person's style.
