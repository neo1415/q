import { createRequire } from "node:module";

/**
 * Read-only access to the LOCAL database for authoritative-state
 * assertions. Loopback only: a hosted URL is refused, and every query runs
 * in a read-only transaction.
 */
const DATABASE_URL =
  process.env["CQ_ACCEPT_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

if (!/@(127\.0\.0\.1|localhost):/.test(DATABASE_URL)) {
  throw new Error("acceptance-product reads only a loopback database");
}

// The driver is a dependency of @capital-q/database, not of the root
// package; resolving it from there avoids a root dependency change. Only
// the two calls used here are typed.
type Tx = { unsafe: (text: string, params: unknown[]) => Promise<unknown[]> };
type Sql = {
  begin: <T>(mode: string, run: (tx: Tx) => Promise<T>) => Promise<T>;
  end: (options: { timeout: number }) => Promise<void>;
};
const postgres = createRequire(
  new URL("../../../packages/database/package.json", import.meta.url),
)("postgres") as (url: string, options: { max: number }) => Sql;

// Opened lazily: spec files share this module inside one worker, and each
// closes the pool in its afterAll, so the next file must be able to reopen.
let sql: Sql | null = null;

export async function read<T extends Record<string, unknown>>(
  text: string,
  params: readonly (string | number | null)[] = [],
): Promise<T[]> {
  sql ??= postgres(DATABASE_URL, { max: 2 });
  return sql.begin("read only", async (tx) => {
    const rows = await tx.unsafe(text, [...params]);
    return rows as T[];
  });
}

export async function closeDb(): Promise<void> {
  const open = sql;
  sql = null;
  await open?.end({ timeout: 5 });
}

/** The newest onboarding session of the person signed up with `email`. */
export async function onboardingSessionFor(
  email: string,
): Promise<{ id: string; current_step_key: string | null; status: string }> {
  const rows = await read<{
    id: string;
    current_step_key: string | null;
    status: string;
  }>(
    `select s.id, s.current_step_key, s.status
       from onboarding.sessions s
       join identity.user_profiles p on p.id = s.user_id
       join auth.users u on u.id = p.auth_user_id
      where u.email = $1
      order by s.started_at desc limit 1`,
    [email],
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`no onboarding session for ${email}`);
  return row;
}

/** Q's and the person's persisted interview turns, oldest first. */
export async function interviewTurns(
  sessionId: string,
): Promise<{ role: string; text: string; step_key: string | null }[]> {
  return read(
    `select role, text, step_key from onboarding.interview_turns
      where session_id = $1 order by created_at`,
    [sessionId],
  );
}

/**
 * The step Q's latest persisted turn was asked on. This is what Q is
 * actually asking; the session view's current step can differ from it.
 */
export async function lastQStep(sessionId: string): Promise<string | null> {
  const rows = await read<{ step_key: string | null }>(
    `select step_key from onboarding.interview_turns
      where session_id = $1 and role = 'Q' and step_key is not null
      order by created_at desc limit 1`,
    [sessionId],
  );
  return rows[0]?.step_key ?? null;
}

/**
 * Steps neither completed nor skipped, in the definition's order. This is
 * recorded state, so it stays meaningful when Q (not a cursor) chooses what
 * to ask next.
 */
export async function unfinishedSteps(sessionId: string): Promise<string[]> {
  return (await openSteps(sessionId)).map((s) => s.step);
}

/** As `unfinishedSteps`, with whether the definition requires each one. */
export async function openSteps(
  sessionId: string,
): Promise<{ step: string; required: boolean }[]> {
  const rows = await read<{ step_key: string; required: boolean }>(
    `select st.step_key, st.required
       from onboarding.sessions s
       join onboarding.steps st on st.definition_version_id = s.definition_version_id
       left join onboarding.step_states ss
              on ss.session_id = s.id and ss.step_key = st.step_key
      where s.id = $1
        and coalesce(ss.status, 'NOT_STARTED') not in ('COMPLETED', 'SKIPPED')
      order by st.sequence_order`,
    [sessionId],
  );
  return rows.map((r) => ({ step: r.step_key, required: r.required }));
}

/** Current (non-superseded) responses by step key. */
export async function responses(
  sessionId: string,
): Promise<Map<string, unknown>> {
  const rows = await read<{ step_key: string; response_jsonb: unknown }>(
    `select step_key, response_jsonb from onboarding.responses
      where session_id = $1 and superseded_by_response_id is null`,
    [sessionId],
  );
  return new Map(rows.map((r) => [r.step_key, r.response_jsonb]));
}

/**
 * Current answers by step key, normalised to comparable strings: option
 * keys, taxonomy canonical codes (node ids resolved), amounts, text, or
 * "confirmed". The step engine stores each shape differently; a property
 * cares only about WHAT was recorded.
 */
export async function answers(
  sessionId: string,
): Promise<Map<string, string[]>> {
  const raw = await responses(sessionId);
  const nodeIds = [...raw.values()].flatMap((r) => {
    const v = r as { resourceType?: string; resourceIds?: string[] };
    return v.resourceType === "TAXONOMY_NODE" ? (v.resourceIds ?? []) : [];
  });
  const codes = new Map<string, string>();
  if (nodeIds.length > 0) {
    const rows = await read<{ id: string; canonical_code: string }>(
      `select id::text, canonical_code from taxonomy.nodes where id = any($1::uuid[])`,
      [`{${nodeIds.join(",")}}`],
    );
    for (const r of rows) codes.set(r.id, r.canonical_code);
  }
  const out = new Map<string, string[]>();
  for (const [step, value] of raw) {
    const v = value as {
      type?: string;
      optionKey?: string;
      optionKeys?: string[];
      text?: string;
      value?: string | number;
      resourceIds?: string[];
      resourceType?: string;
      confirmed?: boolean;
    };
    if (v.optionKey !== undefined) out.set(step, [v.optionKey]);
    else if (v.optionKeys !== undefined) out.set(step, [...v.optionKeys]);
    else if (v.resourceType === "TAXONOMY_NODE")
      out.set(
        step,
        (v.resourceIds ?? []).map((id) => codes.get(id) ?? id),
      );
    else if (v.value !== undefined) out.set(step, [String(v.value)]);
    else if (v.text !== undefined) out.set(step, [v.text]);
    else if (v.confirmed !== undefined)
      out.set(step, [v.confirmed ? "confirmed" : "declined"]);
    else out.set(step, [JSON.stringify(value)]);
  }
  return out;
}

/** The investor's mandate: declared hard exclusions, from both stores. */
export async function investorExclusions(email: string): Promise<{
  constraints: { dimension: string; values: string[] }[];
  taxonomy: string[];
}> {
  const constraints = await read<{ dimension: string; v: string[] | null }>(
    `select c.dimension, (c.value_jsonb->'values') v
       from core.investor_mandate_constraints c
       join core.investor_mandates m on m.id = c.mandate_id
       join core.investor_organisations o on o.id = m.investor_organisation_id
       join identity.organisation_memberships om on om.organisation_id = o.organisation_id
       join identity.user_profiles p on p.id = om.user_id
       join auth.users u on u.id = p.auth_user_id
      where u.email = $1 and c.is_hard_exclusion`,
    [email],
  );
  const taxonomy = await read<{ code: string }>(
    `select n.canonical_code code
       from taxonomy.mandate_preferences mp
       join taxonomy.nodes n on n.id = mp.node_id
       join core.investor_mandates m on m.id = mp.mandate_id
       join core.investor_organisations o on o.id = m.investor_organisation_id
       join identity.organisation_memberships om on om.organisation_id = o.organisation_id
       join identity.user_profiles p on p.id = om.user_id
       join auth.users u on u.id = p.auth_user_id
      where u.email = $1 and mp.is_exclusion`,
    [email],
  );
  return {
    constraints: constraints.map((c) => ({
      dimension: c.dimension,
      values: c.v ?? [],
    })),
    taxonomy: taxonomy.map((t) => t.code),
  };
}

export type MandateState = {
  readonly investorType: string | null;
  readonly status: string | null;
  readonly minCheque: number | null;
  readonly maxCheque: number | null;
  readonly currency: string | null;
  readonly minStage: string | null;
  readonly maxStage: string | null;
  /** Declared taxonomy preferences (not exclusions), canonical codes. */
  readonly preferences: string[];
  /** Hard exclusions from both stores, codes. */
  readonly exclusions: string[];
  /** Every constraint's values, by dimension (roles, attributes, flags...). */
  readonly constraints: Record<string, string[]>;
};

/** The investor's authoritative mandate, as the database holds it now. */
export async function mandateFor(email: string): Promise<MandateState> {
  const rows = await read<{
    investor_type: string | null;
    status: string | null;
    min_cheque: string | null;
    max_cheque: string | null;
    currency_code: string | null;
    min_stage_code: string | null;
    max_stage_code: string | null;
    mandate_id: string | null;
  }>(
    `select o.investor_type, m.status, m.min_cheque::text, m.max_cheque::text,
            m.currency_code, m.min_stage_code, m.max_stage_code, m.id mandate_id
       from core.investor_organisations o
       join identity.organisation_memberships om on om.organisation_id = o.organisation_id
       join identity.user_profiles p on p.id = om.user_id
       join auth.users u on u.id = p.auth_user_id
       left join core.investor_mandates m on m.investor_organisation_id = o.id
      where u.email = $1
      order by m.created_at desc nulls last limit 1`,
    [email],
  );
  const row = rows[0];
  const mandateId = row?.mandate_id ?? null;
  const prefs =
    mandateId === null
      ? []
      : await read<{ code: string; is_exclusion: boolean }>(
          `select n.canonical_code code, mp.is_exclusion
             from taxonomy.mandate_preferences mp
             join taxonomy.nodes n on n.id = mp.node_id
            where mp.mandate_id = $1`,
          [mandateId],
        );
  const cons =
    mandateId === null
      ? []
      : await read<{ dimension: string; v: string[] | null; hard: boolean }>(
          `select dimension, (case when jsonb_typeof(value_jsonb->'values') = 'array'
                                   then array(select jsonb_array_elements_text(value_jsonb->'values'))
                                   else array[]::text[] end) v,
                  is_hard_exclusion hard
             from core.investor_mandate_constraints where mandate_id = $1`,
          [mandateId],
        );
  const constraints: Record<string, string[]> = {};
  for (const c of cons) {
    constraints[c.dimension] = [
      ...(constraints[c.dimension] ?? []),
      ...(c.v ?? []),
    ];
  }
  const number = (v: string | null | undefined) =>
    v === null || v === undefined ? null : Number(v);
  return {
    investorType: row?.investor_type ?? null,
    status: row?.status ?? null,
    minCheque: number(row?.min_cheque),
    maxCheque: number(row?.max_cheque),
    currency: row?.currency_code ?? null,
    minStage: row?.min_stage_code ?? null,
    maxStage: row?.max_stage_code ?? null,
    preferences: prefs.filter((p) => !p.is_exclusion).map((p) => p.code),
    exclusions: [
      ...prefs.filter((p) => p.is_exclusion).map((p) => p.code),
      ...cons.filter((c) => c.hard).flatMap((c) => c.v ?? []),
    ],
    constraints,
  };
}

/** Q runs in the person's newest Home conversation, newest last. */
export async function runsFor(
  email: string,
  since: Date,
): Promise<
  {
    id: string;
    status: string;
    objective: string;
    conversation_id: string | null;
  }[]
> {
  return read(
    `select r.id, r.status, r.objective, r.conversation_id::text conversation_id
       from q_runtime.runs r
       join identity.user_profiles p on p.id = r.actor_user_id
       join auth.users u on u.id = p.auth_user_id
      where u.email = $1 and r.created_at >= $2
      order by r.created_at`,
    [email, since.toISOString()],
  );
}

/** Artifacts the person's organisation holds, newest first. */
export async function artifactsFor(
  email: string,
  since: Date,
): Promise<{ id: string; type: string; current_version: number }[]> {
  return read(
    `select a.id, a.type, a.current_version
       from artifacts.artifacts a
       join identity.organisation_memberships om on om.organisation_id = a.organisation_id
       join identity.user_profiles p on p.id = om.user_id
       join auth.users u on u.id = p.auth_user_id
      where u.email = $1 and a.created_at >= $2
      order by a.created_at desc`,
    [email, since.toISOString()],
  );
}
