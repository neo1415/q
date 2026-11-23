// Set ONE Railway service variable (this redeploys that service on its current SHA).
//   SERVICE=<serviceId> NAME=<VAR> VALUE=<value> NODE_USE_ENV_PROXY=1 node scripts/handoff/live/railway/setvar.mjs
// Never pass a secret this way from a shared shell history; provider keys belong in the Railway UI.
// Service ids: workers 2a705356-efc1-4025-83f8-f6d3f085f28a (others: varnames.mjs / deploys.mjs).
import { rw } from "./rw.mjs";
const { SERVICE, NAME, VALUE } = process.env;
if (!SERVICE || !NAME || VALUE === undefined)
  throw new Error("set SERVICE, NAME and VALUE");
const r = await rw(
  `mutation($i: VariableUpsertInput!){ variableUpsert(input:$i) }`,
  {
    i: {
      projectId: "9e615d28-7db0-406e-a415-c5118a275427",
      environmentId: "f7e5768d-56e6-4ee3-be29-c38172b3114c",
      serviceId: SERVICE,
      name: NAME,
      value: VALUE,
    },
  },
);
console.log(JSON.stringify(r).slice(0, 300));
