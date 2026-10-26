import { rw } from "./rw.mjs";
const r = await rw(
  `query { projects { edges { node { name services { edges { node { name deployments(first: 3) { edges { node { id status meta } } } } } } } } } }`,
);
const p = r.data.projects.edges.find((e) => e.node.name === "Q").node;
const d = p.services.edges.find((e) => e.node.name === process.argv[2]).node
  .deployments.edges[0].node;
console.log(
  "deployment",
  d.id,
  d.status,
  (d.meta?.commitHash ?? "").slice(0, 9),
);
for (const kind of ["buildLogs", "deploymentLogs"]) {
  const l = await rw(
    `query($d:String!){ ${kind}(deploymentId:$d, limit: 400) { message severity } }`,
    { d: d.id },
  );
  const lines = (l.data?.[kind] ?? []).map((x) => x.message);
  console.log(`== ${kind}: ${lines.length} lines; last 25:`);
  for (const m of lines.slice(-25)) console.log(m.slice(0, 300));
}
