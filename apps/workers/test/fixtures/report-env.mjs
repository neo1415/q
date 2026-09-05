// Reports what the parser process can see of its parent's environment.
// Written beside the workspace because the workspace itself is removed as
// soon as the run ends.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const workspace = process.argv[2];
writeFileSync(
  join(dirname(workspace), "env-report.json"),
  JSON.stringify({ keys: Object.keys(process.env), cwd: process.cwd() }),
);
process.stdout.write(JSON.stringify({ ok: false, code: "PARSER_FAILED" }));
