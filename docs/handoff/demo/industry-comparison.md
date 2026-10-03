# How private capital works today, and what Capital Q changes

One page for the 2026-10-05 investor demo. It makes five claims, each one
built into the product and shown live in the demo script. Nothing here is
a measured result. The only time figures are in the last table, which is
labelled as an illustration.

## Today

Early-stage private capital still runs on warm introductions, cold email,
decks passed around as attachments, and each side's own spreadsheet or CRM.
The usual pattern, which is also the founder and investor journey mapped in
`docs/handoff/research/business-research.md` §1:

- **Visibility follows reach and money.** Founders get seen through who they
  know, paid listings, events and promoted placement. Investors get seen
  through their brand. Where a list is ordered, the reader usually cannot
  tell why.
- **Opinion travels faster than evidence.** A deck's numbers, a founder's
  claims and a third party's view arrive mixed together. Absence of data
  often reads as a bad sign.
- **Tools act or advise, rarely both safely.** Assistants either draft text
  a person has to carry over by hand, or send on the person's behalf with
  little control over exactly what goes out.
- **Every side keeps its own record.** The founder's tracker, the fund's
  CRM and the inbox each hold a different version of where things stand.
  Stages are edited by hand and drift apart.
- **Sharing is all or nothing.** Once a document or figure is shared, it is
  hard to know who saw it or what it influenced.

## With Capital Q: five claims we can defend

| #   | Claim                                                        | What it means in the product                                                                                                                                                                                                                                                                                   | Where to show it live                                                                                           |
| --- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | **Ranking can't be bought.**                                 | Investors see companies in an order set by a deterministic, versioned ranking: declared mandate, fit, evidence and freshness. There is no paid placement, and engagement counts (views, watch time) are not ranking inputs. Viewing is not interest.                                                           | Discover feed; Discover → Investors on the founder side states how the list is ordered                          |
| 2   | **Evidence before opinion.**                                 | Every fact on a company profile shows who stated it and how well it is supported (self-reported, document-supported and so on), with its sources. Unknown stays "unknown" or "not shared with you", never zero. Contradictions sit side by side; neither is picked. Q's inferences are labelled as inferences. | Company profile → "What is known, and how well supported"                                                       |
| 3   | **Prepare → approve → act.**                                 | Q prepares the action and shows exactly what will be sent and to whom. A person approves that exact payload, and only then does it happen. A changed payload needs a fresh approval. A standing instruction is approved once as a plan with a budget, and each step still comes back as a card.                | Standing instruction ("…except Clinicrest") → approval cards                                                    |
| 4   | **One shared record of each company–investor relationship.** | Exactly one relationship row per company and investor organisation. Discover, Q and both sides' Relationships pages read the same record. Its stage is computed from an append-only event history, not edited by hand, and not decided by a model.                                                             | Relationships list and detail; "What happened" with "Shared with …" / "Only your side can see this"             |
| 5   | **A firewall on founder-private data.**                      | Information a founder keeps private is filtered out before Q or the ranking sees it for an investor. It never silently changes what an investor is shown or how a company ranks. Each side's private notes (for example a pass reason) stay private unless that side chooses to share.                         | Pass dialog: "stays private to your organisation unless you share it"; the profile's "Not shared with you" rows |

## What we do not claim

Do not say, write or imply any of the following:

- a speed-up as a measured result ("X% faster");
- "verified identities" in the KYC or AML sense (Capital Q's verification
  covers organisation and domain claims, not regulated identity checks);
- any percentage or amount of capital raised through Capital Q;
- that the platform is "fraud-proof".

## Illustration only: where time goes (not measured)

These figures are **assumptions for illustration**. They are not
measurements from Capital Q users. Use them only with this label.

| Task                                  | Typical today (illustrative)                    | With Capital Q (illustrative)                                             |
| ------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------- |
| Shortlist companies against a mandate | An afternoon of reading decks and inbound email | Minutes with a ranked feed that explains each match                       |
| Prepare five introductions            | About an hour of drafting individual notes      | A few minutes to review five prepared cards and approve the ones you want |
| Find where a relationship stands      | Searching email, CRM and messages               | One page with the stage and its full history                              |
| Rehearse a first investor call        | Booking a friend or mentor                      | A voice rehearsal with a scored review, whenever you want one             |
