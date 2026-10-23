import { rw } from "./rw.mjs";
const want = process.argv[2];
const until = Date.now() + Number(process.argv[3] ?? 600) * 1000;
const q = `query { projects { edges { node { name services { edges { node { name deployments(first: 1) { edges { node { status createdAt meta } } } } } } } } } }`;
let last = "";
while (Date.now() < until) {
  const r = await rw(q);
  const rows = [];
  for (const p of r.data?.projects.edges ?? [])
    if (p.node.name === "Q")
      for (const s of p.node.services.edges) {
        const d = s.node.deployments.edges[0]?.node;
        rows.push(
          `${s.node.name}=${d?.status}@${(d?.meta?.commitHash ?? "").slice(0, 9)}`,
        );
      }
  const line = rows.join(" ");
  if (line !== last) {
    console.log(new Date().toISOString().slice(11, 19), line);
    last = line;
  }
  const ours = rows.filter((x) => x.endsWith(want));
  if (
    ours.length === 4 &&
    ours.every((x) => /=(SUCCESS|FAILED|CRASHED|REMOVED)@/.test(x))
  )
    break;
  await new Promise((res) => setTimeout(res, 30000));
}
