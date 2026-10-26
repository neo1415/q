import { rw } from "./rw.mjs";
// Prints variable NAMES only (never values) for one service.
const r = await rw(
  `query { projects { edges { node { id name environments { edges { node { id name } } } services { edges { node { id name } } } } } } }`,
);
const p = r.data.projects.edges.find((e) => e.node.name === "Q").node;
const env = p.environments.edges.find((e) => e.node.name === "production").node
  .id;
const s = p.services.edges.find((e) => e.node.name === process.argv[2]).node.id;
const v = await rw(
  `query($p:String!,$e:String!,$s:String!){ variables(projectId:$p, environmentId:$e, serviceId:$s) }`,
  { p: p.id, e: env, s },
);
console.log(
  Object.keys(v.data?.variables ?? {})
    .filter((k) =>
      /SEARCH|SERP|TAVILY|SCRAP|BRAVE|SERPER|BRIGHT|EXA|BING|RESEARCH|GEMINI|GOOGLE|PEXELS|IMAGE/i.test(
        k,
      ),
    )
    .sort()
    .join("\n"),
);
