# TURN_READER v64 — queued notes

Owner: the TURN_READER lane (one owner of reader versions). v63 is live. Nothing here is built yet. Each item goes into v64 only when v64 is needed.

## 1. "My pipeline" is CRM_PIPELINE, decided by meaning (coordinator, 24 Oct 2026)

**Context:**

- An investor's "Show my pipeline" was once answered with capital commitments: "one recorded commitment: USD 250,000 to Ledgerfold…".
- #425 added a code hint: `PAGE_VERB` accepts "show my X" / "show our X" as a page request.
- That hint is a phrase rule, and it stays only as the fast hint. It cannot tell "show my pipeline" (open the page) from "show my pipeline by stage" (a question about it).

**v64 rule:**

- The reader decides by meaning whether the turn is about the CRM pipeline (relationships by stage) or about capital.
- When a person says "my pipeline", they mean their relationships by stage. Capital is one part of that and never the whole answer.
- Asking to see it is NAVIGATE CRM_PIPELINE. Asking something about it is a question about the pipeline: not capital, not compare, not fit.

**Eval cases** (investor and founder unless noted):

| Said                                         | Expected reading                                   |
| -------------------------------------------- | -------------------------------------------------- |
| Show my pipeline                             | NAVIGATE CRM_PIPELINE                              |
| Show me my pipeline                          | NAVIGATE CRM_PIPELINE                              |
| Open my pipeline                             | NAVIGATE CRM_PIPELINE                              |
| My pipeline                                  | NAVIGATE CRM_PIPELINE                              |
| Show me my fundraising pipeline (founder)    | NAVIGATE CRM_PIPELINE                              |
| What does my pipeline look like this month?  | question about the pipeline (summary), not capital |
| Show my pipeline by stage                    | question about the pipeline by stage, no compare   |
| How many companies are in diligence?         | question about the pipeline                        |
| What have I committed? / Show my commitments | capital                                            |
| Take me to capital                           | NAVIGATE CAPITAL                                   |
| Compare the companies in my pipeline         | compare (2–4 named or most recent), not navigation |

**Live evidence (24 Oct):**

- Run 172c84a9 went to capital.
- Run acdc8ba3 gave the correct summary.
- Run 3623705e failed, but that failure was the tool-call cap fixed in #425, not the reader.
