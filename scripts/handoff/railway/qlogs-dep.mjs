import { rw } from "./rw.mjs";
// logs for a specific commit's deployment of q-api
const r = await rw(
  `query { projects { edges { node { name services { edges { node { name deployments(first: 15) { edges { node { id status meta } } } } } } } } } }`,
);
const p = r.data.projects.edges.find((e) => e.node.name === "Q").node;
const svc = p.services.edges.find(
  (e) => e.node.name === "@capital-q/q-api",
).node;
const dep = svc.deployments.edges.find((e) =>
  (e.node.meta?.commitHash ?? "").startsWith(process.argv[2]),
)?.node;
const l = await rw(
  `query($d:String!){ deploymentLogs(deploymentId:$d, limit: 3000) { message timestamp attributes { key value } } }`,
  { d: dep.id },
);
for (const x of (l.data?.deploymentLogs ?? [])
  .filter((x) => new RegExp(process.argv[3], "i").test(x.message))
  .slice(0, Number(process.env.N ?? 5)))
  console.log(
    x.timestamp?.slice(11, 19),
    x.message,
    JSON.stringify(
      (x.attributes ?? [])
        .filter((a) =>
          /provider|research|failure|status|operation/i.test(a.key),
        )
        .map((a) => a.key + "=" + a.value),
    ).slice(0, 600),
  );
