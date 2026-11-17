/**
 * Pure planning for `revenue-claims.mjs` (17 Nov 2026: investors asking Q
 * "show me the pre-revenue ones" got "whether they have revenue isn't on
 * record" for demo companies whose revenue lives only in their seeded
 * evidence documents).
 *
 * For each company in the evidence fixtures it plans ONE revenue claim,
 * from the fixture's own latest actual month, linked to the uploaded
 * document version that states it:
 *
 *   financial.monthly_revenue  {kind MONEY, amount, currency, asOf}  the
 *                              latest actual month's stated total, > 0
 *   financial.revenue_status   {kind STATUS, code PRE_REVENUE}       only
 *                              when EVERY actual month states a total of 0
 *
 * A latest month of 0 after earlier revenue is neither: left unknown.
 * truth_class USER_CLAIM, evidence_status DOCUMENT_SUPPORTED, lifecycle
 * CURRENT, visibility network_visible, sensitivity NETWORK_VISIBLE -- the
 * shape read_company_figures returns to an investor and revenueStateOf
 * reads as HAS_REVENUE / PRE_REVENUE.
 *
 * Context Firewall gate, by construction: a claim is planned at
 * network_visible ONLY when its source document is itself readable there
 * (its `evidence.documents.visibility_scope` is network_visible or
 * public_external AND its sensitivity is PUBLIC or NETWORK_VISIBLE).
 * Otherwise NOTHING is written -- not even at the document's own scope:
 * an organisation-private figure from a document is the A8 path's job,
 * which files it as a card for the founder to confirm. The data-room level
 * is reported, never used: a level never widens anything derived from the
 * document (ADR 0041 section 3; packages/contracts/src/http/data-room.ts),
 * so a PUBLIC data-room entry over an organisation_private document still
 * yields nothing, and SHARED_ONLY never does.
 *
 * Idempotent: deterministic ids; a claim already written is skipped, and a
 * different published value for the same key and date is reported, never
 * overwritten (contradictions coexist until a person reconciles them).
 * No I/O here: fixtures, manifests and a read-only snapshot in; a plan and
 * SQL text out (tested in apps/workers/test/demo-revenue-claims.test.ts).
 */
import { createHash } from "node:crypto";

export const SEED_KEY = "demo-revenue-claims.v1";
export const DEMO_STATEMENT_SUFFIX =
  " (Demonstration data, stated in the company's own document.)";
export const MONTHLY_REVENUE_KEY = "financial.monthly_revenue";
export const REVENUE_STATUS_KEY = "financial.revenue_status";
/** Provenance marker on the DOCUMENT source, one per document version. */
export const SOURCE_REFERENCE_PREFIX = "demo-revenue-claims:";

/** Scopes a published company figure may carry (read_company_figures). */
const READABLE_SCOPES = new Set(["network_visible", "public_external"]);
/** Sensitivities read_company_figures admits for a network reader. */
const READABLE_SENSITIVITY = new Set(["PUBLIC", "NETWORK_VISIBLE"]);
/** Document types that state the monthly revenue total, preferred first. */
const SOURCE_TYPES = ["MANAGEMENT_ACCOUNTS", "FINANCIAL"];

const MONTHS = [
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

/** "YYYY-MM" -> that month's last day, "YYYY-MM-DD". */
export function monthEnd(period) {
  const m = /^(\d{4})-(\d{2})$/u.exec(String(period));
  if (m === null) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const last = new Date(Date.UTC(Number(m[1]), month, 0)).getUTCDate();
  return `${m[1]}-${m[2]}-${String(last).padStart(2, "0")}`;
}

const group = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
const monthWords = (period) =>
  `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;

/**
 * What the fixture itself states about revenue: the latest actual month's
 * total, or pre-revenue when every actual month states 0. Null (unknown)
 * otherwise. Only whole, non-negative stated numbers count.
 */
export function revenueFigureOf(fixture) {
  const actuals = (Array.isArray(fixture?.actuals) ? fixture.actuals : [])
    .filter(
      (a) =>
        /^\d{4}-\d{2}$/u.test(a?.month ?? "") &&
        Number.isSafeInteger(a?.revenue?.total) &&
        a.revenue.total >= 0,
    )
    .toSorted((a, b) => a.month.localeCompare(b.month));
  const currency = fixture?.currency;
  if (actuals.length === 0 || !/^[A-Z]{3}$/u.test(currency ?? "")) return null;
  const latest = actuals.at(-1);
  const asOf = monthEnd(latest.month);
  if (latest.revenue.total > 0)
    return {
      key: MONTHLY_REVENUE_KEY,
      period: latest.month,
      asOf,
      value: {
        kind: "MONEY",
        amount: String(latest.revenue.total),
        currency,
        asOf,
      },
      words: `revenue in ${monthWords(latest.month)}: ${currency} ${group(String(latest.revenue.total))}`,
    };
  if (actuals.every((a) => a.revenue.total === 0))
    return {
      key: REVENUE_STATUS_KEY,
      period: latest.month,
      asOf,
      value: { kind: "STATUS", code: "PRE_REVENUE", asOf },
      words: `pre-revenue (no revenue in any month from ${monthWords(actuals[0].month)} to ${monthWords(latest.month)})`,
    };
  return null;
}

/** Manifest documents that state the month's total, in preference order. */
export function candidateDocuments(manifest, period) {
  return (manifest?.documents ?? [])
    .filter(
      (d) =>
        SOURCE_TYPES.includes(d.documentType) &&
        typeof d.period?.from === "string" &&
        typeof d.period?.to === "string" &&
        d.period.from <= period &&
        period <= d.period.to,
    )
    .toSorted(
      (a, b) =>
        SOURCE_TYPES.indexOf(a.documentType) -
          SOURCE_TYPES.indexOf(b.documentType) ||
        Number(b.fileName.endsWith(".pdf")) -
          Number(a.fileName.endsWith(".pdf")) ||
        a.fileName.localeCompare(b.fileName),
    );
}

/** Whether a document's own scope and sensitivity admit a network claim. */
export function documentAdmitsNetwork(doc) {
  return (
    READABLE_SCOPES.has(doc.visibility_scope) &&
    READABLE_SENSITIVITY.has(doc.sensitivity_class)
  );
}

const dayOf = (raw) =>
  typeof raw === "string"
    ? (/^(\d{4}-\d{2}-\d{2})/u.exec(raw)?.[1] ?? null)
    : null;

const sameValue = (a, b) =>
  a !== null &&
  b !== null &&
  typeof a === "object" &&
  typeof b === "object" &&
  a.kind === b.kind &&
  (a.kind === "MONEY"
    ? String(a.amount) === String(b.amount) && a.currency === b.currency
    : String(a.code) === String(b.code));

/**
 * One company's plan. `snapshot` (read-only, from production):
 * { company: { id, tenant_id, organisation_id, canonical_name,
 *   company_status }, documents: [{ file, document_id, version_id, title,
 *   visibility_scope, sensitivity_class, status, level }], claims: [{ id,
 *   claim_key, structured_value, valid_from, visibility_scope,
 *   lifecycle_status }] }.
 */
export function planRevenueClaim({ key, fixture, manifest }, snapshot) {
  const name = fixture?.company?.name ?? key;
  const base = { key, name, companyId: snapshot?.company?.id ?? null };
  const refused = [];
  if (manifest?.companyKey !== key) refused.push("no evidence manifest");
  else if (manifest.synthetic !== true)
    refused.push("manifest is not marked synthetic");
  if (!snapshot?.company) refused.push("company not found in production");
  else {
    const live = String(snapshot.company.canonical_name ?? "").trim();
    if (live.toLowerCase() !== name.trim().toLowerCase())
      refused.push(`production name "${live}" is not the fixture's "${name}"`);
    if (manifest?.companyId && manifest.companyId !== snapshot.company.id)
      refused.push(`production id is not the manifest's ${manifest.companyId}`);
    if (snapshot.company.company_status !== "active")
      refused.push(`company_status ${snapshot.company.company_status}`);
  }
  if (refused.length > 0) return { ...base, refused };

  const figure = revenueFigureOf(fixture);
  if (figure === null)
    return {
      ...base,
      claim: null,
      skipped: "the fixture states no current revenue figure (left unknown)",
    };

  const existing = snapshot.claims ?? [];
  const published = existing.filter(
    (c) =>
      c.lifecycle_status === "CURRENT" &&
      READABLE_SCOPES.has(c.visibility_scope) &&
      /(?:^|[._])(?:revenue|mrr|arr|sales|gmv)(?:[._]|$)/u.test(c.claim_key),
  );
  const notes =
    published.length > 0
      ? [
          `already publishes revenue figures: ${[...new Set(published.map((c) => c.claim_key))].join(", ")}`,
        ]
      : [];

  const live = new Map(
    (snapshot.documents ?? [])
      .filter((d) => d.status === "ACTIVE")
      .map((d) => [d.file, d]),
  );
  const candidates = candidateDocuments(manifest, figure.period)
    .map((m) => ({ manifest: m, live: live.get(m.fileName) }))
    .filter((c) => c.live !== undefined);
  if (candidates.length === 0)
    return {
      ...base,
      figure,
      claim: null,
      notes,
      skipped: `no uploaded document states ${figure.period} (write nothing)`,
    };
  const source = candidates.find((c) => documentAdmitsNetwork(c.live));
  if (source === undefined)
    return {
      ...base,
      figure,
      claim: null,
      notes,
      skipped: `write nothing: every source document is narrower than network_visible (${candidates
        .map(
          (c) =>
            `${c.manifest.fileName} ${c.live.visibility_scope}/${c.live.sensitivity_class}, data-room ${c.live.level ?? "none"}`,
        )
        .join(
          "; ",
        )}); a data-room level never widens what is derived from a document`,
    };

  const doc = source.live;
  const id = seedUuid(base.companyId, "claim", figure.key, figure.asOf);
  if (existing.some((c) => c.id === id))
    return { ...base, figure, claim: null, notes, skipped: "already written" };
  const clash = published.find(
    (c) =>
      c.claim_key === figure.key &&
      (dayOf(c.valid_from) ?? dayOf(c.structured_value?.asOf)) === figure.asOf,
  );
  if (clash !== undefined)
    return {
      ...base,
      figure,
      claim: null,
      notes,
      skipped: sameValue(clash.structured_value, figure.value)
        ? "already published with the same value"
        : "a different value is already published for that date (contradiction left for a person)",
    };

  const title = String(doc.title ?? source.manifest.title).slice(0, 160);
  return {
    ...base,
    tenantId: snapshot.company.tenant_id,
    organisationId: snapshot.company.organisation_id,
    figure,
    notes,
    claim: {
      id,
      revisionId: seedUuid(base.companyId, "revision", id),
      sourceId: seedUuid(base.companyId, "source", doc.version_id),
      itemId: seedUuid(base.companyId, "item", id),
      key: figure.key,
      value: figure.value,
      validFrom: figure.asOf,
      statement:
        `${name}: ${figure.words}, as stated in "${title}".${DEMO_STATEMENT_SUFFIX}`.slice(
          0,
          2000,
        ),
      scope: "network_visible",
      document: {
        file: source.manifest.fileName,
        documentId: doc.document_id,
        versionId: doc.version_id,
        title,
        scope: doc.visibility_scope,
      },
    },
  };
}

// ------------------------------------------------------------ SQL

export const lit = (v) => {
  if (v === null || v === undefined) return "null";
  return `'${String(v).replace(/'/g, "''")}'`;
};
const json = (v) => `${lit(JSON.stringify(v))}::jsonb`;

/**
 * One transaction for one planned claim; null when nothing is planned. The
 * same rows demo-figures writes (source, evidence item, revision, claim,
 * claim_evidence, audit, outbox), with a DOCUMENT source on the exact
 * document version and DOCUMENT_SUPPORTED evidence. The actor is the
 * Capital Q system: no person performed or approved these rows.
 */
export function renderRevenueSql(plan, { now }) {
  if (plan.refused || plan.claim === null || plan.claim === undefined)
    return null;
  const cp = plan.claim;
  const t = lit(plan.tenantId);
  const c = lit(plan.companyId);
  const meta = {
    seed: SEED_KEY,
    demonstrationData: true,
    documentId: cp.document.documentId,
    documentVersionId: cp.document.versionId,
    fixture: `scripts/seed/evidence/fixtures/${plan.key}.json`,
  };
  const locator = {
    kind: "document",
    documentId: cp.document.documentId,
    documentVersionId: cp.document.versionId,
  };
  const correlation = seedUuid(plan.companyId, "correlation", cp.id, now);
  const eventId = seedUuid(plan.companyId, "event", cp.id, now);
  return [
    "begin;",
    `insert into evidence.sources (id, tenant_id, source_type, subject_type, subject_id, provider, external_reference, title, created_by_user_id, retrieved_at, reliability_class, visibility_scope, sensitivity_class, metadata) values (${lit(cp.sourceId)}, ${t}, 'DOCUMENT', 'COMPANY', ${c}, 'demo_seed', ${lit(`${SOURCE_REFERENCE_PREFIX}${cp.document.versionId}`)}, ${lit(cp.document.title)}, null, ${lit(now)}, 'PRIMARY_UNVERIFIED', 'network_visible', 'NETWORK_VISIBLE', ${json(meta)}) on conflict (id) do nothing;`,
    `insert into evidence.evidence_items (id, tenant_id, source_id, subject_type, subject_id, evidence_type, summary, structured_value, locator, valid_from, evidence_status, reliability_class, visibility_scope, sensitivity_class, created_by_user_id) values (${lit(cp.itemId)}, ${t}, ${lit(cp.sourceId)}, 'COMPANY', ${c}, 'document.reported_fact', ${lit(cp.statement.slice(0, 500))}, ${json(cp.value)}, ${json(locator)}, ${lit(cp.validFrom)}::timestamptz, 'DOCUMENT_SUPPORTED', 'PRIMARY_UNVERIFIED', 'network_visible', 'NETWORK_VISIBLE', null) on conflict (id) do nothing;`,
    `insert into evidence.claim_revisions (id, tenant_id, claim_id, revision_number, statement, structured_value, truth_class, evidence_status, lifecycle_status, valid_from, changed_by_type, changed_by_id, source_id) values (${lit(cp.revisionId)}, ${t}, ${lit(cp.id)}, 1, ${lit(cp.statement)}, ${json(cp.value)}, 'USER_CLAIM', 'DOCUMENT_SUPPORTED', 'CURRENT', ${lit(cp.validFrom)}::timestamptz, 'SOURCE', ${lit(cp.sourceId)}, ${lit(cp.sourceId)}) on conflict (id) do nothing;`,
    `insert into evidence.claims (id, tenant_id, subject_type, subject_id, claim_type, claim_key, statement, structured_value, asserted_by_type, asserted_by_id, asserted_at, valid_from, truth_class, evidence_status, lifecycle_status, visibility_scope, sensitivity_class, current_revision_id, current_revision_number) values (${lit(cp.id)}, ${t}, 'COMPANY', ${c}, 'financial', ${lit(cp.key)}, ${lit(cp.statement)}, ${json(cp.value)}, 'SOURCE', ${lit(cp.sourceId)}, ${lit(now)}, ${lit(cp.validFrom)}::timestamptz, 'USER_CLAIM', 'DOCUMENT_SUPPORTED', 'CURRENT', 'network_visible', 'NETWORK_VISIBLE', ${lit(cp.revisionId)}, 1) on conflict (id) do nothing;`,
    `insert into evidence.claim_evidence (tenant_id, claim_id, evidence_item_id, relationship, created_by_user_id) values (${t}, ${lit(cp.id)}, ${lit(cp.itemId)}, 'SUPPORTS', null) on conflict do nothing;`,
    `insert into audit.material_actions (event_id, tenant_id, actor_type, actor_id, authority_user_id, organisation_id, action_type, resource_type, resource_id, occurred_at, outcome, metadata, correlation_id) values (${lit(seedUuid(plan.companyId, "audit", cp.id, now))}, ${t}, 'capital_q_system', null, null, ${lit(plan.organisationId)}, 'claim.created', 'claim', ${lit(cp.id)}, ${lit(now)}, 'SUCCEEDED', ${json({ claimKey: cp.key, truthClass: "USER_CLAIM", evidenceStatus: "DOCUMENT_SUPPORTED", ...meta })}, ${lit(correlation)}) on conflict do nothing;`,
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
    "commit;",
  ].join("\n");
}

// ------------------------------------------------------------ report

export function renderRevenuePlan(plans) {
  const lines = [];
  for (const p of plans) {
    lines.push(`\n${p.name}  ${p.companyId ?? "-"}  [${p.key}]`);
    if (p.refused) {
      for (const r of p.refused) lines.push(`  REFUSED  ${r}`);
      continue;
    }
    if (p.figure)
      lines.push(
        `  stated   ${p.figure.key} ${p.figure.period}: ${p.figure.words}`,
      );
    if (p.claim)
      lines.push(
        `  PLAN     ${p.claim.key} network_visible USER_CLAIM/DOCUMENT_SUPPORTED/CURRENT from ${p.claim.document.file} (version ${p.claim.document.versionId}, ${p.claim.document.scope})`,
      );
    else lines.push(`  SKIP     ${p.skipped}`);
    for (const n of p.notes ?? []) lines.push(`  note     ${n}`);
  }
  const planned = plans.filter((p) => p.claim).length;
  lines.push(
    `\nSummary: ${planned} claim(s) to write; ${plans.filter((p) => !p.refused && !p.claim).length} skipped; ${plans.filter((p) => p.refused).length} refused.`,
  );
  return lines.join("\n");
}
