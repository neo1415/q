/* global console, process */
// Read-only view of Zino Aviation's relationships with the seeded companies:
// state, the event trail, and the conversation messages (latest first).
//   node zino.mjs            summary of every seeded company with a relationship
//   node zino.mjs Ledgerline the event trail and messages for one company
import * as lib from "./lib.mjs";

const names = lib
  .companies()
  .map((c) => `'${c.company.replace(/'/g, "''")}'`)
  .join(",");
const one = process.argv[2];
const rows = await lib.sql(`
  select c.canonical_name company, r.id rel, r.current_state state, r.state_updated_at,
         (select string_agg(e.event_type || '@' || to_char(e.occurred_at,'HH24:MI') || ':' || e.actor_type, ' > ' order by e.sequence)
            from network.relationship_events e where e.relationship_id = r.id) events
    from network.relationships r
    join core.companies c on c.id = r.company_id
    join core.investor_organisations io on io.id = r.investor_organisation_id
    join identity.organisations o on o.id = io.organisation_id
   where o.display_name = 'Zino Aviation' and c.canonical_name in (${names})
     ${one ? `and c.canonical_name = '${one.replace(/'/g, "''")}'` : ""}
   order by r.state_updated_at desc`);
for (const r of rows)
  console.log(`${r.company} [${r.state}] ${r.rel}\n  ${r.events}`);
