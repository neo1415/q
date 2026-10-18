# ADR 0032: The Q Daily: scheduled news, shared public gatherings, cited stories

Status: Accepted (2026-10-01, DAILY worker)
Amends: ADR 0009 (controlled public web research), doc 12 (Q acts when
asked), doc 14 (evidence and provenance), doc 19 (personalisation inputs)

## Context

The founder asked for an agent that keeps reading the news for each person
and delivers a personal newspaper, weekly by default and daily on request,
by email and on the dashboard, without being asked (spec:
`docs/specs/2026-10/daily.md`). The existing decisions cover research a
person asks for in a conversation, not scheduled research for everyone, not
reuse of one gathering across people, and not public content from RSS feeds.

## Decision

- **Scheduled, unasked work is allowed for this one product, inside hard
  caps.** A worker loop prepares editions; per gathering at most 4 searches,
  2 extracts, 8 story writes and 3 photo searches; per person 3 searches,
  3 writes and 1 take; 3 editions per tick, 60 per day (an operator can
  lower it). A step past its cap is skipped, never retried. The platform
  kill switch `q.daily` (ADR 0033) is checked before generating and before
  emailing.
- **Shared public gatherings.** People whose PUBLIC interests (sector,
  stage and market labels) are the same share one gathering per day, keyed
  by a hash of those labels and the news window alone, in a server-only
  table with no person or tenant. Personal facts (own company, the names of
  CONNECTED relationships, the raise) never enter a gathering, its key or
  its searches; they are used only in that person's own section and Q's
  take, stored only on their own edition.
- **Sources.** The research providers (search with a news hint and
  freshness PAST_DAY/PAST_WEEK, extract) and a fixed list of publisher RSS
  feeds in code. Feeds are used as publishers offer them for syndication:
  headline, summary, link and the feed's own thumbnail, never the article.
- **Every claim cited; nothing invented, checked in code.** One model call
  per story (DAILY_STORY_WRITER, public text only). A quote is kept only if
  it is verbatim in the source; prose with any number not printed in the
  source falls back to the source's own headline and summary; deal amounts
  are converted to dollars only when printed in dollars. Stories are
  attributed to their publisher, never stated as verified fact.
- **Q's take** (DAILY_Q_TAKE) is the only opinion, always labelled Q
  inference, must cite stories in the edition, and is dropped if it prints
  a number the stories or the reader's own raise do not.
- **Pictures.** Pexels stock photos with credit; a publisher's feed
  thumbnail shown hotlinked and linked to the article only, never re-hosted
  or embedded in the PDF. Diagrams are drawn by code from the deals the
  sources printed.
- **Delivery and control.** Email (newspaper HTML through the app email
  sender), the reader at `/daily` with archive, and a PDF drawn by
  deck-render's layout over DOCS's boxes. Preferences are the person's own
  (Settings, and Q's `set_q_daily_preferences`, instant and reversible).
  The Q Daily is a navigation destination (TURN_READER v21).
- **Runtime.** The existing worker job pattern, not LangGraph (ADR 0030):
  an edition is a bounded, single-pass job with no waits or approvals; it
  may move onto the work engine later without changing these rules.

## Consequences

- Founder credits are spent on a schedule without a request; the caps, the
  shared gatherings and the kill switch bound that spend.
- What a person reads in The Q Daily never feeds ranking: `@capital-q/q-daily`
  is a forbidden import for Discovery (test-enforced).
- Context Firewall: a shared gathering cannot leak one person's private
  facts to another, because none are put into it.
