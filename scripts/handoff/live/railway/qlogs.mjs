// Read-only: one deployment's logs, filtered by pattern and time window.
//
//   node qlogs.mjs <commit-prefix> <pattern> <from HH:MM:SS> <to HH:MM:SS>
//
// SVC picks the service (default @capital-q/q-api). DEPLOYMENT_ID reads
// that deployment instead of the newest non-failed one of the commit: the
// same commit is often deployed more than once (a variable change, a
// rollback and redeploy), and the earlier deployment's logs are the ones
// an incident is in. The commit prefix is still checked against it.
import { rw } from "./rw.mjs";
const r = await rw(
  `query { projects { edges { node { name services { edges { node { name deployments(first: 20) { edges { node { id status createdAt meta } } } } } } } } } }`,
);
const p = r.data.projects.edges.find((e) => e.node.name === "Q").node;
const svc = p.services.edges.find(
  (e) => e.node.name === (process.env.SVC ?? "@capital-q/q-api"),
).node;
const ofCommit = svc.deployments.edges
  .map((e) => e.node)
  .filter((d) => (d.meta?.commitHash ?? "").startsWith(process.argv[2]));
const wanted = process.env.DEPLOYMENT_ID;
const dep =
  wanted === undefined || wanted === ""
    ? ofCommit.find((d) => d.status !== "FAILED")
    : ofCommit.find((d) => d.id === wanted);
if (dep === undefined) {
  console.error(
    wanted
      ? `deployment ${wanted} is not one of ${process.argv[2]}'s last 20 on this service`
      : `no deployment of ${process.argv[2]} on this service`,
  );
  for (const d of ofCommit) {
    console.error(`  ${d.id} ${d.status} ${d.createdAt ?? ""}`);
  }
  process.exit(1);
}
console.error(`deployment ${dep.id} ${dep.status} ${dep.createdAt ?? ""}`);
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
