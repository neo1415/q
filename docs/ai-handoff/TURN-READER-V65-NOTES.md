# TURN_READER v65 — notes

Owner: the TURN_READER lane. v64 is live. **v65 is built** on branch `fix/reader-v65`; it is not deployed yet.

Coordinator rule (24 Oct 2026): the reading decides by meaning. Code's word lists only say when to wait for the reading; they never decide.

## 1. A choice between named companies is `compare`

- **Bug:** run beb74547, "Which is better, Anchor or Afyascan?", got no `compare`.
- **Rule:** `V65_CHOICE_IS_COMPARE`. A fit question or a which-to-choose question also sets `compare`; it never replaces it.
- **Stop-gap:** lane 8's #460 phrase fallback.

| Said                                 | Expected                            |
| ------------------------------------ | ----------------------------------- |
| Which is better, Anchor or Afyascan? | compare {names: [Anchor, Afyascan]} |
| Which fits me more, Mizan or Duplo?  | compare {names: [Mizan, Duplo]}     |
| Would you pick Ledgerfold or Silo?   | compare {names: [Ledgerfold, Silo]} |
| lequel est le meilleur, A ou B ?     | compare {names: [A, B]}             |
| أيهما أفضل، A أم B؟                  | compare {names: [A, B]}             |

## 2. What a reply answers: `replyTo`

`replyTo` is one of three kinds:

- **Q_QUESTION:** the reply continues Q's last question or invitation.
- **WAITING_CARD:** the reply decides a waiting card. `card` holds that card's name, or is null when the reply covers all of them or doesn't say which.
- **NEW:** the turn is a request or question of its own.

Code uses it in three places:

- `pending-decision` decides a card only when the reading says WAITING_CARD. With no reading, the word hint `aboutWaitingCards` decides instead.
- A Q_QUESTION reply opens nothing unless the words ask to go somewhere. This covers both the reader's NAVIGATE tool and REFERENCE open.
- The pre-reading shortcuts still use `continuesQsQuestion` as a hint. When Q's last line asked or invited, they hand the turn to the reading.

| Q's last line                                    | Said                            | Expected                                      |
| ------------------------------------------------ | ------------------------------- | --------------------------------------------- |
| Want me to find three investors for Halyard?     | Yes. No, not Halyard. Capital Q | Q_QUESTION (subject Capital Q), opens nothing |
| …Tell me which to look into further.             | the second one                  | Q_QUESTION                                    |
| Update your mandate. Not saved yet: tap Approve… | yes                             | WAITING_CARD, card "Update your mandate"      |
| (8 cards waiting) Want me to compare them?       | yes                             | Q_QUESTION, never WAITING_CARD                |
| anything                                         | Take me to my pipeline          | NEW                                           |

## 3. Whom a discovery is about: `discoverWhom`

- **INVESTORS:** they ask for investors, funds, VCs, angels or backers.
- **COMPANIES:** they ask for companies or startups.
- `discoverWhom: INVESTORS` never starts a company search.
- The fast lane's word hint (investors words with no companies words) only makes it wait for the full reading.

| Said                                 | Expected  |
| ------------------------------------ | --------- |
| Just find me three Qatari investors. | INVESTORS |
| Who could back us?                   | INVESTORS |
| ابحث لي عن ثلاثة مستثمرين قطريين     | INVESTORS |
| Three fintech companies in Ghana     | COMPANIES |
| Fintech funds in Lagos               | INVESTORS |
