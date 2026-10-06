/* global process, console, fetch */
// Sets every tavus-20 fictional account's password to CQ_SEED_ACCOUNT_PASSWORD
// (env only; never printed or written) so the founder can sign in as them,
// and writes docs/seed/tavus-20/LOGINS.md (emails only, no passwords).
// Accounts that exist but are not marked fictional_demo are never touched.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import * as lib from "./lib.mjs";

const password = process.env.CQ_SEED_ACCOUNT_PASSWORD ?? "";
if (password.length < 8) throw new Error("CQ_SEED_ACCOUNT_PASSWORD missing or too short");
const keys = await lib.supabaseKeys();

const lines = [
  "# Tavus-20 fictional accounts",
  "",
  "Sign in at https://capital-qweb-production.up.railway.app/auth/sign-in with the shared seed password (env `CQ_SEED_ACCOUNT_PASSWORD`; not written here). All addresses are Gmail plus-aliases of the founder's own inbox; every person and company is fictional.",
  "",
  "Team members: until F11 is fixed, `/home` sends a joined member to `/welcome`; open `/profile` or `/company/<id>` directly.",
  "",
  "| # | Company | Person | Role | Email |",
  "| --- | --- | --- | --- | --- |",
];
let set = 0;
for (const c of lib.companies()) {
  const people = [
    { name: c.founderPerson.name, role: `${c.founderPerson.role} (Owner)` },
    ...c.team.map((p) => ({ name: p.name, role: `${p.title} (${p.appRole === "ADMIN" ? "Admin" : "Member"})` })),
  ];
  for (const p of people) {
    const email = lib.emailFor(p.name, c.company);
    const found = await lib.findUser(email);
    if (!found) continue; // not created yet
    if (found.fd !== "true") throw new Error(`${email} is not fictional; refusing`);
    const r = await fetch(`${lib.SB_URL}/auth/v1/admin/users/${found.id}`, {
      method: "PUT",
      headers: { apikey: keys.secret, authorization: `Bearer ${keys.secret}`, "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!r.ok) throw new Error(`password for ${email}: HTTP ${r.status}`);
    set += 1;
    lines.push(`| ${c.n} | ${c.company} | ${p.name} | ${p.role} | ${email} |`);
  }
}
writeFileSync(join(lib.ROOT, "docs/seed/tavus-20/LOGINS.md"), lines.join("\n") + "\n");
console.log(`passwords set: ${set}`);
