# Evidence: apps/q-api/src/composition/work/page.ts (lines 607-752)

- Original path: `apps/q-api/src/composition/work/page.ts`
- Line range: 607-752 (HEAD 520bd123)
- Why included: readWorkSince: 'matches' = relationships that became CONNECTED since; no new-feed-company or mandate-match read.

```
  607  export type WorkPage = ReturnType<typeof createWorkPage>;
  608
  609  /** The kinds of step the lowdown names, by recorded action. */
  610  const STEP_KINDS = {
  611    "chat.message.send": "sent",
  612    "schedule.meeting.book": "booked",
  613    "relationship.interest.express": "interest",
  614  } as const;
  615
  616  /** How far back "since" may reach: a week, so the read stays bounded. */
  617  const SINCE_MAX_MS = 7 * DAY_MS;
  618
  619  function counted(
  620    rows: readonly { n: number; names: readonly (string | null)[] | null }[],
  621  ): QWorkActivityCount {
  622    const n = rows.reduce((sum, row) => sum + row.n, 0);
  623    const names = [
  624      ...new Set(
  625        rows.flatMap((row) =>
  626          (row.names ?? []).filter(
  627            (name): name is string => typeof name === "string" && name.length > 0,
  628          ),
  629        ),
  630      ),
  631    ]
  632      .slice(0, 3)
  633      .map((name) => name.slice(0, 200));
  634    return { n, names };
  635  }
  636
  637  /**
  638   * What happened on the person's own side since `since` (arrival briefing,
  639   * Zino 2026-10-08), read by code from recorded rows. Every predicate is
  640   * their own user id, or a relationship whose side they are an active
  641   * member of; the other sides' names are the ones their own Work and
  642   * relationships pages already show them.
  643   */
  644  export async function readWorkSince(
  645    sql: DatabaseExecutor,
  646    actor: ActorContext,
  647    sinceInput: Date,
  648    current: Date,
  649  ): Promise<QWorkSinceDto> {
  650    const floor = new Date(current.getTime() - SINCE_MAX_MS);
  651    const since = sinceInput < floor ? floor : sinceInput;
  652    const [steps, held, replies, matches, zone] = await Promise.all([
  653      sql<{ action: string; n: number; names: (string | null)[] | null }[]>`
  654        select s.action, count(*)::int as n,
  655               (array_agg(distinct
  656                  case
  657                    when r.id is null or i.organisation_id is null then null
  658                    when io.organisation_id = i.organisation_id
  659                      then (select coalesce(c.canonical_name, c.legal_name)
  660                              from core.companies c where c.id = r.company_id)
  661                    else io.display_name
  662                  end))[1:3] as names
  663          from q_runtime.instruction_steps s
  664          join q_runtime.standing_instructions i on i.id = s.instruction_id
  665          left join network.relationships r on r.id = s.relationship_id
  666          left join core.investor_organisations io
  667            on io.id = r.investor_organisation_id
  668         where s.user_id = ${actor.userId} and s.tenant_id = ${actor.tenantId}
  669           and s.status = 'DONE' and s.created_at > ${since}
  670         group by s.action`,
  671      sql<{ n: number; names: (string | null)[] | null }[]>`
  672        select count(*)::int as n,
  673               (array_agg(distinct d.counterpart_name))[1:3] as names
  674          from q_runtime.workforce_draft_outcomes o
  675          join q_runtime.workforce_drafts d on d.id = o.draft_id
  676         where o.user_id = ${actor.userId} and o.tenant_id = ${actor.tenantId}
  677           and o.outcome = 'HELD' and o.created_at > ${since}`,
  678      // Their counterparts' new messages: one per relationship, on a side
  679      // they are an active member of, never their own side's words.
  680      sql<{ n: number; names: (string | null)[] | null }[]>`
  681        select count(distinct r.id)::int as n,
  682               (array_agg(distinct
  683                  case when mine.side = 'COMPANY' then io.display_name
  684                       else coalesce(co.canonical_name, co.legal_name) end))[1:3] as names
  685          from communication.messages m
  686          join communication.conversations c on c.id = m.conversation_id
  687          join network.relationships r on r.id = c.relationship_id
  688          join core.companies co on co.id = r.company_id
  689          join core.investor_organisations io on io.id = r.investor_organisation_id
  690          join lateral (
  691            select case
  692                     when exists (select 1 from identity.organisation_memberships om
  693                                   where om.user_id = ${actor.userId}
  694                                     and om.organisation_id = co.organisation_id
  695                                     and om.membership_status = 'active')
  696                       then 'COMPANY'
  697                     when exists (select 1 from identity.organisation_memberships om
  698                                   where om.user_id = ${actor.userId}
  699                                     and om.organisation_id = io.organisation_id
  700                                     and om.membership_status = 'active')
  701                       then 'INVESTOR'
  702                   end as side
  703          ) mine on mine.side is not null
  704         where m.created_at > ${since}
  705           and m.kind in ('TEXT', 'ATTACHMENT', 'VOICE_NOTE')
  706           and m.sender_side <> mine.side
  707           and m.sender_user_id <> ${actor.userId}`,
  708      sql<{ n: number; names: (string | null)[] | null }[]>`
  709        select count(*)::int as n,
  710               (array_agg(distinct
  711                  case when exists (select 1 from identity.organisation_memberships om
  712                                     where om.user_id = ${actor.userId}
  713                                       and om.organisation_id = co.organisation_id
  714                                       and om.membership_status = 'active')
  715                       then io.display_name
  716                       else coalesce(co.canonical_name, co.legal_name) end))[1:3] as names
  717          from network.relationships r
  718          join core.companies co on co.id = r.company_id
  719          join core.investor_organisations io on io.id = r.investor_organisation_id
  720         where r.current_state = 'CONNECTED' and r.state_updated_at > ${since}
  721           and exists (select 1 from identity.organisation_memberships om
  722                        where om.user_id = ${actor.userId}
  723                          and om.organisation_id in (co.organisation_id, io.organisation_id)
  724                          and om.membership_status = 'active')`,
  725      sql<{ zone: string | null }[]>`
  726        select coalesce(
  727                 (select nullif(btrim(p.timezone), '')
  728                    from identity.user_profiles p where p.id = ${actor.userId}),
  729                 (select g.grant_payload->'workingHours'->>'timeZone'
  730                    from q_runtime.standing_instructions i
  731                    join q_runtime.instruction_grants g on g.instruction_id = i.id
  732                   where i.user_id = ${actor.userId} and i.tenant_id = ${actor.tenantId}
  733                   order by g.created_at desc
  734                   limit 1)) as zone`.catch(() => [{ zone: null }]),
  735    ]);
  736    const byKind = (kind: (typeof STEP_KINDS)[keyof typeof STEP_KINDS]) =>
  737      counted(
  738        steps.filter(
  739          (row) => STEP_KINDS[row.action as keyof typeof STEP_KINDS] === kind,
  740        ),
  741      );
  742    const timeZone = zone[0]?.zone ?? null;
  743    return {
  744      since: since.toISOString(),
  745      sent: byKind("sent"),
  746      booked: byKind("booked"),
  747      interest: byKind("interest"),
  748      held: counted(held),
  749      replies: counted(replies),
  750      matches: counted(matches),
  751      timeZone:
  752        timeZone !== null &&
```

# Evidence: apps/q-api/src/composition/work/page.ts (lines 205-241)

- Original path: `apps/q-api/src/composition/work/page.ts`
- Line range: 205-241 (HEAD 520bd123)
- Why included: NEW_MATCHES Work suggestion ('Founders fit your mandate / Prepare intros?') lives on Work only.

```
  205
  206    if (!facts.outreachRunning && facts.feedUncontacted > 0) {
  207      out.push({
  208        key: "new_matches:feed",
  209        kind: "NEW_MATCHES",
  210        lead: facts.feedUncontacted,
  211        unit: "match",
  212        subject: `${plural(facts.feedUncontacted, "Founder", "Founders")} fit your mandate`,
  213        question: "Prepare intros?",
  214        prompt: `Find up to ${String(Math.min(3, facts.feedUncontacted))} founders in my Discover feed who fit my mandate, and prepare intros to them for me to approve.`,
  215        linkPath: "/discover",
  216        age: 0,
  217      });
  218    }
  219
  220    const saved = facts.savedNoInterest.filter(
  221      (entry) => !facts.busy.has(entry.companyId),
  222    );
  223    if (!facts.outreachRunning && saved.length > 0) {
  224      out.push({
  225        key: "saved_no_interest:saved",
  226        kind: "SAVED_NO_INTEREST",
  227        lead: saved.length,
  228        unit: "saved",
  229        subject: "Saved, no interest sent",
  230        question: "Express interest?",
  231        prompt: `I saved ${saved
  232          .slice(0, 5)
  233          .map((entry) => entry.name)
  234          .join(
  235            ", ",
  236          )} but haven't contacted them. Prepare expressing interest in them for me to approve.`.slice(
  237          0,
  238          400,
  239        ),
  240        linkPath: "/discover/saved",
  241        age: 0,
```
