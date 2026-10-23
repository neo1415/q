import { rw } from "./rw.mjs";
const r = await rw(
  `query { projects { edges { node { name services { edges { node { name deployments(first: 8) { edges { node { id status createdAt meta } } } } } } } } } }`,
);
const p = r.data.projects.edges.find((e) => e.node.name === "Q").node;
for (const d of p.services.edges.find((e) => e.node.name === "@capital-q/q-api")
  .node.deployments.edges)
  console.log(
    d.node.id,
    d.node.status,
    d.node.createdAt,
    (d.node.meta?.commitHash ?? "").slice(0, 9),
  );
