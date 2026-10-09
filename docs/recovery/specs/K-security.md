# K Part 11: security of persistent prepared context

Owner: workstream F. Reviews: B (Tier A snapshots, single-flight, prompt-cache ordering), D (Tier B projections), V (GPT-Live context packages), C (entity prefetch).

Founder rule (CLAUDE.md): **founder-private information must never silently alter investor-facing output.** Prepared context makes this easier to break, because something computed for one person is kept and served again.

## 1. Threats

| #   | Threat                                                                                            | Example                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| T1  | Cross-actor read: an entry warmed for A is served to B                                            | A cache keyed by `companyId` serves the founder's snapshot (with runway) to an investor viewing that company |
| T2  | Stale authority: an entry outlives the permission it was built under                              | A grant is revoked, but the Tier A snapshot still holds the data-room summary                                |
| T3  | Scope bleed: an entry built for one organisation is served after an org switch                    | A person in two firms switches, and Q answers from the first firm's mandate                                  |
| T4  | Subject change: the founder narrows visibility, but investor-facing projections keep the old view | A company is hidden (`founder_private`), yet its projection still ranks it                                   |
| T5  | Race: a revocation lands while a load is in flight, and the old view is stored after it           | Single-flight warm-up finishes after the logout                                                              |
| T6  | Prompt injection through cached or prefetched text placed in the instruction segment              | A web excerpt in a cached package is concatenated into `instructions`                                        |
| T7  | Projection leak: founder-private columns or rows in a Tier B table read for investors             | `runway_months` in a company knowledge projection                                                            |
| T8  | Live push leak: `thinking.append` sends context the current asker may not see                     | A Live session survives an org switch and keeps receiving the old organisation's updates                     |

## 2. Cache-key rule (binding for every cache of Q context)

Every cached or prepared context entry is stored and read under `contextCacheKey(scope)` (`@capital-q/security/context-cache`). The key covers:

| Field                                               | Source                                                                            | Guards |
| --------------------------------------------------- | --------------------------------------------------------------------------------- | ------ |
| `tenantId`, `userId`, `actorType`                   | server-resolved `ActorContext`, never the client                                  | T1     |
| `organisationId` + `membershipId` (both or neither) | the active context                                                                | T3     |
| `authzEpoch`                                        | `private.actor_authz_epoch(user, tenant, membership)`, read **fresh per request** | T2     |
| `kind`                                              | `tierA.snapshot`, `tierB.companyKnowledge`, `live.package`, …                     | T1     |
| `sensitivity`                                       | the strongest class the entry may hold (the firewall plan's `maxSensitivity`)     | T1     |
| `subject` + `accessEpoch`                           | `private.subject_access_epoch(company, viewer org)`, or the projection version    | T4     |
| `policyVersion`                                     | the Context Firewall policy version that admitted it                              | T2     |

- **Encoding.** The key is a JSON array in fixed field order, hashed with SHA-256 (`ctx:v1:<kind>:<hex>`).
  - The encoding is injective, so two different scopes cannot share a key (tested).
  - No actor id appears in clear.
- **Hard rules.**
  - There is no lookup by subject or id alone. `assertContextCacheScope` throws on a missing epoch, or on an organisation without its membership.
  - Content enters an entry only after the Context Firewall has planned the request for that actor. The cache holds the output of authorised retrieval, never raw rows. That is how classification is enforced at write.
  - A cache entry is never authority. Consequential actions follow Prepare → Approve → Execute and re-authorize at execution (`q-actions` execution-time reauthorization). Approval binds to the exact payload, whatever any cache says.

## 3. Invalidation (immediate)

| Event                                                                        | What makes the old entry unreachable                                                                              | Explicit purge                                                         |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Grant revoked or expired; role changed or expired                            | `authzEpoch` changes (expiry is evaluated against `now()`, so no write is needed)                                 | `invalidateActor(userId)`                                              |
| Membership left, suspended or revoked                                        | `authzEpoch` changes                                                                                              | `invalidateActor`, `invalidateOrganisation`                            |
| Org switch                                                                   | `organisationId`/`membershipId` are in the key                                                                    | none needed (the old org's entries are simply not selected)            |
| Logout                                                                       | No new authenticated request reaches the old key. A different person on the same device has a different `userId`. | the web logout calls `invalidateActor` (B: add the route)              |
| Company visibility, data-room setting, disclosure policy, relationship state | `subject_access_epoch` changes                                                                                    | `invalidateSubject("COMPANY", id)` from the matching domain events (D) |
| Tier B projection rebuilt                                                    | the projection version is the subject epoch                                                                       | the version bump                                                       |

- Epochs are **read fresh on every request**: one indexed query each, never cached across requests.
- `createContextCache` single-flight never stores a load that was in flight when its actor, tenant, organisation or subject was invalidated (T5, tested). A TTL (default 5 minutes) and a size bound cap how long anything lives.

## 4. Contracts for each workstream (review checklist)

- **B, Tier A snapshot and single-flight.**
  - Use `createContextCache` or the same key.
  - Read both epochs in the request.
  - Store only firewall-planned output.
  - Plug the snapshot into `checkContextIsolation` (Test 6).
- **D, Tier B projections.**
  - Build only from investor-visible sources: `network_visible`, `public_external`, or `relationship_shared` / `specifically_shared` with the recipient in the key.
  - No founder-private financial columns.
  - Put `[K Tier B]` in every projection table's comment so pgTAP 905 checks it.
  - Bump the projection version from visibility, disclosure and claim events.
  - Reads still pass through the firewall for the asker.
- **V, GPT-Live context package.**
  - The package and every `thinking.append` update are built per request under the current scope key.
  - When the actor's epoch or organisation changes mid-session, the session stops receiving updates and re-plans.
  - Plug it into Test 6.
- **C, entity prefetch on navigation.** Prefetch only what the route's own authorisation already returned to the page, keyed the same way.

## 5. Test 6 (as code)

- `packages/security/src/context-cache/isolation.ts` exports `checkContextIsolation(layer, scenario)`. It:
  - warms founder-private context as the authorised founder;
  - reads it as an investor without access, before and after the investor's own warm-up;
  - revokes the founder's access;
  - returns violations.
- `packages/security/test/context-cache.test.ts` runs it against the scoped cache and passes. It also runs it against a cache keyed by subject alone, which fails with both expected violations, so the check has teeth.
- **To do as each layer lands** (each owner adds one `checkContextIsolation` call):
  - B's Tier A snapshot;
  - D's projection reader and search index;
  - V's Live package and update stream;
  - Q memory retrieval.
- **pgTAP:**
  - `904_k_context_epochs`: each access change moves the fingerprint, and nothing else does (16 assertions).
  - `905_k_projections_no_founder_private`: every `[K Tier B]` table is free of founder-private columns and rows; a planted projection proves the detector works.

## 6. Instruction segments and prompt caching (T6)

- Only the **leading** SYSTEM messages are privileged. This is enforced in all three adapters (OpenAI `instructions`, Google `systemInstruction`, Groq system role). Any later SYSTEM message travels as a marked user note (`packages/model-gateway/test/instruction-segment.test.ts`).
- **B's prompt-cache ordering.** The cacheable prefix is trusted, static instructions only. Nothing fetched, uploaded, transcribed or retrieved goes into it: no documents, web pages, chat, tool output or cached context packages. Untrusted text goes after it, fenced as data (spotlighting). The test also checks that the trusted prefix is byte-identical across turns, which is what makes it cacheable without mixing anything into it.
- A cached context package is data even though Capital Q produced it, because it summarises untrusted sources.

## 7. Files (F)

- `supabase/migrations/20261220193000_context_cache_epochs.sql`
- `packages/security/src/context-cache/{key,cache,isolation,index}.ts`
- `packages/security/src/postgres/context-epochs.ts`
- `packages/security/package.json` (the `./context-cache` export)
- `packages/model-gateway/src/providers/groq.ts`
- tests as listed above

## 8. Open items

- The B and D branches had no K commits when this was written, so their designs are still to be reviewed against §4.
- The web logout route calling `invalidateActor`: B or C.
- The pgTAP numbers 904 and 905 are outside F's 895–897 band; the lead should confirm them.
