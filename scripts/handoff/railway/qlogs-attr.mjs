import { rw } from "./rw.mjs";
// Usage: node qlogs-attr.mjs <deploymentId> <message regex>
const dep = { id: process.argv[2] };
const l = await rw(
  `query($d:String!){ deploymentLogs(deploymentId:$d, limit: 5000) { message timestamp attributes { key value } } }`,
  { d: dep.id },
);
const red = (s) =>
  s.replace(/(key|token|secret|api_key)=([^&\s"]{2})[^&\s"]*/gi, "$1=$2…");
for (const x of (l.data?.deploymentLogs ?? [])
  .filter((x) => new RegExp(process.argv[3], "i").test(x.message))
  .slice(0, 4)) {
  const a = Object.fromEntries(
    (x.attributes ?? []).map((a) => [a.key, a.value]),
  );
  console.log(
    x.timestamp?.slice(11, 19),
    x.message,
    red(String(a.calls ?? a.subjects ?? JSON.stringify(a))).slice(0, 2500),
  );
}
