import process from "node:process";

import { runPresenceSmoke } from "./presence-smoke.js";

/** Entry point for `pnpm presence:smoke`. */
await runPresenceSmoke(process.argv.slice(2));
