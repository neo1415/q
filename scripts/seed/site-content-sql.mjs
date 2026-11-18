/**
 * The site content seed (decision 107) as SQL text, for the management
 * API path of scripts/seed/site-content.mjs, where the sandbox cannot open
 * a Postgres connection and has only the HTTPS SQL endpoint, which takes
 * no bind parameters. The statements do exactly what seedSiteContent
 * (packages/platform-admin) does, one page at a time:
 *
 *   - a page whose slug already exists is skipped, never overwritten;
 *   - a new page gets version 1 (source SEED) and its working draft;
 *   - a non-legal page is published (pointer, PUBLISHED, a PUBLISH event
 *     with no actor, which only the seed may write);
 *   - a legal page stays DRAFT_PENDING_LEGAL_REVIEW, and a held page
 *     (--hold-pricing) stays in the status its file declares.
 *
 * Every value is a SQL literal built here, never interpolated raw:
 * strings are single-quoted with quotes doubled (standard_conforming_strings
 * is on in Supabase, so a backslash is an ordinary character), JSON is
 * serialised then quoted and cast, and integers must be integers. A NUL
 * byte, which Postgres text cannot hold, is refused rather than cut.
 */

/** Pages the seed publishes on import unless held: every kind but legal. */
const PUBLISHES = (page) => page.kind !== "legal";

export function lit(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("not an integer");
    return String(value);
  }
  if (typeof value !== "string")
    throw new Error(`not a string: ${typeof value}`);
  if (value.includes("\u0000")) throw new Error("NUL byte in a value");
  return `'${value.replace(/'/g, "''")}'`;
}

export const jsonLit = (value) => `${lit(JSON.stringify(value))}::jsonb`;

const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const dateLit = (value) => {
  if (value === null || value === undefined) return "null";
  if (!DATE.test(value)) throw new Error(`not a date: ${value}`);
  return `${lit(value)}::date`;
};

/**
 * What the seed will do to each page, given the slugs already present.
 * `hold` names slugs that are imported but not published.
 */
export function planSiteContent(pages, existingSlugs, { hold = [] } = {}) {
  const existing = new Set(existingSlugs);
  const held = new Set(hold);
  return pages.map((page) => {
    if (existing.has(page.slug)) {
      return { page, action: "SKIP", status: null };
    }
    const publish = PUBLISHES(page) && !held.has(page.slug);
    return {
      page,
      action: publish ? "CREATE_AND_PUBLISH" : "CREATE_DRAFT",
      status: publish ? "PUBLISHED" : page.status,
      held: PUBLISHES(page) && held.has(page.slug),
    };
  });
}

/**
 * One statement for one page. Each step reads the row the step before it
 * returned, so a page that already exists (the insert returns nothing)
 * writes nothing at all. The page is inserted with its final status: the
 * update the connection path makes could not see a row inserted in the
 * same statement.
 */
export function renderPageSql(entry) {
  const { page } = entry;
  if (entry.action === "SKIP") return null;
  const publish = entry.action === "CREATE_AND_PUBLISH";
  const title = lit(page.title);
  const summary = lit(page.summary);
  const blocks = jsonLit(page.blocks);
  const lines = [
    `with page as (`,
    `  insert into site_content.pages (slug, kind, title, summary, status, sort_order, anchor, effective_date)`,
    `  values (${lit(page.slug)}, ${lit(page.kind)}, ${title}, ${summary}, ${lit(entry.status)}, ${lit(page.order)}, ${lit(page.anchor)}, ${dateLit(page.effectiveDate)})`,
    `  on conflict (slug) do nothing`,
    `  returning id`,
    `), version as (`,
    `  insert into site_content.page_versions (page_id, version_number, title, summary, blocks, source)`,
    `  select id, 1, ${title}, ${summary}, ${blocks}, 'SEED' from page`,
    `  returning id, page_id`,
    `), draft as (`,
    `  insert into site_content.page_drafts (page_id, title, summary, blocks, base_version)`,
    `  select id, ${title}, ${summary}, ${blocks}, 1 from page`,
    `)`,
  ];
  if (publish) {
    lines.push(
      `, pointer as (`,
      `  insert into site_content.published_pointers (page_id, version_id)`,
      `  select page_id, id from version`,
      `)`,
      `insert into site_content.publish_events (page_id, version_id, version_number, action)`,
      `select page_id, id, 1, 'PUBLISH' from version;`,
    );
  } else {
    lines.push(`select count(*) from version;`);
  }
  return lines.join("\n");
}

/** Every page in one transaction: all of the seed lands, or none of it. */
export function renderSiteContentSql(plan) {
  const statements = plan
    .map(renderPageSql)
    .filter((statement) => statement !== null);
  if (statements.length === 0) return null;
  return ["begin;", ...statements, "commit;"].join("\n");
}

export function renderSiteContentPlan(plan) {
  const lines = plan.map((entry) => {
    const what =
      entry.action === "SKIP"
        ? "skip (already present)"
        : entry.action === "CREATE_AND_PUBLISH"
          ? "create v1, publish"
          : entry.held
            ? `create v1, held as ${entry.status}`
            : `create v1, ${entry.status}`;
    return `${entry.page.slug.padEnd(28)} ${entry.page.kind.padEnd(16)} ${what}`;
  });
  const count = (action) => plan.filter((e) => e.action === action).length;
  lines.push(
    "",
    `${String(count("CREATE_AND_PUBLISH"))} to publish, ${String(count("CREATE_DRAFT"))} as drafts, ${String(count("SKIP"))} already present`,
  );
  return lines.join("\n");
}
