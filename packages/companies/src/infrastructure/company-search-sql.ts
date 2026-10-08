import type { DatabaseExecutor } from "@capital-q/database";

import {
  exactNeedles,
  FUZZY_NAME_MIN,
  isDescriptiveSearch,
  requiredTermMatches,
  type ParsedCompanySearch,
} from "../domain/company-search.js";

/**
 * The SQL twin of scoreCompanySearch (domain/company-search.ts): the same
 * tiers, computed in Postgres so ranking and keyset paging stay in one query.
 * Used as `from core.companies c ${companySearchJoins(sql, parsed)}` and
 * exposes `s.score` (0 means no match).
 *
 * The document a described query matches is only what the network view
 * shows: name, line, city and DECLARED sector labels (user-selected,
 * admin-curated or confirmed; never an unconfirmed Q inference, which may
 * come from a founder's private material), the same rule as Discover's
 * filter facts. Country and stage compare the company's declared columns.
 */

const ACCENTED = "áàâäãåāéèêëēíìîïīóòôöõøōúùûüūçñýÿ";
const PLAIN = "aaaaaaaeeeeeiiiiiooooooouuuuucnyy";

const likeNeedle = (needle: string) =>
  `%${needle.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

export function companySearchJoins(
  sql: DatabaseExecutor,
  parsed: ParsedCompanySearch,
) {
  const descriptive = isDescriptiveSearch(parsed);
  const letters = parsed.letters;
  const key = parsed.key;
  // 2026-10-08: how many words match (a substring, synonyms included) and
  // how many appear as the whole word; the domain twin counts the same.
  const matched = parsed.terms.reduce(
    (acc, term) =>
      sql`${acc} + (case when d.doc like any(${term.any.map(likeNeedle)}::text[]) then 1 else 0 end)`,
    sql`0`,
  );
  const exact = parsed.terms.reduce(
    (acc, term) =>
      sql`${acc} + (case when d.doc like any(${exactNeedles(term).map(likeNeedle)}::text[]) then 1 else 0 end)`,
    sql`0`,
  );
  const bonus =
    (parsed.countries.length > 0 ? 10 : 0) +
    (parsed.stages.length > 0 ? 10 : 0);
  const described = descriptive
    ? sql`case when (${parsed.countries.length === 0} or c.headquarters_country = any(${[...parsed.countries]}::text[]))
                and (${parsed.stages.length === 0} or c.current_stage_code = any(${[...parsed.stages]}::text[]))
                and t.matched >= ${requiredTermMatches(parsed.terms.length)}::int
               then 200 + 20 * t.matched + 5 * t.exact + ${bonus}::int
               else 0 end`
    : sql`0`;
  return sql`
    cross join lateral (
      select regexp_replace(translate(lower(c.canonical_name), ${ACCENTED}, ${PLAIN}), '[^a-z0-9]', '', 'g') as nl,
             btrim(regexp_replace(translate(lower(c.canonical_name), ${ACCENTED}, ${PLAIN}), '[^a-z0-9]+', ' ', 'g')) as words
    ) n
    cross join lateral (
      -- searchKey(): ph->f, ck|ch|c|q->k, x->ks, z->s, y->i, doubles collapsed
      select regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
               regexp_replace(n.nl, 'ph', 'f', 'g'), '(ck|ch|c|q)', 'k', 'g'),
               'x', 'ks', 'g'), 'z', 's', 'g'), 'y', 'i', 'g'), '(.)\\1+', '\\1', 'g') as nk
    ) k
    cross join lateral (
      select case when ${descriptive} then
        ' ' || regexp_replace(translate(lower(
          c.canonical_name || ' ' || coalesce(c.short_description, '') || ' ' ||
          coalesce(c.headquarters_city, '') || ' ' ||
          coalesce((select string_agg(tn.display_name, ' ')
                      from taxonomy.entity_assignments a
                      join taxonomy.nodes tn on tn.id = a.node_id
                     where a.entity_type = 'COMPANY' and a.entity_id = c.id
                       and a.tenant_id = c.tenant_id
                       and a.status = 'ACTIVE' and a.valid_to is null
                       and (a.assignment_source in ('user_selected', 'admin_curated')
                            or a.confirmed_at is not null)), '')),
          ${ACCENTED}, ${PLAIN}), '[^a-z0-9]+', ' ', 'g') || ' '
      else '' end as doc
    ) d
    cross join lateral (
      select ${matched}::int as matched, ${exact}::int as exact
    ) t
    cross join lateral (
      -- 2026-10-08: the closest single word of the name, for a misspelling
      -- of one word of a longer name ("dristi" for Drishti Health).
      select coalesce(max(extensions.similarity(w, ${letters})), 0) as word_sim
        from regexp_split_to_table(n.words, ' ') w
       where length(w) >= 3
    ) nw
    cross join lateral (
      select greatest(
        case
          when n.nl = ${letters} then 1000
          when ${parsed.host}::text is not null
               and regexp_replace(lower(coalesce(c.website_url, '')), '^https?://(www\\.)?([^/:?#]+).*$', '\\2') = ${parsed.host}::text
            then 950
          when ${letters.length >= 3} and k.nk = ${key} then 900
          when starts_with(n.nl, ${letters}) then 800
          when ${letters.length >= 3} and strpos(n.nl, ${letters}) > 0 then 650
          when ${key.length >= 3} and starts_with(k.nk, ${key}) then 600
          when ${letters.length >= 4} and length(n.nl) = ${letters.length}
               and left(n.nl, 1) = ${letters.slice(0, 1)}
               and (select string_agg(ch, '' order by ch collate "C") from regexp_split_to_table(n.nl, '') ch)
                   = ${[...letters].sort().join("")}
            then 550
          when ${letters.length >= 3}
               and greatest(extensions.similarity(n.nl, ${letters}), extensions.similarity(k.nk, ${key}), nw.word_sim) >= ${FUZZY_NAME_MIN}::float8
            then 300 + round(300 * greatest(extensions.similarity(n.nl, ${letters}), extensions.similarity(k.nk, ${key}), nw.word_sim))::int
          else 0
        end,
        ${described}) as score
    ) s`;
}
