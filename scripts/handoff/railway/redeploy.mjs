import { rw } from "./rw.mjs";
const r = await rw(
  `query { projects { edges { node { name services { edges { node { name deployments(first: 3) { edges { node { id status meta } } } } } } } } } }`,
);
const p = r.data.projects.edges.find((e) => e.node.name === "Q").node;
const d = p.services.edges.find((e) => e.node.name === process.argv[2]).node
  .deployments.edges[0].node;
console.log("latest", d.status, (d.meta?.commitHash ?? "").slice(0, 9));
if (process.argv[3] === "go") {
  const x = await rw(
    `mutation($id:String!){ deploymentRedeploy(id:$id){ id status } }`,
    { id: d.id },
  );
  console.log(JSON.stringify(x).slice(0, 300));
}
