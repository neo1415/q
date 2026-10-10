/**
 * R5 (local diagnosis only): exact per-run database round trips, by phase
 * and call site. Preload into q-api with CQ_ROUND_TRIP_TRACE=1:
 *
 *   NODE_OPTIONS=--import=<repo>/scripts/recovery/round-trip-trace.mjs
 *
 * (in the recovery stack, add both lines to stack.env and restart q-api).
 * `q orchestration returned` then carries `dbRoundTripSites`. It rewrites
 * two lines of postgres.js as it loads: the query keeps the stack it was
 * written from, and reports itself as it is handed to a connection, in
 * its caller's async context (packages/database/src/round-trips.ts).
 * Never for a deployed service.
 */
import { register } from "node:module";

register("./round-trip-trace-hooks.mjs", import.meta.url);
