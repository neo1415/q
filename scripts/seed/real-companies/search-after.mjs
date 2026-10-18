// The shipped P13 search, rendered for the read-only eval. Uses the built
// @capital-q/companies code itself: parseCompanySearch, scoreCompanySearch
// and companySearchJoins (the SQL builder), with a tiny stand-in for the
// postgres.js tag that renders parameters as quoted literals. Only the
// outer select (visibility, order, limit) is restated here, from
// postgres-company-repository.ts / company-claims.ts.
// Build first: pnpm turbo run build --filter=@capital-q/companies
import {
  parseCompanySearch,
  scoreCompanySearch,
} from "../../../packages/companies/dist/index.js";
import { companySearchJoins } from "../../../packages/companies/dist/infrastructure/company-search-sql.js";

const FRAGMENT = Symbol("fragment");
const tag = (strings, ...values) => ({ [FRAGMENT]: true, strings, values });
const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;
function render(value) {
  if (value !== null && typeof value === "object" && value[FRAGMENT]) {
    return value.strings.reduce(
      (out, s, i) =>
        out + s + (i < value.values.length ? render(value.values[i]) : ""),
      "",
    );
  }
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    return quote(
      `{${value.map((v) => `"${String(v).replace(/["\\]/g, (c) => `\\${c}`)}"`).join(",")}}`,
    );
  }
  return quote(value);
}

const VISIBLE =
  "c.company_status = 'active' and c.marketplace_visibility in ('network_visible','public_external')";

/** SQL text for one surface, or null when the query reads as nothing. */
export function afterSearchSql(text, surface) {
  const t = text.trim().slice(0, 120);
  if (surface === "claimable" && t.length < 2) return null;
  const parsed = parseCompanySearch(t);
  if (parsed === null) return null;
  const joins = render(companySearchJoins(tag, parsed));
  if (surface === "claimable") {
    const like = quote(`%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    return `select c.canonical_name as name from core.companies c ${joins}
      where ${VISIBLE} and (s.score > 0 or c.legal_name ilike ${like})
      order by greatest(s.score, case when c.legal_name ilike ${like} then 640 else 0 end) desc, c.canonical_name, c.id limit 20`;
  }
  return `select c.canonical_name as name from core.companies c ${joins}
    where ${VISIBLE} and s.score > 0 order by s.score desc, c.canonical_name, c.id limit 11`;
}

/** Explore's in-memory ranking over its pitch pool (service.ts). */
export function afterSearchJs(text, pool) {
  const parsed = parseCompanySearch(
    text.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80),
  );
  if (parsed === null) return [];
  return pool
    .map((f, index) => ({
      f,
      index,
      score: scoreCompanySearch(parsed, {
        name: f.name,
        shortDescription: f.line,
        country: f.country,
        stage: f.stage,
      }),
    }))
    .filter((r) => r.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((r) => r.f.name);
}
