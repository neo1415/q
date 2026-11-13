/**
 * Pure planning for `demo-figures.mjs` (A8 demo prep; owner direction
 * 13 Nov 2026: fictional demo data is prepared for full participation, with
 * provenance recorded and never presented as verified).
 *
 * A8 charts are drawn by code only from structured, CURRENT,
 * network-visible company figure claims (`read_company_figures`). The
 * fictional demo companies have none, so investor chart journeys draw
 * nothing. This module turns what each company's OWN seed source already
 * states into such claims. No I/O: sources and a read-only snapshot in,
 * a plan and SQL text out (unit-tested in `demo-figures-plan.test.mjs`).
 *
 * Why a seed and not the product: no product route publishes a dated,
 * network-visible company figure claim. `evidence.createClaim` refuses any
 * scope broader than private ("broader scopes are a later disclosure
 * decision"), the API has no claims route, and onboarding's financial
 * answers go through the Knowledge Write Gate as founder_private, one value
 * per step, with no history. So this follows the owner-approved
 * `demo-companies/seed.mjs` pattern: deterministic ids, idempotent
 * plan/apply, one transaction per company.
 *
 * Rules, by construction:
 * - only FICTIONAL companies: the same refusal as demo-activate
 *   (`refusalsFor`): not a demonstration company, a current member, and
 *   every attached person a fictional account; plus the production name
 *   must equal the source's name;
 * - every value is one the company's own seed source states. Nothing is
 *   interpolated, extrapolated, converted between currencies or filled; a
 *   value the source lacks is skipped (unknown stays unknown);
 * - a time series is the CONSECUTIVE MONTHLY TAIL of the source's own
 *   dated points ending at its latest (current) value: at least 3 and at
 *   most 6 points; with fewer, only the latest point is published;
 * - truth class USER_CLAIM, evidence status SELF_REPORTED, lifecycle
 *   CURRENT (each point is the company's live statement about its own
 *   month), visibility network_visible, sensitivity NETWORK_VISIBLE;
 * - the statement says "Demonstration data, self-reported by the company",
 *   and the source row and audit metadata carry the provenance;
 * - a figure already published for the same key and date is left alone
 *   when equal, and reported (never overwritten, never "resolved") when it
 *   differs: contradictions coexist until reconciled by a person.
 */
import { createHash } from "node:crypto";

import { refusalsFor } from "./demo-activate-plan.mjs";

export const SEED_KEY = "demo-figures.v1";
export const TAVUS_SOURCE_FILE = "docs/seed/tavus-20/companies-full.json";
export const DEV_WORLD_SOURCE_FILE =
  "apps/q-api/src/dev/fictional-world/companies.ts";
export const DEMO_STATEMENT_SUFFIX =
  " (Demonstration data, self-reported by the company.)";
/** read_company_figures returns at most this many figures per company. */
export const READ_FIGURES_MAX = 40;
export const SERIES_MIN = 3;
export const SERIES_MAX = 6;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Deterministic UUID (v5-shaped) so a re-run targets the same rows. */
export function seedUuid(...parts) {
  const h = createHash("sha256")
    .update([SEED_KEY, ...parts].join("\u0000"))
    .digest("hex");
  const v = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${v}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// ------------------------------------------------------------ numbers and dates

/** "YYYY-MM" -> "YYYY-MM-DD" of that month's last day. */
export function monthEnd(period) {
  const m = /^(\d{4})-(\d{2})$/u.exec(period);
  if (m === null) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${m[1]}-${m[2]}-${String(last).padStart(2, "0")}`;
}

/** The month before "YYYY-MM". */
export function previousPeriod(period) {
  const [y, m] = period.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/**
 * A finite number as a plain decimal string, shifted by `scale` powers of
 * ten (a stated "₦82m" is 82 with scale 6). Exact: digits move, nothing is
 * rounded. Null for anything that is not a finite, non-negative number.
 */
export function decimalOf(value, scale = 0) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  const text = String(value);
  if (/e/iu.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const digits = `${whole}${fraction}`;
  const point = whole.length + scale;
  const padded = digits.padEnd(point, "0");
  const intPart = padded.slice(0, point).replace(/^0+(?=\d)/u, "");
  const fracPart = padded.slice(point).replace(/0+$/u, "");
  return fracPart.length === 0 ? intPart : `${intPart}.${fracPart}`;
}

export function groupDecimal(amount) {
  const [whole, fraction] = amount.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

const monthWords = (asOf) => {
  const [y, m] = asOf.split("-");
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
};

// ------------------------------------------------------------ tavus-20 source

/** How a tavus-20 KPI unit becomes a chartable claim kind. */
const UNIT_KINDS = {
  money: { kind: "MONEY", scale: 0 },
  money_millions: { kind: "MONEY", scale: 6 },
  money_billions: { kind: "MONEY", scale: 9 },
  count: { kind: "COUNT", scale: 0 },
  count_millions: { kind: "COUNT", scale: 6 },
  percent: { kind: "PERCENT", scale: 0 },
};

/**
 * The claim key a KPI is published under. The well-known revenue keys the
 * chart and compare table already name (financial.mrr, .monthly_revenue,
 * .arr, .nrr) where the KPI's own label says exactly that; otherwise the
 * KPI's own code under financial (money) or traction.
 */
export function claimKeyFor(kpi) {
  const label = String(kpi.label ?? "").toLowerCase();
  if (kpi.code === "mrr" && label === "monthly recurring revenue")
    return "financial.mrr";
  if (
    (kpi.code === "mrr" || kpi.code === "revenue_month") &&
    (label === "monthly revenue" || label === "revenue in month")
  )
    return "financial.monthly_revenue";
  if (kpi.code === "arr") return "financial.arr";
  if (kpi.code === "nrr_pct") return "financial.nrr";
  const kind = UNIT_KINDS[kpi.unit]?.kind;
  return `${kind === "MONEY" ? "financial" : "traction"}.${kpi.code}`;
}

/**
 * The consecutive monthly tail of dated points ending at the latest one
 * that states this KPI. Points without the value break the tail (unknown
 * is never filled).
 */
export function monthlyTail(points, code) {
  const dated = points
    .filter((p) => /^\d{4}-\d{2}$/u.test(p.period ?? ""))
    .toSorted((a, b) => a.period.localeCompare(b.period));
  const tail = [];
  for (let i = dated.length - 1; i >= 0; i -= 1) {
    const point = dated[i];
    const value = point.values?.[code];
    if (typeof value !== "number" || !Number.isFinite(value)) break;
    const next = tail[0];
    if (next !== undefined && previousPeriod(next.period) !== point.period)
      break;
    tail.unshift({ period: point.period, asOf: point.asOf, value });
    if (tail.length === SERIES_MAX) break;
  }
  if (tail.length === 0) return [];
  return tail.length >= SERIES_MIN ? tail : tail.slice(-1);
}

/** Every chartable metric a tavus-20 company states, as figure specs. */
export function tavusFigures(company) {
  const source = `${TAVUS_SOURCE_FILE} #${company.n} metrics.points`;
  const figures = [];
  const skipped = [];
  for (const kpi of company.metrics?.kpis ?? []) {
    const unit = UNIT_KINDS[kpi.unit];
    if (unit === undefined) {
      skipped.push(`${kpi.code}: unit ${kpi.unit} has no chartable kind`);
      continue;
    }
    if (unit.kind === "MONEY" && !/^[A-Z]{3}$/u.test(kpi.currency ?? "")) {
      skipped.push(`${kpi.code}: money without an ISO currency`);
      continue;
    }
    const tail = monthlyTail(company.metrics.points ?? [], kpi.code);
    const points = [];
    for (const p of tail) {
      const asOf = monthEnd(p.period);
      const decimal = decimalOf(p.value, unit.scale);
      if (asOf === null || decimal === null) continue;
      points.push({ period: p.period, asOf, decimal });
    }
    if (points.length === 0) {
      skipped.push(`${kpi.code}: no stated value`);
      continue;
    }
    figures.push({
      key: claimKeyFor(kpi),
      type: unit.kind === "MONEY" ? "financial" : "traction",
      label: kpi.label,
      kind: unit.kind,
      currency: unit.kind === "MONEY" ? kpi.currency : null,
      sourceFile: TAVUS_SOURCE_FILE,
      points,
      provenance:
        points.length === 1
          ? `demo figure stated in ${source} (period ${points[0].period}); the source's own latest value`
          : `demo series stated in ${source} (periods ${points[0].period}..${points.at(-1).period}); rule: the consecutive monthly tail of the source's own dated points ending at its latest value, ${SERIES_MIN}-${SERIES_MAX} points, nothing interpolated`,
    });
  }
  return { figures, skipped };
}

// ------------------------------------------------------------ dev fictional world

/**
 * A single month-year the statement names as its date, as that month's
 * last day. "since August 2025" is a start, not an as-of date: ignored.
 */
export function statedMonth(statement) {
  const months = [
    ...String(statement).matchAll(
      /(?<!\bsince )\b(January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})\b/gu,
    ),
  ].map(
    ([, name, year]) =>
      `${year}-${String(MONTH_NAMES.indexOf(name) + 1).padStart(2, "0")}`,
  );
  const distinct = [...new Set(months)];
  return distinct.length === 1 ? monthEnd(distinct[0]) : null;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

/**
 * The dev world's (apps/q-api/src/dev/fictional-world/companies.ts) stated
 * figures: each CURRENT, structured MONEY/COUNT/PERCENT claim, as ONE
 * point (the world states no history). Its date is the claim's own asOf,
 * else the single month its statement names, else its "YYYY-MM" period,
 * else none (undated, never guessed). Market sizes, UNKNOWN or
 * CONTRADICTORY claims and unstructured ones are skipped.
 */
export function devWorldFigures(company) {
  const source = `${DEV_WORLD_SOURCE_FILE} ${company.key} claims`;
  const figures = [];
  const skipped = [];
  for (const claim of company.claims ?? []) {
    const value = claim.structuredValue;
    const kind = value?.kind;
    const why =
      claim.truthClass === "UNKNOWN"
        ? "unknown"
        : (claim.lifecycleStatus ?? "CURRENT") !== "CURRENT"
          ? `lifecycle ${claim.lifecycleStatus} (a contradiction is never published as current)`
          : claim.claimKey.startsWith("market.")
            ? "a market size, not a company figure"
            : !["MONEY", "COUNT", "PERCENT"].includes(kind)
              ? `no chartable value (${kind ?? "unstructured"})`
              : null;
    if (why !== null) {
      skipped.push(`${claim.claimKey}: ${why}`);
      continue;
    }
    const decimal =
      kind === "MONEY"
        ? /^\d+(?:\.\d+)?$/u.test(String(value.amount ?? ""))
          ? String(value.amount)
          : null
        : typeof value.value === "number"
          ? decimalOf(value.value)
          : /^\d+(?:\.\d+)?$/u.test(String(value.value ?? ""))
            ? String(value.value)
            : null;
    if (decimal === null) {
      skipped.push(`${claim.claimKey}: no stated value`);
      continue;
    }
    if (kind === "MONEY" && !/^[A-Z]{3}$/u.test(value.currency ?? "")) {
      skipped.push(`${claim.claimKey}: money without an ISO currency`);
      continue;
    }
    const periodMonth =
      typeof value.period === "string" && /^\d{4}-\d{2}$/u.test(value.period)
        ? monthEnd(value.period)
        : null;
    const asOf =
      (typeof value.asOf === "string" && DATE.test(value.asOf)
        ? value.asOf
        : null) ??
      statedMonth(claim.statement) ??
      periodMonth;
    figures.push({
      key: claim.claimKey,
      type: claim.claimType,
      label: null,
      statement: claim.statement,
      kind,
      currency: kind === "MONEY" ? value.currency : null,
      sourceFile: DEV_WORLD_SOURCE_FILE,
      period:
        typeof value.period === "string" && periodMonth === null
          ? value.period
          : null,
      points: [{ period: asOf?.slice(0, 7) ?? null, asOf, decimal }],
      provenance: `demo figure stated in ${source} (${claim.claimKey}); the source's own value, ${asOf === null ? "undated (the source gives no date)" : `dated ${asOf} from the source`}`,
    });
  }
  return { figures, skipped };
}

// ------------------------------------------------------------ the plan

function statementFor(company, figure, point) {
  if (figure.statement !== undefined && figure.points.length === 1) {
    return figure.statement.endsWith(DEMO_STATEMENT_SUFFIX)
      ? figure.statement
      : `${figure.statement.replace(/\s+$/u, "")}${DEMO_STATEMENT_SUFFIX}`;
  }
  const amount =
    figure.kind === "MONEY"
      ? `${figure.currency} ${groupDecimal(point.decimal)}`
      : figure.kind === "PERCENT"
        ? `${point.decimal}%`
        : groupDecimal(point.decimal);
  const when = point.asOf === null ? "" : ` in ${monthWords(point.asOf)}`;
  return `${company}: ${figure.label ?? figure.key}: ${amount}${when}.${DEMO_STATEMENT_SUFFIX}`;
}

function structuredValueFor(figure, point) {
  const base =
    figure.kind === "MONEY"
      ? { kind: "MONEY", amount: point.decimal, currency: figure.currency }
      : { kind: figure.kind, value: Number(point.decimal) };
  return {
    ...base,
    ...(point.asOf === null ? {} : { asOf: point.asOf }),
    ...(figure.period ? { period: figure.period } : {}),
  };
}

const sameValue = (a, b) =>
  a !== null &&
  b !== null &&
  typeof a === "object" &&
  typeof b === "object" &&
  a.kind === b.kind &&
  (a.kind === "MONEY"
    ? String(a.amount) === String(b.amount) && a.currency === b.currency
    : Number(a.value) === Number(b.value));

const dayOf = (raw) =>
  typeof raw === "string"
    ? (/^(\d{4}-\d{2}-\d{2})/u.exec(raw)?.[1] ?? null)
    : null;

const PUBLISHED = new Set(["network_visible", "public_external"]);

/**
 * One company's plan from its sources and a read-only snapshot
 * ({ company, people, claims: [{ id, claim_key, structured_value,
 * valid_from, visibility_scope, lifecycle_status }] }).
 */
export function planCompanyFigures(entry, snapshot, sourced) {
  const base = {
    companyId: entry.companyId,
    name: entry.name,
    source: entry.source,
  };
  const refusals = refusalsFor(entry, snapshot);
  if (snapshot?.company) {
    const live = String(snapshot.company.canonical_name ?? "").trim();
    if (live.toLowerCase() !== entry.name.trim().toLowerCase())
      refusals.push(
        `production name "${live}" is not the source's "${entry.name}"`,
      );
    if (snapshot.company.company_status !== "active")
      refusals.push(`company_status ${snapshot.company.company_status}`);
  }
  if (refusals.length > 0) return { ...base, refused: refusals };

  const existing = snapshot.claims ?? [];
  const byId = new Set(existing.map((c) => c.id));
  const claims = [];
  const notes = [...sourced.skipped.map((s) => `skipped ${s}`)];
  for (const figure of sourced.figures) {
    figure.points.forEach((point, index) => {
      const value = structuredValueFor(figure, point);
      const id = seedUuid(
        entry.companyId,
        "claim",
        figure.key,
        point.asOf ?? "undated",
      );
      if (byId.has(id)) return; // already published by this seed
      const clash = existing.find(
        (c) =>
          c.claim_key === figure.key &&
          c.lifecycle_status === "CURRENT" &&
          PUBLISHED.has(c.visibility_scope) &&
          (dayOf(c.valid_from) ?? dayOf(c.structured_value?.asOf)) ===
            point.asOf,
      );
      if (clash !== undefined) {
        notes.push(
          sameValue(clash.structured_value, value)
            ? `kept ${figure.key} ${point.asOf ?? "undated"}: already published with the same value`
            : `NOT published ${figure.key} ${point.asOf ?? "undated"}: a different value is already published for that date (contradiction left for a person)`,
        );
        return;
      }
      claims.push({
        id,
        revisionId: seedUuid(
          entry.companyId,
          "revision",
          figure.key,
          point.asOf ?? "undated",
        ),
        sourceId: seedUuid(
          entry.companyId,
          "source",
          figure.key,
          point.asOf ?? "undated",
        ),
        itemId: seedUuid(
          entry.companyId,
          "item",
          figure.key,
          point.asOf ?? "undated",
        ),
        key: figure.key,
        type: figure.type,
        statement: statementFor(entry.name, figure, point).slice(0, 2000),
        value,
        validFrom: point.asOf,
        // Newest point listed first by readers that order by asserted_at.
        assertOffsetSeconds: figure.points.length - 1 - index,
        provenance: figure.provenance,
        sourceFile: figure.sourceFile,
        seriesLength: figure.points.length,
      });
    });
  }
  const published = existing.filter(
    (c) =>
      c.lifecycle_status === "CURRENT" && PUBLISHED.has(c.visibility_scope),
  ).length;
  if (published + claims.length > READ_FIGURES_MAX)
    notes.push(
      `WARNING ${published + claims.length} published figures exceed read_company_figures' ${READ_FIGURES_MAX}; some would not be read`,
    );
  return {
    ...base,
    tenantId: snapshot.company.tenant_id,
    organisationId: snapshot.company.organisation_id,
    claims,
    notes,
  };
}

// ------------------------------------------------------------ SQL

export const lit = (v) => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("non-finite number");
    return String(v);
  }
  return `'${String(v).replace(/'/g, "''")}'`;
};
const json = (v) => `${lit(JSON.stringify(v))}::jsonb`;

/**
 * One transaction for one company's plan; null when there is nothing to do.
 * Audit: the actor is the Capital Q system (actor_type capital_q_system,
 * actor_id and authority_user_id null; audit.material_actions requires a
 * human authority only for actor_type q), never a person: no person
 * performed or approved these rows individually. The metadata names the
 * seed and the source file instead.
 */
export function renderFiguresSql(plan, { now }) {
  if (plan.refused || plan.claims.length === 0) return null;
  const t = lit(plan.tenantId);
  const c = lit(plan.companyId);
  const correlation = seedUuid(plan.companyId, "correlation", now);
  const at = (offset) =>
    new Date(new Date(now).getTime() - offset * 1000).toISOString();
  const s = ["begin;"];
  for (const cp of plan.claims) {
    const validFrom =
      cp.validFrom === null ? "null" : `${lit(cp.validFrom)}::timestamptz`;
    const meta = {
      seed: SEED_KEY,
      sourceFile: cp.sourceFile,
      demonstrationData: true,
      provenance: cp.provenance.slice(0, 900),
    };
    const eventId = seedUuid(plan.companyId, "event", cp.id, now);
    s.push(
      `insert into evidence.sources (id, tenant_id, source_type, subject_type, subject_id, provider, title, created_by_user_id, retrieved_at, reliability_class, visibility_scope, sensitivity_class, metadata) values (${lit(cp.sourceId)}, ${t}, 'USER_STATEMENT', 'COMPANY', ${c}, 'demo_seed', 'Company statement (demonstration data)', null, ${lit(now)}, 'USER_STATEMENT', 'network_visible', 'NETWORK_VISIBLE', ${json(meta)}) on conflict (id) do nothing;`,
      `insert into evidence.evidence_items (id, tenant_id, source_id, subject_type, subject_id, evidence_type, summary, structured_value, locator, evidence_status, reliability_class, visibility_scope, sensitivity_class, created_by_user_id) values (${lit(cp.itemId)}, ${t}, ${lit(cp.sourceId)}, 'COMPANY', ${c}, 'user_statement.reported_fact', ${lit(cp.statement.slice(0, 500))}, ${json(cp.value)}, ${json({ kind: "statement" })}, 'SELF_REPORTED', 'USER_STATEMENT', 'network_visible', 'NETWORK_VISIBLE', null) on conflict (id) do nothing;`,
      `insert into evidence.claim_revisions (id, tenant_id, claim_id, revision_number, statement, structured_value, truth_class, evidence_status, lifecycle_status, valid_from, changed_by_type, changed_by_id, source_id) values (${lit(cp.revisionId)}, ${t}, ${lit(cp.id)}, 1, ${lit(cp.statement)}, ${json(cp.value)}, 'USER_CLAIM', 'SELF_REPORTED', 'CURRENT', ${validFrom}, 'SOURCE', ${lit(cp.sourceId)}, ${lit(cp.sourceId)}) on conflict (id) do nothing;`,
      `insert into evidence.claims (id, tenant_id, subject_type, subject_id, claim_type, claim_key, statement, structured_value, asserted_by_type, asserted_by_id, asserted_at, valid_from, truth_class, evidence_status, lifecycle_status, visibility_scope, sensitivity_class, current_revision_id, current_revision_number) values (${lit(cp.id)}, ${t}, 'COMPANY', ${c}, ${lit(cp.type)}, ${lit(cp.key)}, ${lit(cp.statement)}, ${json(cp.value)}, 'SOURCE', ${lit(cp.sourceId)}, ${lit(at(cp.assertOffsetSeconds))}, ${validFrom}, 'USER_CLAIM', 'SELF_REPORTED', 'CURRENT', 'network_visible', 'NETWORK_VISIBLE', ${lit(cp.revisionId)}, 1) on conflict (id) do nothing;`,
      `insert into evidence.claim_evidence (tenant_id, claim_id, evidence_item_id, relationship, created_by_user_id) values (${t}, ${lit(cp.id)}, ${lit(cp.itemId)}, 'SUPPORTS', null) on conflict do nothing;`,
      `insert into audit.material_actions (event_id, tenant_id, actor_type, actor_id, authority_user_id, organisation_id, action_type, resource_type, resource_id, occurred_at, outcome, metadata, correlation_id) values (${lit(seedUuid(plan.companyId, "audit", cp.id, now))}, ${t}, 'capital_q_system', null, null, ${lit(plan.organisationId)}, 'claim.created', 'claim', ${lit(cp.id)}, ${lit(now)}, 'SUCCEEDED', ${json({ claimKey: cp.key, truthClass: "USER_CLAIM", evidenceStatus: "SELF_REPORTED", ...meta })}, ${lit(correlation)}) on conflict do nothing;`,
      `insert into events.outbox (event_id, tenant_id, event_type, event_version, payload) values (${lit(eventId)}, ${t}, 'evidence.claim.changed', 1, ${json(
        {
          specVersion: "1.0",
          id: eventId,
          type: "evidence.claim.changed",
          source: "capitalq://api/evidence",
          time: now,
          subject: `claim/${cp.id}`,
          dataContentType: "application/json",
          eventVersion: 1,
          tenantId: plan.tenantId,
          organisationId: plan.organisationId,
          actor: { type: "SYSTEM" },
          aggregate: { type: "claim", id: cp.id, version: 1 },
          correlationId: `cor_${correlation}`,
          data: {
            claimId: cp.id,
            subjectId: plan.companyId,
            changeKind: "CREATED",
            subjectType: "COMPANY",
            revisionNumber: 1,
          },
        },
      )}) on conflict (event_id) do nothing;`,
    );
  }
  s.push("commit;");
  return s.join("\n");
}

// ------------------------------------------------------------ report

export function renderFiguresPlan(plans) {
  const lines = [];
  let companies = 0;
  let metrics = 0;
  let points = 0;
  for (const p of plans) {
    lines.push(`\n${p.name}  ${p.companyId}  [${p.source}]`);
    if (p.refused) {
      for (const r of p.refused) lines.push(`  REFUSED  ${r}`);
      continue;
    }
    const byKey = new Map();
    for (const cp of p.claims) {
      const list = byKey.get(cp.key) ?? [];
      list.push(cp);
      byKey.set(cp.key, list);
    }
    if (byKey.size > 0) companies += 1;
    metrics += byKey.size;
    points += p.claims.length;
    for (const [key, list] of byKey) {
      const first = list[0];
      const unit =
        first.value.kind === "MONEY"
          ? first.value.currency
          : first.value.kind.toLowerCase();
      const pts = list
        .map(
          (cp) =>
            `${cp.validFrom ?? "undated"}=${cp.value.amount ?? cp.value.value}`,
        )
        .join(", ");
      lines.push(
        `  ${key.padEnd(36)} ${unit.padEnd(7)} network_visible USER_CLAIM/SELF_REPORTED  ${pts}`,
      );
      lines.push(`      provenance: ${first.provenance}`);
    }
    for (const n of p.notes) lines.push(`  note  ${n}`);
  }
  lines.push(
    `\nSummary: ${companies} companies, ${metrics} metrics, ${points} claims (points) to publish; ${plans.filter((p) => p.refused).length} refused.`,
  );
  return lines.join("\n");
}
