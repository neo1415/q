/* global URL */
// P13: real companies as unclaimed public profiles. Pure planning only: this
// module turns docs/seed/real-companies/companies.json into the rows and the
// one transaction per company that seed.mjs runs. No I/O, no secrets.
//
//   one company  = one tenant + one organisation (the platform's 1:1 model)
//                  with NO members, so the F3 claim flow sees it as unclaimed
//                  and an approved claim can never reach another company
//   every fact   = source (URL, publisher, date) -> evidence item -> claim
//   truth_class  = USER_CLAIM (company-reported, relayed by press); never
//                  VERIFIED, evidence_status never EXTERNALLY/PLATFORM_VERIFIED
//   readiness    = not_assessed: these never enter Discover
//   unknown      = null; nothing is filled in
import { createHash } from "node:crypto";

export const SEED_KEY = "p13-real-companies-v1";

/** Deterministic UUID (v5-shaped) so a re-run targets the same rows. */
export function seedUuid(...parts) {
  const h = createHash("sha256")
    .update([SEED_KEY, ...parts].join("\u0000"))
    .digest("hex");
  const v = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${v}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const slugify = (s) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

const COUNTRY = {
  Nigeria: "NG",
  Kenya: "KE",
  Egypt: "EG",
  "United Kingdom": "GB",
  "United States": "US",
};

const STAGES = new Set([
  "pre_seed",
  "seed",
  "series_a",
  "series_b",
  "series_c_plus",
]);
/** A stage the vocabulary has, or unknown. "pre-series_a" is not one. */
export const stageCode = (s) => (s !== null && STAGES.has(s) ? s : null);

/**
 * Publisher, date and reliability per source URL. Dates only where the URL
 * or the page itself states them; otherwise unknown.
 */
const SOURCE_META = [
  [/thecondia\.com/, "The Condia", "CREDIBLE_EXTERNAL"],
  [/peopleofcolorintech\.com/, "People of Color in Tech", "SECONDARY_EXTERNAL"],
  [/techpoint\.africa/, "Techpoint Africa", "CREDIBLE_EXTERNAL"],
  [/techcabal\.com/, "TechCabal", "CREDIBLE_EXTERNAL"],
  [/ibsintelligence\.com/, "IBS Intelligence", "CREDIBLE_EXTERNAL"],
  [
    /africaprivateequitynews\.com/,
    "Africa Private Equity News",
    "CREDIBLE_EXTERNAL",
  ],
  [/intellinews\.com/, "bne IntelliNews", "CREDIBLE_EXTERNAL"],
  [/nextbillion\.net/, "NextBillion", "CREDIBLE_EXTERNAL"],
  [/citizen\.digital/, "Citizen Digital", "CREDIBLE_EXTERNAL"],
  [
    /flourishventures\.com/,
    "Flourish Ventures (investor)",
    "SECONDARY_EXTERNAL",
  ],
  [/techcrunch\.com/, "TechCrunch", "CREDIBLE_EXTERNAL"],
  [/tech\.eu/, "Tech.eu", "CREDIBLE_EXTERNAL"],
  [/fintech\.global/, "FinTech Global", "CREDIBLE_EXTERNAL"],
  [/crowdfundinsider\.com/, "Crowdfund Insider", "CREDIBLE_EXTERNAL"],
  [/ffnews\.com/, "FF News", "SECONDARY_EXTERNAL"],
  [
    /retailbankerinternational\.com/,
    "Retail Banker International",
    "CREDIBLE_EXTERNAL",
  ],
  [/builtinsf\.com/, "Built In SF", "CREDIBLE_EXTERNAL"],
  [/raising\.fi/, "raising.fi", "SECONDARY_EXTERNAL"],
  [/alleywatch\.com/, "AlleyWatch", "CREDIBLE_EXTERNAL"],
  [
    /businesswire\.com/,
    "Business Wire (company press release)",
    "PRIMARY_UNVERIFIED",
    "company",
  ],
  [/ycombinator\.com/, "Y Combinator company directory", "CREDIBLE_EXTERNAL"],
];
const KNOWN_DATES = {
  "https://www.retailbankerinternational.com/news/ekko-closes-a-2-5-million-funding-round/":
    "2024-05-16",
  "https://nextbillion.net/news/nigerias-koolboks-raises-11-million-to-scale-solar-powered-refrigeration-across-africa":
    "2025-08-29",
};

export function sourceMeta(url, company) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const own =
    company.website !== null &&
    new URL(company.website).hostname.replace(/^www\./, "") === host;
  if (own) {
    return {
      publisher: `${company.name} (company website)`,
      reliability: "PRIMARY_UNVERIFIED",
      companyOwn: true,
      publishedAt: null,
    };
  }
  const hit = SOURCE_META.find(([re]) => re.test(host));
  const dated =
    url.match(/\/(20\d\d)\/(\d\d)\/(\d\d)\//) ??
    url.match(/\/(20\d\d)(\d\d)(\d\d)\d+\//);
  return {
    publisher: hit?.[1] ?? host,
    reliability: hit?.[2] ?? "UNKNOWN",
    companyOwn: hit?.[3] === "company",
    publishedAt:
      KNOWN_DATES[url] ??
      (dated ? `${dated[1]}-${dated[2]}-${dated[3]}` : null),
  };
}

/** Sources that report the latest round (by URL; never every listed source). */
const ROUND_HINT =
  /(raise|seed|series|funding|round|secure|closes|gets|invested|million|-4-|11m|\$24m|4-3m|4mseed)/i;
const ROUND_EXTRA = {
  MoneyHash: [
    "https://techcrunch.com/2025/01/21/moneyhash-provides-single-access-to-payment-services-in-mena/",
  ],
  F2: [
    "https://alleywatch.com/2026/06/f2-f2-ai-private-credit-markets-deal-underwriting-analysis-platform-don-muir/",
  ],
};
export const roundSources = (c) =>
  c.sources.filter(
    (u) =>
      (ROUND_HINT.test(u) || (ROUND_EXTRA[c.name] ?? []).includes(u)) &&
      !/series-a$/.test(u),
  );

/** Evidence status from who supports it: company-only, one document, or several. */
export function evidenceStatusFor(
  urls,
  company,
  { companyReported = false } = {},
) {
  if (companyReported) return "SELF_REPORTED";
  const independent = urls.filter((u) => !sourceMeta(u, company).companyOwn);
  if (independent.length >= 2) return "MULTI_SOURCE_SUPPORTED";
  if (independent.length === 1) return "DOCUMENT_SUPPORTED";
  return "SELF_REPORTED";
}

const money = (m) => `${m.currency} ${m.amount.toLocaleString("en-US")}`;

/** Every claim for one company, each with the URLs that support it. */
export function claimsFor(c) {
  const out = [];
  const rounds = roundSources(c);
  const fact = (field) => c.fact_sources?.[field];
  if (c.founders?.length && rounds.length) {
    out.push({
      type: "team",
      key: "team.founders",
      statement: `Founders: ${c.founders.map((f) => `${f.name} (${f.title})`).join("; ")}.`,
      value: { kind: "FOUNDERS", founders: c.founders },
      // One article: not every outlet names every co-founder.
      urls: [rounds[0]],
    });
  }
  if (c.latest_round && rounds.length) {
    const r = c.latest_round;
    out.push({
      type: "funding",
      key: "funding.latest_round",
      statement: `Raised ${money(r)} announced ${r.date}${r.lead_investors?.length ? `, with ${r.lead_investors.join(", ")}` : ""}. Latest round found in public coverage, not necessarily the latest that exists.`,
      value: {
        kind: "ROUND",
        amount: String(r.amount),
        currency: r.currency,
        announcedOn: r.date,
        investors: r.lead_investors ?? [],
      },
      urls: rounds,
      validFrom: r.date,
    });
  }
  if (c.total_raised && rounds.length) {
    const t = c.total_raised;
    out.push({
      type: "funding",
      key: "funding.total_raised",
      statement: `Total raised ${money(t)} as of ${t.as_of} (company-reported).`,
      value: {
        kind: "TOTAL_RAISED",
        amount: String(t.amount),
        currency: t.currency,
        asOf: t.as_of,
      },
      urls: [rounds[0]],
      companyReported: true,
    });
  }
  (c.notable_public_metrics ?? []).forEach((m, i) => {
    out.push({
      type: "traction",
      key: `traction.public_metric_${i + 1}`,
      statement: m.metric,
      value: { kind: "REPORTED_METRIC", text: m.metric },
      urls: [m.source],
      companyReported: true,
    });
  });
  if (c.hq_city && fact("hq_city")) {
    out.push({
      type: "company",
      key: "company.headquarters",
      statement: `Headquartered in ${c.hq_city}, ${c.hq_country}.`,
      value: {
        kind: "HEADQUARTERS",
        city: c.hq_city,
        country: COUNTRY[c.hq_country] ?? null,
      },
      urls: [fact("hq_city")],
    });
  }
  if (c.founded_year && fact("founded_year")) {
    out.push({
      type: "company",
      key: "company.founded_year",
      statement: `Founded in ${c.founded_year}.`,
      value: { kind: "FOUNDED_YEAR", year: c.founded_year },
      urls: [fact("founded_year")],
    });
  }
  return out.map((claim) => ({
    ...claim,
    truthClass: "USER_CLAIM",
    evidenceStatus: evidenceStatusFor(claim.urls, c, {
      companyReported: claim.companyReported,
    }),
  }));
}

/** Taxonomy codes per company, curated from the sourced sector and model. */
export const TAXONOMY = {
  Duplo: {
    industry: ["fintech", "payments"],
    business_model: ["b2b_saas", "transaction_fee"],
    customer_type: ["enterprise", "business_customer"],
    geography: ["nigeria"],
  },
  Bumpa: {
    industry: ["ecommerce", "retail_technology"],
    business_model: ["b2b_saas"],
    customer_type: ["small_business"],
    geography: ["nigeria"],
  },
  Anchor: {
    industry: ["fintech", "banking", "embedded_payments"],
    business_model: ["usage_based"],
    customer_type: ["enterprise", "developer"],
    geography: ["nigeria"],
  },
  Koolboks: {
    industry: ["clean_energy", "energy_access"],
    business_model: ["hardware_sales", "services"],
    customer_type: ["small_business", "consumer"],
    geography: ["nigeria", "africa"],
  },
  HoneyCoin: {
    industry: ["fintech", "cross_border_payments", "payment_infrastructure"],
    business_model: ["transaction_fee", "usage_based"],
    customer_type: ["enterprise"],
    geography: ["kenya", "africa"],
  },
  MoneyHash: {
    industry: ["fintech", "payment_infrastructure"],
    business_model: ["transaction_fee", "usage_based"],
    customer_type: ["enterprise"],
    geography: ["egypt", "middle_east", "africa"],
  },
  Tangible: {
    industry: ["fintech", "financial_services"],
    business_model: ["b2b_saas", "services"],
    customer_type: ["business_customer"],
    geography: ["united_kingdom"],
  },
  ekko: {
    industry: ["fintech", "financial_services"],
    business_model: ["b2b_saas"],
    customer_type: ["financial_institution", "enterprise"],
    geography: ["united_kingdom"],
  },
  Mintlify: {
    industry: ["developer_tools", "enterprise_software"],
    business_model: ["b2b_saas"],
    customer_type: ["enterprise", "developer"],
    geography: ["united_states"],
  },
  F2: {
    industry: ["fintech", "enterprise_software", "capital_markets"],
    business_model: ["b2b_saas"],
    customer_type: ["financial_institution", "enterprise"],
    geography: ["united_states"],
  },
};

/** Everything one company needs, ids deterministic. */
export function planCompany(c, { nodeIds, authorityUserId, now }) {
  const name = c.name;
  const ids = {
    tenant: seedUuid(name, "tenant"),
    organisation: seedUuid(name, "organisation"),
    company: seedUuid(name, "company"),
  };
  const country = COUNTRY[c.hq_country] ?? null;
  const company = {
    id: ids.company,
    tenantId: ids.tenant,
    organisationId: ids.organisation,
    canonicalName: name,
    slug: slugify(name),
    websiteUrl: c.website ?? null,
    foundedDate: c.founded_year ? `${c.founded_year}-01-01` : null,
    country,
    city: c.hq_city ?? null,
    stage: stageCode(c.stage),
    primaryDescription: c.long_description ?? null,
    shortDescription: c.short_description ?? null,
  };
  const claims = claimsFor(c);
  const urls = [...new Set(claims.flatMap((cl) => cl.urls))];
  const sources = urls.map((url) => ({
    id: seedUuid(name, "source", url),
    url,
    ...sourceMeta(url, c),
  }));
  const sourceByUrl = new Map(sources.map((s) => [s.url, s]));
  const claimRows = claims.map((cl) => {
    const claimId = seedUuid(name, "claim", cl.key);
    return {
      ...cl,
      id: claimId,
      revisionId: seedUuid(name, "claim-rev-1", cl.key),
      items: cl.urls.map((u) => {
        const s = sourceByUrl.get(u);
        return {
          id: seedUuid(name, "item", cl.key, u),
          sourceId: s.id,
          summary: `${s.publisher}: ${cl.statement}`.slice(0, 2000),
          status: s.companyOwn ? "SELF_REPORTED" : "DOCUMENT_SUPPORTED",
          reliability: s.reliability,
        };
      }),
    };
  });
  const taxonomy = [];
  for (const [vocab, codes] of Object.entries(TAXONOMY[name] ?? {})) {
    for (const code of codes) {
      const nodeId = nodeIds[`${vocab}:${code}`];
      if (nodeId === undefined)
        throw new Error(`taxonomy node ${vocab}:${code} missing`);
      taxonomy.push({
        id: seedUuid(name, "tax", vocab, code),
        vocab,
        nodeId,
        raw: c[vocab === "industry" ? "sector" : vocab] ?? null,
      });
    }
  }
  return {
    ids,
    company,
    sources,
    claims: claimRows,
    taxonomy,
    authorityUserId,
    now,
  };
}

// ---------------------------------------------------------------------------
// SQL rendering. Values are literals (the management API takes one string);
// every string goes through lit(), which doubles quotes (standard strings).
// ---------------------------------------------------------------------------

export const lit = (v) => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("non-finite number");
    return String(v);
  }
  return `'${String(v).replace(/'/g, "''")}'`;
};
const json = (v) => `${lit(JSON.stringify(v))}::jsonb`;

function event(p, type, aggregate, data, source) {
  const id = seedUuid(p.company.canonicalName, "event", type, aggregate.id);
  return `insert into events.outbox (event_id, tenant_id, event_type, event_version, payload) values (${lit(id)}, ${lit(p.ids.tenant)}, ${lit(type)}, 1, ${json(
    {
      specVersion: "1.0",
      id,
      type,
      source,
      time: p.now,
      subject: `${aggregate.type}/${aggregate.id}`,
      dataContentType: "application/json",
      eventVersion: 1,
      tenantId: p.ids.tenant,
      organisationId: p.ids.organisation,
      actor: { type: "SYSTEM" },
      aggregate: { ...aggregate, version: 1 },
      correlationId: `cor_${p.correlation}`,
      data,
    },
  )});`;
}

function audit(
  p,
  action,
  resourceType,
  resourceId,
  metadata,
  idKey = resourceId,
) {
  return `insert into audit.material_actions (event_id, tenant_id, actor_type, actor_id, authority_user_id, organisation_id, action_type, resource_type, resource_id, occurred_at, outcome, metadata, correlation_id) values (${lit(seedUuid(p.company.canonicalName, "audit", action, idKey))}, ${lit(p.ids.tenant)}, 'capital_q_system', null, ${lit(p.authorityUserId)}, ${lit(p.ids.organisation)}, ${lit(action)}, ${lit(resourceType)}, ${lit(resourceId)}, ${lit(p.now)}, 'SUCCEEDED', ${json({ ...metadata, seed: SEED_KEY, publicProfile: true })}, ${lit(p.correlation)});`;
}

/** One transaction: identity, company, evidence, claims, taxonomy, audit, outbox. */
export function renderCompanySql(p) {
  p = { ...p, correlation: seedUuid(p.company.canonicalName, "correlation") };
  const c = p.company;
  const s = [];
  s.push("begin;");
  s.push(
    `insert into identity.tenants (id, name, status) values (${lit(p.ids.tenant)}, ${lit(c.canonicalName)}, 'active');`,
  );
  s.push(
    `insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug, website_url, country_code, status) values (${lit(p.ids.organisation)}, ${lit(p.ids.tenant)}, 'company', ${lit(c.canonicalName)}, ${lit(c.slug)}, ${lit(c.websiteUrl)}, ${lit(c.country)}, 'active');`,
  );
  s.push(
    `insert into identity.tenant_organisations (tenant_id, organisation_id, relationship_type) values (${lit(p.ids.tenant)}, ${lit(p.ids.organisation)}, 'primary');`,
  );
  s.push(
    `insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, website_url, founded_date, headquarters_country, headquarters_city, company_status, marketplace_visibility, marketplace_readiness_state, primary_description, short_description, logo_storage_key, current_stage_code) values (${lit(c.id)}, ${lit(c.tenantId)}, ${lit(c.organisationId)}, ${lit(c.canonicalName)}, ${lit(c.slug)}, ${lit(c.websiteUrl)}, ${c.foundedDate === null ? "null" : `${lit(c.foundedDate)}::date`}, ${lit(c.country)}, ${lit(c.city)}, 'active', 'network_visible', 'not_assessed', ${lit(c.primaryDescription)}, ${lit(c.shortDescription)}, null, ${lit(c.stage)});`,
  );
  s.push(
    audit(p, "company.created", "company", c.id, {
      slug: c.slug,
      unclaimed: true,
    }),
  );
  s.push(
    event(
      p,
      "core.company.created",
      { type: "company", id: c.id },
      { version: 1, companyId: c.id, organisationId: p.ids.organisation },
      "capitalq://api/core/company",
    ),
  );
  s.push(
    event(
      p,
      "core.company.visibility_changed",
      { type: "company", id: c.id },
      { version: 1, companyId: c.id, visibility: "network_visible" },
      "capitalq://api/core/company",
    ),
  );
  for (const src of p.sources) {
    s.push(
      `insert into evidence.sources (id, tenant_id, source_type, subject_type, subject_id, provider, title, source_url, created_by_user_id, retrieved_at, published_at, reliability_class, visibility_scope, sensitivity_class, metadata) values (${lit(src.id)}, ${lit(p.ids.tenant)}, 'PUBLIC_WEB', 'COMPANY', ${lit(c.id)}, 'public_web', ${lit(src.publisher.slice(0, 200))}, ${lit(src.url)}, null, ${lit(p.now)}, ${src.publishedAt === null ? "null" : `${lit(src.publishedAt)}::timestamptz`}, ${lit(src.reliability)}, 'network_visible', 'PUBLIC', ${json({ publisher: src.publisher, seed: SEED_KEY })});`,
    );
    s.push(
      event(
        p,
        "evidence.source.registered",
        { type: "evidence_source", id: src.id },
        {
          sourceId: src.id,
          subjectId: c.id,
          sourceType: "PUBLIC_WEB",
          subjectType: "COMPANY",
        },
        "capitalq://api/evidence",
      ),
    );
  }
  for (const cl of p.claims) {
    for (const it of cl.items) {
      s.push(
        `insert into evidence.evidence_items (id, tenant_id, source_id, subject_type, subject_id, evidence_type, summary, structured_value, locator, evidence_status, reliability_class, visibility_scope, sensitivity_class, created_by_user_id) values (${lit(it.id)}, ${lit(p.ids.tenant)}, ${lit(it.sourceId)}, 'COMPANY', ${lit(c.id)}, 'public_web.reported_fact', ${lit(it.summary)}, ${json(cl.value)}, ${json({ kind: "statement" })}, ${lit(it.status)}, ${lit(it.reliability)}, 'network_visible', 'PUBLIC', null);`,
      );
      s.push(
        event(
          p,
          "evidence.evidence_item.created",
          { type: "evidence_item", id: it.id },
          {
            sourceId: it.sourceId,
            subjectId: c.id,
            subjectType: "COMPANY",
            evidenceItemId: it.id,
          },
          "capitalq://api/evidence",
        ),
      );
    }
    const first = cl.items[0].sourceId;
    const validFrom = cl.validFrom
      ? `${lit(cl.validFrom)}::timestamptz`
      : "null";
    s.push(
      `insert into evidence.claim_revisions (id, tenant_id, claim_id, revision_number, statement, structured_value, truth_class, evidence_status, lifecycle_status, valid_from, changed_by_type, changed_by_id, source_id) values (${lit(cl.revisionId)}, ${lit(p.ids.tenant)}, ${lit(cl.id)}, 1, ${lit(cl.statement)}, ${json(cl.value)}, ${lit(cl.truthClass)}, ${lit(cl.evidenceStatus)}, 'CURRENT', ${validFrom}, 'SOURCE', ${lit(first)}, ${lit(first)});`,
    );
    s.push(
      `insert into evidence.claims (id, tenant_id, subject_type, subject_id, claim_type, claim_key, statement, structured_value, asserted_by_type, asserted_by_id, asserted_at, valid_from, truth_class, evidence_status, lifecycle_status, visibility_scope, sensitivity_class, current_revision_id, current_revision_number) values (${lit(cl.id)}, ${lit(p.ids.tenant)}, 'COMPANY', ${lit(c.id)}, ${lit(cl.type)}, ${lit(cl.key)}, ${lit(cl.statement)}, ${json(cl.value)}, 'SOURCE', ${lit(first)}, ${lit(p.now)}, ${validFrom}, ${lit(cl.truthClass)}, ${lit(cl.evidenceStatus)}, 'CURRENT', 'network_visible', 'PUBLIC', ${lit(cl.revisionId)}, 1);`,
    );
    for (const it of cl.items) {
      s.push(
        `insert into evidence.claim_evidence (tenant_id, claim_id, evidence_item_id, relationship, created_by_user_id) values (${lit(p.ids.tenant)}, ${lit(cl.id)}, ${lit(it.id)}, 'SUPPORTS', null);`,
      );
    }
    s.push(
      audit(p, "claim.created", "claim", cl.id, {
        claimKey: cl.key,
        truthClass: cl.truthClass,
        evidenceStatus: cl.evidenceStatus,
      }),
    );
    s.push(
      event(
        p,
        "evidence.claim.changed",
        { type: "claim", id: cl.id },
        {
          claimId: cl.id,
          subjectId: c.id,
          changeKind: "CREATED",
          subjectType: "COMPANY",
          revisionNumber: 1,
        },
        "capitalq://api/evidence",
      ),
    );
  }
  const vocabs = [...new Set(p.taxonomy.map((t) => t.vocab))];
  for (const t of p.taxonomy) {
    s.push(
      `insert into taxonomy.entity_assignments (id, tenant_id, entity_type, entity_id, node_id, assignment_source, status, raw_source_text, valid_from) values (${lit(t.id)}, ${lit(p.ids.tenant)}, 'COMPANY', ${lit(c.id)}, ${lit(t.nodeId)}, 'admin_curated', 'ACTIVE', ${lit(t.raw)}, ${lit(p.now)});`,
    );
  }
  for (const v of vocabs) {
    s.push(
      audit(
        p,
        "taxonomy.company_assignments.updated",
        "company",
        c.id,
        {
          vocabularyCode: v,
          addedCount: p.taxonomy.filter((t) => t.vocab === v).length,
          removedCount: 0,
        },
        `${c.id}:${v}`,
      ),
    );
  }
  if (vocabs.length) {
    s.push(
      event(
        p,
        "taxonomy.entity_assignments.changed",
        { type: "company", id: c.id },
        {
          subjectId: c.id,
          subjectType: "COMPANY",
          changedVocabularyCodes: vocabs,
        },
        "capitalq://api/taxonomy",
      ),
    );
  }
  s.push("commit;");
  return s.join("\n");
}
