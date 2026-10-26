import { rw } from "./rw.mjs";
const [svcName, sha] = process.argv.slice(2);
const r = await rw(
  `query { projects { edges { node { id name environments { edges { node { id name } } } services { edges { node { id name } } } } } } }`,
);
const p = r.data.projects.edges.find((e) => e.node.name === "Q").node;
const svc = p.services.edges.find((e) => e.node.name === svcName).node;
const env =
  p.environments.edges.find((e) => e.node.name === "production")?.node ??
  p.environments.edges[0].node;
console.log("svc", svc.name, "env", env.name);
const x = await rw(
  `mutation($s:String!,$e:String!,$c:String!){ serviceInstanceDeployV2(serviceId:$s, environmentId:$e, commitSha:$c) }`,
  { s: svc.id, e: env.id, c: sha },
);
console.log(JSON.stringify(x).slice(0, 300));
