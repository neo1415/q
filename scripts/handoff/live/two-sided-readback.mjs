// READ-ONLY two-sided snapshot on FICTIONAL accounts: what the investor
// sees of their questions/data-room requests and what the founder sees in
// their inbox, for one relationship. No writes.
//   CQ_PUBLIC_JSON=<file> CQ_SEED_ACCOUNT_PASSWORD=... NODE_USE_ENV_PROXY=1 \
//   node scripts/handoff/live/two-sided-readback.mjs [ledgerfold|ajopot]
import { signIn } from "./fictional-session.mjs";

const c = await import(
  new URL("../../../packages/api-client/dist/index.js", import.meta.url).href
);
const D = "@fictional.capitalq.local";
const key = process.argv[2] ?? "ajopot";
const investor = await signIn(`investor.savanna-seed${D}`);
const founder = await signIn(`founder.${key}${D}`);
const rels = await c.listInvestorRelationships(investor);
const rel = rels.items.find(
  (r) => r.counterpart.name.toLowerCase().replace(/\s/g, "") === key,
);
if (!rel) throw new Error("no relationship");
const companyId = rel.counterpart.id;
const safe = async (name, p) => {
  try {
    return await p;
  } catch (e) {
    console.log(
      `${name}: ERROR ${e?.status ?? ""} ${String(e?.message ?? e).slice(0, 120)}`,
    );
    return null;
  }
};
console.log("relationship", rel.state, rel.nextStep);
const qs = await safe(
  "investor questions",
  c.getInvestorQuestions(investor, companyId),
);
console.log(
  "investor questions:",
  qs?.questions.length,
  "answered:",
  qs?.questions.filter((q) => q.answer).length,
);
const inbox = await safe(
  "founder inbox",
  c.getRequestInbox(founder, companyId),
);
if (inbox) {
  console.log("founder inbox counts", JSON.stringify(inbox.counts));
  for (const item of inbox.items.slice(0, 8))
    console.log(
      " -",
      item.kind,
      item.kind === "DOCUMENT_REQUEST"
        ? `${item.source} ${item.status} "${item.title}"`
        : `${item.questions.length}q answered=${item.questions.filter((q) => q.answer).length}`,
      "from",
      item.requesterName ?? "?",
      "/",
      item.investorOrganisationName ?? "?",
    );
}
const room = await safe(
  "investor data room",
  c.getCompanyDataRoom(investor, companyId),
);
if (room)
  console.log("investor data room:", JSON.stringify(room).slice(0, 600));
const dil = await safe(
  "diligence",
  c.getDiligence(investor, rel.relationshipId),
);
if (dil) console.log("investor diligence:", JSON.stringify(dil).slice(0, 600));
const deal = await safe(
  "deal",
  c.getRelationshipDeal(investor, rel.relationshipId),
);
if (deal) console.log("investor deal:", JSON.stringify(deal).slice(0, 900));
const fn = await safe("founder notifications", c.listNotifications(founder));
if (fn)
  console.log(
    "founder notifications:",
    fn.unread,
    "unread;",
    fn.items
      .slice(0, 6)
      .map((n) => `${n.kind}:${n.title}`)
      .join(" | "),
  );
const inn = await safe("investor notifications", c.listNotifications(investor));
if (inn)
  console.log(
    "investor notifications:",
    inn.unread,
    "unread;",
    inn.items
      .slice(0, 6)
      .map((n) => `${n.kind}:${n.title}`)
      .join(" | "),
  );
