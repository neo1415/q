import { rw } from "./rw.mjs";
const r = await rw(
  `query { projects { edges { node { name services { edges { node { name deployments(first: 20) { edges { node { id status meta } } } } } } } } } }`,
);
const p = r.data.projects.edges.find((e) => e.node.name === "Q").node;
const svc = p.services.edges.find(
  (e) => e.node.name === (process.env.SVC ?? "@capital-q/q-api"),
).node;
const dep = svc.deployments.edges.find(
  (e) =>
    (e.node.meta?.commitHash ?? "").startsWith(process.argv[2]) &&
    e.node.status !== "FAILED",
)?.node;
const l = await rw(
  `query($d:String!){ deploymentLogs(deploymentId:$d, limit: 5000) { message timestamp attributes { key value } } }`,
  { d: dep.id },
);
const red = (s) =>
  s.replace(/(key|token|secret|authorization)"?[:=]"?[^,"}\s]+/gi, "$1=[R]");
for (const x of l.data?.deploymentLogs ?? []) {
  const t = x.timestamp?.slice(11, 19) ?? "";
  if (t < process.argv[4] || t > process.argv[5]) continue;
  if (!new RegExp(process.argv[3], "i").test(x.message)) continue;
  console.log(
    t,
    x.message,
    red(
      JSON.stringify(
        Object.fromEntries(
          (x.attributes ?? [])
            .filter((a) => !/^(level|time|pid|hostname)$/.test(a.key))
            .map((a) => [a.key, a.value]),
        ),
      ),
    ).slice(0, 6000),
  );
}
