// Test accounts for the 10 real-company profiles: one founder per company
// (to claim it through "Find my startup") and three test investors.
// Created the way the tavus-20 seed creates accounts (confirmed sign-up,
// no email sent); everything after sign-up runs through the app's own flows.
// Every address is a plus-alias of the founder's own inbox. The password is
// the shared seed password from the environment, never printed or written.
//   node scripts/seed/real-companies/accounts.mjs          list (dry run)
//   node scripts/seed/real-companies/accounts.mjs --apply  create missing
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as lib from "../tavus20/lib.mjs";

const SEED_KEY = "real-companies-test-v1";
const companies = JSON.parse(
  readFileSync(
    join(lib.ROOT, "docs/seed/real-companies/companies.json"),
    "utf8",
  ),
);
const slug = (s) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "");

export const FOUNDERS = companies.map((c) => {
  const first = c.founders?.[0]?.name?.split(/\s+/)[0] ?? "founder";
  return {
    company: c.name,
    role: "founder",
    name: `Test – ${c.name} founder`,
    email: `adedaniel502+cq-${slug(first)}-${slug(c.name)}@gmail.com`,
  };
});
export const INVESTORS = [
  ["Founders Factory Africa", "ffa"],
  ["Partech Africa", "partech"],
  ["TLcom", "tlcom"],
].map(([fund, s]) => ({
  company: `Test – ${fund}`,
  fund,
  role: "investor",
  name: `Test – ${fund}`,
  email: `adedaniel502+cq-investor-${s}@gmail.com`,
}));

async function ensure(p) {
  const found = await lib.findUser(p.email);
  if (found) return { id: found.id, created: false };
  // lib.ensureAccount marks the account a seeded test persona (never a real
  // person) and sets the shared seed password from the environment.
  return lib.ensureAccount({
    email: p.email,
    displayName: p.name,
    seedKey: `${SEED_KEY}:${p.role}:${slug(p.company)}`,
  });
}

if (process.argv[1]?.endsWith("accounts.mjs")) {
  const apply = process.argv.includes("--apply");
  for (const p of [...FOUNDERS, ...INVESTORS]) {
    if (!apply) {
      console.log(`${p.role}\t${p.company}\t${p.email}`);
      continue;
    }
    const r = await ensure(p);
    console.log(`${r.created ? "created" : "exists "}\t${p.email}\t${r.id}`);
  }
}
