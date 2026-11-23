// Resolves a seeded fictional account email from the hosted DB (read-only; needs SUPABASE_ACCESS_TOKEN, proxy-injected in the cloud).
// Resolves a seeded fictional account's email in memory only (never logged).
const REF = "vcohxiqsmnkzxnvawgri";
export async function sql(query) {
  if (!/^\s*select\b/i.test(query)) throw new Error("select only");
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${REF}/database/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, read_only: true }),
    },
  );
  if (!r.ok) throw new Error(`sql ${r.status}`);
  return r.json();
}
const MARKED = `u.raw_app_meta_data->>'fictional_demo' = 'true' and u.raw_app_meta_data->>'synthetic' = 'true'`;
export const IDS = {
  thames: "cfbc217a-5ba2-407f-a684-084a96d892f7",
  savanna: "1c4b9266-350c-409d-9582-04a0f771b8a8",
  halyard: "1ab2cc02-160f-4812-a6b1-8be7e43afd3e",
};
export async function emailFor(who) {
  let rows;
  if (who === "thames" || who === "savanna") {
    rows =
      await sql(`select u.id as auth_id, u.email, (${MARKED}) as marked from core.investor_representatives r
      join identity.user_profiles p on p.id = r.user_id join auth.users u on u.id = p.auth_user_id
      where r.investor_organisation_id = '${IDS[who]}' and r.is_current order by (u.email like 'investor.%') desc, r.started_at nulls last, p.id`);
  } else if (who === "halyard") {
    rows =
      await sql(`select u.id as auth_id, u.email, (${MARKED}) as marked from core.company_members m
      join identity.user_profiles p on p.id = m.user_id join auth.users u on u.id = p.auth_user_id
      where m.company_id = '${IDS.halyard}' and m.is_founder and m.is_current
      order by exists (select 1 from onboarding.sessions s where s.user_id = p.id and s.subject_id = m.company_id) desc, m.started_at nulls last, p.id`);
  } else throw new Error("unknown who");
  if (!rows.length || !rows[0].marked)
    throw new Error("not a seeded fictional account");
  return { email: rows[0].email, authId: rows[0].auth_id };
}
