# Account deletion: spec draft for owner decision

**Status: DRAFT. Not approved. Do not build.** Prepared by the onboarding worker, 24 Oct 2026, at the coordinator's request. Authority: the locked PADL, Decision #151 (Contextual Deletion, Purpose-Based Retention and Portable User-Owned Data). This draft applies that decision. Where it has to choose something #151 leaves open, it marks an **owner decision**.

## Why now

- **No flow exists.** Capital Q has no account-deletion flow: nothing in Settings, no API route. The Q Pitch FAQ said "you can … close your account". That line has been corrected (`packages/q-pitch/src/qa-bank-product.ts`, `docs/specs/q-pitch/story/INVESTOR-QA.md`).
- **The QA loop needs it.** The owner asked QA to delete accounts and sign up again with the same email. Without a proper flow, the only way is the Supabase admin API. That removes the login but orphans the person's organisation, membership, company or investor organisation, documents and onboarding sessions.
- **Duplicates pile up.** Production holds many same-name firms and companies from re-created test accounts: for example 14 "Zino Aviation" and 8 "Corvo Ventures".

## What #151 already decides (locked)

- **Distinct actions.** Delete, Revoke, Forget, Archive, Anonymise, Close Account and Close Organisation are different actions, and the product must not merge them.
- **Ownership decides.** Deletion rights follow legitimate ownership and context, not just who uploaded something.
- **Organisations outlive members.** Organisation information stays with the organisation when a member leaves. Closing an organisation is separate from deleting an individual account.
- **No one-sided erasure.** One party cannot erase another party's legitimate relationship history.
- **Personal-private information can be forgotten.** Q supports targeted forgetting.
- **Revocation has limits.** Revoking access cannot retrieve copies already downloaded.
- **Deleting evidence starts a dependency review.** Unsupported conclusions must not stay labelled as evidence-backed.
- **Some records must stay.** Retention is purpose-based: legal, fraud, security and dispute needs can require it.
- **Exports respect confidentiality.** User-owned information is exportable, without revealing another party's confidential information.
- **Deletion propagates** through the active Capital Q systems.

## Proposed behaviour

### 1. Close Account (one person)

- **Their login:** disabled immediately, then deleted, after the grace period in Owner decision B.
- **Their personal-private information:** forgotten. This covers personal-scope Q memory, personal notes, communication preferences and voice settings. Q's memory of them is removed under the existing targeted-forget path.
- **Their profile (`identity.user_profiles`):** anonymised, for example "Former member", not deleted. Audit rows and other parties' records still point to it, and audit must keep referring to _a_ person without naming them (Owner decision C).
- **Their memberships:**
  - **Shared organisation** (other active members): only their membership ends. Everything the organisation holds stays with it.
  - **Sole-owner organisation:** Close Account also offers **Close Organisation** (section 2). It is never automatic, because of Owner decision A.
- **Their onboarding sessions and held writes:** deleted. These are journey state, not canonical records.
- **Relationship history with other parties:** kept as the other party's legitimate record. Their side is anonymised.
- **Audit:** kept, under the retention period (Owner decision C).

### 2. Close Organisation (an owner, for the whole organisation)

- **Who may do it:** only an owner, and only once nobody else needs the organisation, which in practice means its sole member. An owner of a shared organisation must first transfer ownership or remove the other members. That flow already exists through ownership offers.
- **Company or investor organisation:** archived and removed from discovery at once. That means marketplace visibility goes private and it is dropped from slates. After that it is either anonymised or deleted, depending on whether other parties hold relationship history with it (Owner decision D).
- **Documents and data room:** archived, then deleted with their storage objects after the grace period. Any shares are revoked first. Evidence that a share happened stays as the recipient's record.
- **Derived intelligence** (assessments, readiness, briefs) built on deleted evidence: this goes through the dependency review #151 requires. It is marked historical, or removed where nothing else supports it.
- **Organisation, tenant and memberships:** closed, not hard-deleted. That keeps audit and the outbox consistent.

### 3. What never happens

- Nothing is erased that another party legitimately holds: a relationship, a message they received, or evidence that something was shared with them.
- No admin script deletes an auth user without running the steps above.

## Owner decisions needed

- **A. Sole-owner organisation on Close Account.**
  - (1) Offer Close Organisation alongside. _Proposed._
  - (2) Close it automatically.
  - (3) Leave it orphaned. Not recommended: this is how duplicates pile up.
- **B. Grace period before hard deletion** (login, documents, storage).
  - Proposed: 30 days, with the account recoverable by signing in. Option: 0 days, immediate.
- **C. Audit retention and anonymisation.**
  - Proposed: audit rows are kept for the legal retention period, with the actor's name anonymised once the account is closed.
  - Needed from the owner: the retention period itself.
- **D. A company or firm others hold history with.**
  - Proposed: anonymise the profile ("A company that has left Capital Q") and keep the relationship rows.
  - Alternative: delete the profile and keep only the other party's own notes.
- **E. Export before closing.**
  - Proposed: offer the person an export of their own information (#151: "Appropriate user-owned information should be exportable") before Close Account confirms.
- **F. Same-email re-sign-up after closing.**
  - Proposed: allowed once the login is deleted, which happens after the grace period. A brand-new account never inherits the closed one's data.

## Build outline (after approval)

**Contracts and interfaces**

- An authenticated, idempotent `POST /v1/me/close-account`. It takes an idempotency key, confirms by re-entering the email, and returns a closure receipt.
- `POST /v1/organisations/:id/close`, for owners.

**Data**

- One migration: a closure-state column on profiles and organisations, plus a `closure_requests` table that drives the grace period.
- RLS stays as it is. A closed account cannot act.
- pgTAP tests for the closure states and for cross-tenant isolation.

**Execution**

- A worker job executes the closure after the grace period, and is idempotent per step.
- A domain event, `identity.account.closed`, lets each context clean up its own data through its own service. No context reaches into another context's tables.

**Product surfaces**

- Settings → Account → "Close my account".
- Copy states plainly what is forgotten and what stays.

**Tests**

- Positive path.
- Negative: another party's relationship history survives closure.
- Revoked shares stay revoked.
- A sole-owner company disappears from investor feeds immediately.

## Until then

The onboarding QA loop uses a fresh `*@fictional.capitalq.local` account for every iteration. The owner's two QA accounts are used only to verify their existing state. Nothing is admin-deleted.
