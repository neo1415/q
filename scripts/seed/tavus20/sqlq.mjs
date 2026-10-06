/* global process, console */
// Read-only inspection: node sqlq.mjs "<select ...>"
import { sql } from "./lib.mjs";
const r = await sql(process.argv[2]);
const s = JSON.stringify(r);
console.log(s.length > 9000 ? s.slice(0, 9000) + "..." : s);
