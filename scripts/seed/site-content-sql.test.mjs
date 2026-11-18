// node --test scripts/seed/site-content-sql.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  jsonLit,
  lit,
  planSiteContent,
  renderPageSql,
  renderSiteContentPlan,
  renderSiteContentSql,
} from "./site-content-sql.mjs";

const page = (over = {}) => ({
  slug: "faq",
  kind: "faq",
  title: "Questions",
  summary: "",
  status: "DRAFT",
  order: null,
  anchor: null,
  effectiveDate: null,
  currency: null,
  blocks: [],
  ...over,
});

const INJECTION = "x'); drop table site_content.pages; --";

/**
 * Every single-quoted literal in the SQL, with doubled quotes undone: the
 * values the server will see. What is left once they are removed is the
 * statement's own text, which must hold no value at all.
 */
function literals(sql) {
  const values = [];
  const code = sql.replace(/'((?:[^']|'')*)'/g, (_, inner) => {
    values.push(inner.replace(/''/g, "'"));
    return "?";
  });
  return { values, code };
}

test("lit quotes by doubling, and refuses what it cannot carry", () => {
  assert.equal(lit("it's"), "'it''s'");
  assert.equal(lit("a\\'b"), "'a\\''b'");
  assert.equal(lit(null), "null");
  assert.equal(lit(7), "7");
  assert.throws(() => lit(1.5), /integer/);
  assert.throws(() => lit("a\u0000b"), /NUL/);
  assert.throws(() => lit({}), /not a string/);
  assert.equal(jsonLit({ a: "it's" }), `'{"a":"it''s"}'::jsonb`);
});

test("plan: existing slugs are skipped, legal stays pending, the rest publish", () => {
  const plan = planSiteContent(
    [
      page({ slug: "faq" }),
      page({ slug: "pricing", kind: "pricing" }),
      page({
        slug: "privacy-policy",
        kind: "legal",
        status: "DRAFT_PENDING_LEGAL_REVIEW",
      }),
      page({ slug: "landing-hero", kind: "landing-section" }),
    ],
    ["landing-hero"],
  );
  assert.deepEqual(
    plan.map((e) => [e.page.slug, e.action, e.status]),
    [
      ["faq", "CREATE_AND_PUBLISH", "PUBLISHED"],
      ["pricing", "CREATE_AND_PUBLISH", "PUBLISHED"],
      ["privacy-policy", "CREATE_DRAFT", "DRAFT_PENDING_LEGAL_REVIEW"],
      ["landing-hero", "SKIP", null],
    ],
  );
  assert.equal(renderPageSql(plan[3]), null);
  assert.match(
    renderSiteContentPlan(plan),
    /2 to publish, 1 as drafts, 1 already present/,
  );
});

test("--hold-pricing keeps pricing a draft and writes no publish rows for it", () => {
  const [entry] = planSiteContent(
    [page({ slug: "pricing", kind: "pricing" })],
    [],
    {
      hold: ["pricing"],
    },
  );
  assert.equal(entry.action, "CREATE_DRAFT");
  assert.equal(entry.status, "DRAFT");
  const sql = renderPageSql(entry);
  assert.doesNotMatch(sql, /published_pointers|publish_events/);
  assert.match(renderSiteContentPlan([entry]), /held as DRAFT/);
});

test("a published page: version 1 from SEED, its draft, pointer and anonymous PUBLISH", () => {
  const [entry] = planSiteContent([page()], []);
  const sql = renderPageSql(entry);
  assert.match(sql, /on conflict \(slug\) do nothing/);
  assert.match(sql, /select id, 1, .* 'SEED' from page/);
  assert.match(sql, /insert into site_content\.page_drafts/);
  assert.match(sql, /insert into site_content\.published_pointers/);
  assert.match(sql, /select page_id, id, 1, 'PUBLISH' from version;/);
  assert.doesNotMatch(sql, /actor_user_id/);
});

test("injection in every content field stays inside its literal", () => {
  const hostile = page({
    slug: "faq",
    title: INJECTION,
    summary: `${INJECTION} \\' $$ $tag$ ;`,
    effectiveDate: "2026-11-18",
    blocks: [
      {
        type: "richText",
        id: "b1",
        content: [{ type: "paragraph", text: `${INJECTION}'' "q" \\` }],
      },
    ],
  });
  const sql = renderSiteContentSql(planSiteContent([hostile], []));
  const { values, code } = literals(sql);
  // The hostile text survives exactly, as data.
  assert.ok(values.includes(INJECTION));
  assert.ok(values.includes(`${INJECTION} \\' $$ $tag$ ;`));
  const blocks = values.find((v) => v.startsWith("[{"));
  assert.deepEqual(JSON.parse(blocks), hostile.blocks);
  // Outside the literals: no trace of it, and only the seed's own statements.
  assert.doesNotMatch(code, /drop table|--/i);
  assert.equal(code.split(";").length - 1, 3); // begin, the page, commit
  assert.match(code, /^begin;\n/);
  assert.match(code, /\ncommit;$/);
});

test("a malformed date or a non-integer order is refused, not written", () => {
  assert.throws(
    () =>
      renderPageSql(
        planSiteContent([page({ effectiveDate: "2026-11-18'; --" })], [])[0],
      ),
    /not a date/,
  );
  assert.throws(
    () => renderPageSql(planSiteContent([page({ order: 1.5 })], [])[0]),
    /integer/,
  );
});

test("nothing to write renders no SQL", () => {
  assert.equal(renderSiteContentSql(planSiteContent([page()], ["faq"])), null);
});
