/* global console */
// Read-only: does each founder have their own Q guide saved?
import * as lib from "./lib.mjs";

const out = [];
for (const c of lib.companies()) {
  const t = await lib.accessToken(lib.emailFor(c.founderPerson.name, c.company));
  const r = await lib.call(lib.API, t, "GET", "/v1/me/etiquette-guide");
  const text = JSON.stringify(r.body ?? "");
  out.push(
    `${c.n} ${c.company}: ${r.status} ${text.includes(c.company) ? "has guide" : "MISSING"} ${text.slice(0, 80)}`,
  );
}
console.log(out.join("\n"));
