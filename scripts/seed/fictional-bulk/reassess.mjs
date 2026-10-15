import { readFileSync } from "node:fs";
import * as lib from "../tavus20/lib.mjs";
import { buildWorld } from "./world.mjs";
const s = JSON.parse(
  readFileSync(
    new URL(
      "../../../docs/seed/fictional-bulk/seed-state.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const w = buildWorld({ count: 400 });
const rows = await lib.sql(
  `select id from core.companies where id = any(array[${Object.values(
    s.companies,
  )
    .map((c) => `'${c.companyId}'`)
    .join(
      ",",
    )}]::uuid[]) and marketplace_readiness_state <> 'marketplace_ready'`,
);
const ids = new Set(rows.map((r) => r.id));
let n = 0,
  ready = 0;
for (const c of w.companies) {
  const st = s.companies[c.key];
  if (!st || !ids.has(st.companyId)) continue;
  n++;
  const t = await lib.accessToken(c.founder.email).catch(() => null);
  if (!t) continue;
  const r = await lib.call(
    lib.API,
    t,
    "POST",
    `/v1/companies/${st.companyId}/marketplace-readiness/assess`,
    {},
  );
  if (r.body?.state === "marketplace_ready") ready++;
  else if (n < 4)
    console.log(
      c.key,
      r.status,
      JSON.stringify(
        r.body?.requirements
          ?.filter((q) => q.outcome === "OUTSTANDING")
          .map((q) => q.requirement),
      ),
    );
  await lib.sleep(1500);
}
console.log(`reassessed ${n}, now ready ${ready}`);
