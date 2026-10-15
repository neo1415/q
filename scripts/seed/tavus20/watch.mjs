// Read-only watch of Zino's agents on the accepted relationships: chat
// messages, Q actions (and their approvals) and instruction steps since a
// time. Message bodies are fictional seed conversation, printed trimmed.
//   node watch.mjs [sinceISO]
import * as lib from "./lib.mjs";

const since =
  process.argv[2] ?? new Date(Date.now() - 3 * 3600e3).toISOString();
const RELS = {
  Ledgerline: "aaa1a9ff-4779-4393-a76a-88f1ff6d270f",
  "Clearwater Assurance": "b3c33fa0-183b-4a97-8b02-646c962d7fc5",
  Tensorgate: "ea7388fd-e6ec-40ff-99b1-55c00a8d945d",
  Shiftwell: "dc00b2f2-df32-4454-b3b1-3a30775bf945",
};
const ids = Object.values(RELS)
  .map((x) => `'${x}'`)
  .join(",");
const nameOf = Object.fromEntries(Object.entries(RELS).map(([k, v]) => [v, k]));

const msgs = await lib.sql(`
  select v.relationship_id rel, m.created_at, m.sender_side, m.kind, m.q_action_id is not null via_q,
         m.q_delegation_id is not null delegated, left(regexp_replace(m.body, '\\s+', ' ', 'g'), 220) body
    from communication.messages m join communication.conversations v on v.id = m.conversation_id
   where v.relationship_id in (${ids}) and m.created_at > '${since}' order by m.created_at`);
console.log("== messages");
for (const m of msgs)
  console.log(
    `${m.created_at.slice(11, 19)} ${nameOf[m.rel]} ${m.sender_side}${m.via_q ? "/Q" : ""}${m.delegated ? "/deleg" : ""} ${m.kind}: ${m.body}`,
  );

const steps = await lib.sql(`
  select s.created_at, s.relationship_id rel, s.action, s.mode, s.status, s.reason_code, left(s.words, 160) words
    from q_runtime.instruction_steps s where s.relationship_id in (${ids}) and s.created_at > '${since}' order by s.created_at`);
console.log("== instruction steps");
for (const s of steps)
  console.log(
    `${s.created_at.slice(11, 19)} ${nameOf[s.rel]} ${s.action} ${s.mode} ${s.status} ${s.reason_code ?? ""} ${s.words ?? ""}`,
  );

const acts = await lib.sql(`
  select a.created_at, a.action_type, a.status, a.failure_code, a.execution_attempts, left(a.summary, 140) summary,
         (select string_agg(p.status, ',') from q_runtime.approvals p where p.action_id = a.id) approvals,
         a.target_refs::text refs
    from q_runtime.actions a
   where a.created_at > '${since}' and (${Object.values(RELS)
     .map(
       (r) =>
         `a.target_refs::text like '%${r}%' or a.proposed_payload::text like '%${r}%'`,
     )
     .join(" or ")})
   order by a.created_at`);
console.log("== q actions");
for (const a of acts) {
  const rel = Object.values(RELS).find((r) => a.refs.includes(r));
  console.log(
    `${a.created_at.slice(11, 19)} ${nameOf[rel] ?? "?"} ${a.action_type} ${a.status} ${a.failure_code ?? ""} tries=${a.execution_attempts} approvals=${a.approvals ?? "-"} | ${a.summary}`,
  );
}
