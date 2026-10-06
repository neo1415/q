/* global console */
// Read-only: one line per seeded company with what production holds now.
import * as lib from "./lib.mjs";

const st = lib.loadState();
const rows = [];
for (const c of lib.companies()) {
  const s = st.companies[String(c.n).padStart(2, "0")];
  if (!s?.companyId) {
    rows.push(`${c.n} ${c.company}: not started`);
    continue;
  }
  const id = s.companyId;
  const [r] = await lib.sql(`
    select c.marketplace_visibility v, c.marketplace_readiness_state r,
      (select count(*) from evidence.documents d where d.company_id=c.id) docs,
      (select count(*) from evidence.data_room_entries e where e.company_id=c.id) filed,
      (select count(*) from identity.organisation_memberships m where m.organisation_id=c.organisation_id and m.membership_status='active') members,
      (select count(*) from evidence.verification_claims v where v.organisation_id=c.organisation_id and v.status='VERIFIED') verified
    from core.companies c where c.id='${id}'`);
  const t = await lib.accessToken(lib.emailFor(c.founderPerson.name, c.company));
  const p = (await lib.call(lib.API, t, "GET", `/v1/companies/${id}/pitch`)).body?.pitch;
  rows.push(
    `${c.n} ${c.company}: ${r.v}/${r.r} docs=${r.docs} filed=${r.filed} members=${r.members} verified=${r.verified} pitch=${p ? `${p.status}/${p.audience}/dl=${p.downloadable}` : "none"} steps=${Object.keys(s.done ?? {}).join(",")}`,
  );
}
console.log(rows.join("\n"));
