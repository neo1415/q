import { rw } from "./rw.mjs";
const q = `query { projects { edges { node { name services { edges { node { name deployments(first: 1) { edges { node { status createdAt meta } } } } } } } } } }`;
const r = await rw(q);
if (r.errors) {
  console.log("errors:", JSON.stringify(r.errors).slice(0, 300));
  process.exit(0);
}
for (const p of r.data.projects.edges)
  for (const s of p.node.services.edges) {
    const d = s.node.deployments.edges[0]?.node;
    console.log(
      p.node.name,
      s.node.name,
      d?.status,
      d?.createdAt,
      (d?.meta?.commitHash ?? "").slice(0, 9),
    );
  }
