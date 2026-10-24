// One-off (coordinator 2026-10-24, F-73 follow-up): board items saved
// before saved work was titled by kind and subject still read
// "Q's answer: <the raw ask>". On the FICTIONAL demo accounts only, each
// one is renamed to its kind and subject where both can be read from the
// ask, and archived otherwise.
//
//   NODE_USE_ENV_PROXY=1 SUPABASE_ACCESS_TOKEN=... \
//     node scripts/handoff/live/board-legacy-titles.mjs [--apply]
//
// Dry run by default: prints every item it would rename or archive, with
// counts, and changes nothing. --apply makes every change in ONE
// transaction through the Management API SQL endpoint, so a failure
// changes nothing.
//
// Safety:
// - Only items whose owner's sign-in email ends in @fictional.capitalq.local,
//   only live items (archived_at is null), only titles that start with
//   "Q's answer:". Nothing else is read or written.
// - The board's own rules hold: each change is exactly the next revision,
//   with its row in workspace.board_item_events (EDITED or ARCHIVED, actor
//   Q), so the item's history keeps the old title. Nothing is deleted.
// - The person's documents are untouched: only the board item's title.

const PROJECT = process.env.SUPABASE_PROJECT_REF ?? "vcohxiqsmnkzxnvawgri";
const apply = process.argv.includes("--apply");
const FICTIONAL = "@fictional.capitalq.local";
const LEGACY = "Q's answer:";

async function sql(query, readOnly = true) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT}/database/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, read_only: readOnly }),
    },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`SQL ${response.status}: ${text.slice(0, 600)}`);
  }
  return JSON.parse(text);
}
const lit = (value) => `'${String(value).replace(/'/g, "''")}'`;

// The kinds of work Q titles saved answers by (packages/q-specialists
// answer-document.ts WORK_KINDS), kept in step by hand: a one-off.
const WORK_KINDS = [
  [/\b(prep(are|aring)?|ready)\b.*\bcall\b|\bcall prep\b/iu, "Call prep"],
  [
    /\b(prep(are|aring)?|ready)\b.*\bmeeting\b|\bmeeting prep\b/iu,
    "Meeting prep",
  ],
  [
    /\b(\d{1,2}[- ](month|year|week)\s+)?(growth|go[- ]to[- ]market|fundraising|hiring|business|action)?\s*plan\b/iu,
    "Plan",
  ],
  [/\binvestment memo\b|\bic memo\b|\bmemo\b/iu, "Memo"],
  [/\bcompar(e|ison)\b/iu, "Comparison"],
  [/\bquestions?\b/iu, "Questions"],
  [/\b(summary|summari[sz]e)\b/iu, "Summary"],
  [/\b(outreach|intro(duction)?|email)\b/iu, "Outreach draft"],
  [/\b(analysis|analy[sz]e|assessment|assess|diligence)\b/iu, "Analysis"],
];

function kindOf(ask) {
  for (const [pattern, kind] of WORK_KINDS) {
    const found = pattern.exec(ask);
    if (found === null) continue;
    if (kind === "Plan") {
      const named = found[0].trim().replace(/\s+/gu, " ").toLowerCase();
      return named.length > 4
        ? `${named.charAt(0).toUpperCase()}${named.slice(1)}`
        : kind;
    }
    return kind;
  }
  return null;
}

/** The proper name the ask is about, as written (nameInAsk). */
function subjectOf(ask) {
  const found =
    /\b(?:with|for|about|meet(?:ing)?|call)\s+((?:\p{Lu}[\p{L}\d&'.-]*)(?:\s+(?:\p{Lu}[\p{L}\d&'.-]*|of|and|&))*)/u.exec(
      ask,
    )?.[1];
  const name = found?.replace(/\s+(?:of|and|&)$/u, "").trim();
  return name === undefined || name.length < 2 ? null : name;
}

/** A new title only when both the kind and who it is about are read. */
export function renamed(title) {
  const ask = title.slice(LEGACY.length).trim();
  const kind = kindOf(ask);
  const subject = subjectOf(ask);
  if (kind === null || subject === null) return null;
  return `${kind}: ${subject}`.slice(0, 300);
}

const rows = await sql(
  `select i.id, i.tenant_id, i.user_id, i.title, i.revision, i.status, u.email
     from workspace.board_items i
     join identity.user_profiles p on p.id = i.user_id
     join auth.users u on u.id = p.auth_user_id
    where u.email like ${lit(`%${FICTIONAL}`)}
      and i.archived_at is null
      and i.title like ${lit(`${LEGACY}%`)}
    order by u.email, i.created_at`,
);

const plan = rows.map((row) => {
  if (!String(row.email).endsWith(FICTIONAL)) {
    throw new Error(`refused: ${row.email} is not a fictional account`);
  }
  const title = renamed(row.title);
  return { ...row, action: title === null ? "ARCHIVE" : "RENAME", to: title };
});

for (const item of plan) {
  console.log(
    `${item.action.padEnd(7)} ${item.email}  "${item.title}"${item.to === null ? "" : `  ->  "${item.to}"`}`,
  );
}
const renames = plan.filter((item) => item.action === "RENAME").length;
const archives = plan.length - renames;
const accounts = new Set(plan.map((item) => item.email)).size;
console.log(
  `\n${String(plan.length)} legacy items on ${String(accounts)} fictional accounts: ${String(renames)} to rename, ${String(archives)} to archive.`,
);

if (!apply || plan.length === 0) {
  console.log(
    apply
      ? "Nothing to change."
      : "Dry run: nothing changed. Re-run with --apply.",
  );
  process.exit(0);
}

// Each event row is written only by its own item's update (a CTE), so an
// item changed since the read writes nothing; the revision check before
// commit then stops the whole run.
const statements = plan.map((item) => {
  const next = Number(item.revision) + 1;
  const guard = `id = ${lit(item.id)} and revision = ${String(item.revision)} and archived_at is null`;
  const set =
    item.action === "RENAME"
      ? `title = ${lit(item.to)}, revision = ${String(next)}`
      : `archived_at = clock_timestamp(), revision = ${String(next)}`;
  const changes =
    item.action === "RENAME"
      ? `jsonb_build_object('title', jsonb_build_object('from', ${lit(item.title)}::text, 'to', ${lit(item.to)}::text))`
      : `'{}'::jsonb`;
  return `with changed as (
      update workspace.board_items set ${set} where ${guard} returning id, tenant_id, user_id, status
    )
    insert into workspace.board_item_events
      (tenant_id, user_id, item_id, revision, action, actor, from_status, to_status, changes)
    select tenant_id, user_id, id, ${String(next)}, ${lit(item.action === "RENAME" ? "EDITED" : "ARCHIVED")}, 'Q', status, status, ${changes}
      from changed;`;
});
const expected = plan
  .map(
    (item) => `(${lit(item.id)}::uuid, ${String(Number(item.revision) + 1)})`,
  )
  .join(", ");
const check = `do $$ begin
  if (select count(*) from workspace.board_items
       where (id, revision) in (${expected})) <> ${String(plan.length)}
  then raise exception 'an item changed since it was read; nothing applied';
  end if; end $$;`;
await sql(`begin; ${statements.join("\n")} ${check} commit;`, false);
console.log(
  `Applied: ${String(renames)} renamed, ${String(archives)} archived.`,
);
