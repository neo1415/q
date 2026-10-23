// Demonstration companies (owner direction 2026-10-22): Capital Q, KUUZA AI
// and Songscribe, from supabase/seed-assets/demo-companies/companies.json.
// Pure planning: the current state of each company in, one transaction of
// SQL out. No I/O and no secrets; seed.mjs reads the state and runs it.
//
//   identity    one canonical company: CORRECT finds and fixes the existing
//               row (Capital Q by its organisation id, never a second one);
//               FILL_GAPS only adds what is missing and never overwrites
//               what a founder entered (KUUZA AI)
//   evidence    every figure is a claim the company reports: truth class
//               USER_CLAIM (ESTIMATE for a market size), evidence status
//               SELF_REPORTED, never verified; its statement says
//               "demonstration data" so Q cites it as such
//   history     a wrong claim is superseded through a new revision, a raise
//               is replaced, never deleted (append-only)
//   label       core.companies.demonstration_data drives the visible
//               "Demonstration data" note on the profile and the Q Card
//   reach       the company becomes network_visible (CORRECT) so Q and the
//               knowledge projection list it; investor Discover still needs
//               Capital Q's own verification, which no seed may fake
import { createHash } from "node:crypto";

export const DEMO_STATEMENT_SUFFIX =
  " (Demonstration data, self-reported by the company.)";
export const DEMO_DESCRIPTION_NOTE =
  "Figures on this profile are demonstration data supplied by the company to demonstrate Capital Q; they are not verified.";

/** Deterministic UUID (v5-shaped) so a re-run targets the same rows. */
export function seedUuid(seedKey, ...parts) {
  const h = createHash("sha256")
    .update([seedKey, ...parts].join("\u0000"))
    .digest("hex");
  const v = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${v}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const lit = (v) => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("non-finite number");
    return String(v);
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  return `'${String(v).replace(/'/g, "''")}'`;
};
const json = (v) => `${lit(JSON.stringify(v))}::jsonb`;

/** Stable JSON for comparing stored and wanted values. */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export const slugify = (s) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

export function personName(person) {
  return (
    person.displayName ??
    [person.givenName, person.familyName].filter(Boolean).join(" ")
  );
}

/** The company's statement for a figure, said as demonstration data. */
export function demoStatement(statement) {
  return statement.endsWith(DEMO_STATEMENT_SUFFIX)
    ? statement
    : `${statement}${DEMO_STATEMENT_SUFFIX}`;
}

function primaryWithNote(text) {
  if (text === null) return null;
  return text.includes(DEMO_DESCRIPTION_NOTE)
    ? text
    : `${text}\n\n${DEMO_DESCRIPTION_NOTE}`;
}

/** The Q Card scopes a demonstration company's card starts from. */
const COMPANY_CARD_BASE = {
  canonicalName: "public_external",
  photo: "public_external",
  cover: "public_external",
  shortDescription: "public_external",
  websiteUrl: "public_external",
  currentStageCode: "public_external",
  headquartersCity: "public_external",
  headquartersCountry: "public_external",
  foundedDate: "network_visible",
};

/** A person card: identity public, focus and country to members. */
export const PERSON_CARD_SCOPES = {
  displayName: "public_external",
  photo: "public_external",
  headline: "public_external",
  roleTitle: "public_external",
  affiliation: "public_external",
  countryCode: "network_visible",
  personFocus: "network_visible",
};

/**
 * What to change for one company, given what is there now.
 *
 * state = {
 *   company: existing core.companies row (snake_case) or null,
 *   claims: [{ id, claim_key, structured_value, current_revision_number,
 *              statement, truth_class, evidence_status, valid_from }] CURRENT,
 *   objective: active capital objective row or null,
 *   taxonomyNodeIds: Set of node ids already ACTIVE on the company,
 *   taxonomyVocabsUsed: Set of vocabulary codes with any ACTIVE assignment,
 *   nodes: Map "vocab|Display Name" -> node id,
 *   memberCount: current company_members,
 *   handle: active handle or null, card: { id, field_scopes, version } | null,
 *   authorityUserId, now
 * }
 */
export function planCompany(fixture, spec, state) {
  const seedKey = fixture.seedKey;
  const id = (...parts) => seedUuid(seedKey, spec.key, ...parts);
  const fill = spec.mode === "FILL_GAPS";
  const existing = state.company;
  const actions = [];

  if (existing === null && fill) {
    return {
      key: spec.key,
      skip: `${spec.canonicalName} is not on the platform; FILL_GAPS never creates a company`,
      actions: [],
    };
  }

  const ids = existing
    ? {
        company: existing.id,
        tenant: existing.tenant_id,
        organisation: existing.organisation_id,
      }
    : {
        company: id("company"),
        tenant: id("tenant"),
        organisation: spec.match.organisationId ?? id("organisation"),
      };

  // --- the company row ---------------------------------------------------
  const wanted = {
    canonical_name: spec.canonicalName,
    website_url: spec.websiteUrl,
    headquarters_city: spec.headquartersCity,
    headquarters_country: spec.headquartersCountry,
    founded_date: spec.foundedDate,
    current_stage_code: spec.stageCode,
    short_description: spec.shortDescription,
    primary_description: primaryWithNote(spec.primaryDescription),
  };
  const changes = {};
  let createWanted = null;
  if (existing === null) {
    createWanted = { ...wanted, slug: slugify(spec.canonicalName) };
    actions.push({ kind: "CREATE_COMPANY" });
  } else {
    for (const [column, value] of Object.entries(wanted)) {
      if (value === null) continue; // unknown stays as it is
      const current = existing[column] ?? null;
      if (fill ? current === null : current !== value) changes[column] = value;
    }
    // A FILL_GAPS company keeps its founder's visibility unless the owner
    // made it discoverable (spec.discoverable; owner 2026-10-23).
    if (
      (!fill || spec.discoverable === true) &&
      existing.marketplace_visibility !== "network_visible"
    ) {
      changes.marketplace_visibility = "network_visible";
    }
  }

  // --- claims ------------------------------------------------------------
  const claimPlans = [];
  const allClaims = [...spec.claims];
  const founders = spec.founders.map((f) => ({
    name: personName(fixture.people[f.person]),
    title: f.title,
  }));
  if (founders.length > 0 && (state.memberCount ?? 0) === 0) {
    allClaims.push({
      key: "team.founders",
      type: "team",
      statement: `Founders: ${founders.map((f) => `${f.name} (${f.title})`).join(", ")}.`,
      value: { founders },
    });
  }
  for (const claim of allClaims) {
    const current = state.claims.filter((c) => c.claim_key === claim.key);
    const same = current.find(
      (c) => canonical(c.structured_value) === canonical(claim.value),
    );
    if (fill && current.length > 0) continue;
    if (same !== undefined) continue;
    const supersede = fill ? [] : current;
    const valueHash = createHash("sha256")
      .update(canonical(claim.value))
      .digest("hex")
      .slice(0, 16);
    claimPlans.push({
      claim,
      id: id("claim", claim.key, valueHash),
      revisionId: id("claim-revision", claim.key, valueHash),
      sourceId: id("source", claim.key, valueHash),
      itemId: id("evidence-item", claim.key, valueHash),
      statement: demoStatement(claim.statement),
      truthClass: claim.truthClass ?? "USER_CLAIM",
      validFrom: claim.value.asOf ?? claim.value.periodEnd ?? null,
      supersede,
    });
  }

  // --- taxonomy ----------------------------------------------------------
  const taxonomy = [];
  for (const [vocab, names] of Object.entries(spec.taxonomy ?? {})) {
    if (fill && state.taxonomyVocabsUsed.has(vocab)) continue;
    for (const name of names) {
      const nodeId = state.nodes.get(`${vocab}|${name}`);
      if (nodeId === undefined || state.taxonomyNodeIds.has(nodeId)) continue;
      taxonomy.push({ id: id("taxonomy", vocab, name), nodeId, vocab, name });
    }
  }

  // --- the raise ---------------------------------------------------------
  let raise = null;
  if (spec.raise !== null) {
    const r = spec.raise;
    const o = state.objective;
    const matches =
      o !== null &&
      Number(o.target_amount) === Number(r.target.amount) &&
      o.currency_code === r.target.currency &&
      (o.target_stage ?? null) === r.stageCode &&
      (o.instrument_code ?? null) === r.instrumentCode &&
      (o.target_close_date ?? null) === r.targetCloseDate &&
      (o.use_of_funds_summary ?? null) === r.useOfFunds;
    if (!matches && !(fill && o !== null)) {
      const hash = createHash("sha256")
        .update(canonical(r))
        .digest("hex")
        .slice(0, 16);
      raise = { spec: r, id: id("objective", hash), replace: o };
    }
  }

  // --- the Q Card --------------------------------------------------------
  let card = null;
  if (spec.qCard !== null) {
    const scopes = { ...COMPANY_CARD_BASE, ...spec.qCard };
    if (state.card === null) {
      card = {
        create: true,
        id: id("card"),
        code: id("card-code")
          .replace(/[^a-z0-9]/g, "")
          .slice(0, 10),
        scopes,
      };
    } else {
      const merged = { ...state.card.field_scopes, ...spec.qCard };
      if (canonical(merged) !== canonical(state.card.field_scopes)) {
        card = { create: false, id: state.card.id, scopes: merged };
      }
    }
  }
  const handle =
    spec.handle !== null && state.handle === null
      ? { id: id("handle"), handle: spec.handle }
      : null;

  const anything =
    actions.length > 0 ||
    Object.keys(changes).length > 0 ||
    claimPlans.length > 0 ||
    taxonomy.length > 0 ||
    raise !== null ||
    card !== null ||
    handle !== null;
  // The label goes on whenever this seed puts demonstration figures there.
  const label =
    (existing === null || existing.demonstration_data !== true) &&
    (claimPlans.length > 0 || raise !== null || !fill);

  return {
    key: spec.key,
    name: spec.canonicalName,
    mode: spec.mode,
    ids,
    existing: existing !== null,
    create: existing === null,
    createWanted,
    changes,
    claims: claimPlans,
    taxonomy,
    raise,
    card,
    handle,
    label,
    noop: !anything && !label,
  };
}

// ---------------------------------------------------------------------------
// SQL rendering. One transaction per company; every row the seed writes is
// attributed in audit to capital_q_system under the approving owner.
// ---------------------------------------------------------------------------

function event(ctx, type, aggregate, data, source) {
  const id = seedUuid(
    ctx.seedKey,
    ctx.key,
    "event",
    type,
    aggregate.id,
    ctx.salt,
  );
  return `insert into events.outbox (event_id, tenant_id, event_type, event_version, payload) values (${lit(id)}, ${lit(ctx.ids.tenant)}, ${lit(type)}, 1, ${json(
    {
      specVersion: "1.0",
      id,
      type,
      source,
      time: ctx.now,
      subject: `${aggregate.type}/${aggregate.id}`,
      dataContentType: "application/json",
      eventVersion: 1,
      tenantId: ctx.ids.tenant,
      organisationId: ctx.ids.organisation,
      actor: { type: "SYSTEM" },
      aggregate: { ...aggregate, version: 1 },
      correlationId: `cor_${ctx.correlation}`,
      data,
    },
  )}) on conflict (event_id) do nothing;`;
}

function audit(ctx, action, resourceType, resourceId, metadata) {
  return `insert into audit.material_actions (event_id, tenant_id, actor_type, actor_id, authority_user_id, organisation_id, action_type, resource_type, resource_id, occurred_at, outcome, metadata, correlation_id) values (${lit(seedUuid(ctx.seedKey, ctx.key, "audit", action, resourceId, ctx.salt))}, ${lit(ctx.ids.tenant)}, 'capital_q_system', null, ${lit(ctx.authorityUserId)}, ${lit(ctx.ids.organisation)}, ${lit(action)}, ${lit(resourceType)}, ${lit(resourceId)}, ${lit(ctx.now)}, 'SUCCEEDED', ${json({ ...metadata, seed: ctx.seedKey, demonstrationData: true })}, ${lit(ctx.correlation)}) on conflict do nothing;`;
}

export function renderCompanySql(plan, { seedKey, authorityUserId, now }) {
  if (plan.skip || plan.noop) return null;
  // A salt per run keeps a later correction's events distinct from the first.
  const salt = now;
  const ctx = {
    seedKey,
    key: plan.key,
    ids: plan.ids,
    authorityUserId,
    now,
    salt,
    correlation: seedUuid(seedKey, plan.key, "correlation", salt),
  };
  return renderBody(plan, ctx, ["begin;"], plan.ids.company);
}

function renderBody(plan, ctx, s, companyId) {
  const { ids } = plan;
  if (plan.create) {
    const w = plan.createWanted;
    s.push(
      `insert into identity.tenants (id, name, status) values (${lit(ids.tenant)}, ${lit(w.canonical_name)}, 'active') on conflict (id) do nothing;`,
      `insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug, website_url, country_code, status) values (${lit(ids.organisation)}, ${lit(ids.tenant)}, 'company', ${lit(w.canonical_name)}, ${lit(w.slug)}, ${lit(w.website_url)}, ${lit(w.headquarters_country)}, 'active') on conflict (id) do nothing;`,
      `insert into identity.tenant_organisations (tenant_id, organisation_id, relationship_type) values (${lit(ids.tenant)}, ${lit(ids.organisation)}, 'primary') on conflict do nothing;`,
      `insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, website_url, founded_date, headquarters_country, headquarters_city, company_status, marketplace_visibility, marketplace_readiness_state, primary_description, short_description, current_stage_code, demonstration_data) values (${lit(companyId)}, ${lit(ids.tenant)}, ${lit(ids.organisation)}, ${lit(w.canonical_name)}, ${lit(w.slug)}, ${lit(w.website_url)}, ${w.founded_date === null ? "null" : `${lit(w.founded_date)}::date`}, ${lit(w.headquarters_country)}, ${lit(w.headquarters_city)}, 'active', 'network_visible', 'not_assessed', ${lit(w.primary_description)}, ${lit(w.short_description)}, ${lit(w.current_stage_code)}, true);`,
      audit(ctx, "company.created", "company", companyId, {
        name: w.canonical_name,
      }),
      event(
        ctx,
        "core.company.created",
        { type: "company", id: companyId },
        { version: 1, companyId, organisationId: ids.organisation },
        "capitalq://api/core/company",
      ),
      event(
        ctx,
        "core.company.visibility_changed",
        { type: "company", id: companyId },
        { version: 1, companyId, visibility: "network_visible" },
        "capitalq://api/core/company",
      ),
    );
  } else {
    const sets = Object.entries(plan.changes).map(
      ([column, value]) =>
        `${column} = ${column === "founded_date" && value !== null ? `${lit(value)}::date` : lit(value)}`,
    );
    if (plan.label) sets.push("demonstration_data = true");
    // The event needs at least one field (core.company.updated v1): a
    // label-only update names the label itself.
    const changedFields = [
      ...Object.keys(plan.changes),
      ...(plan.label ? ["demonstration_data"] : []),
    ];
    if (sets.length > 0) {
      s.push(
        `update core.companies set ${sets.join(", ")}, version = version + 1 where id = ${lit(companyId)};`,
        audit(ctx, "company.updated", "company", companyId, {
          changedFields,
          demonstrationLabel: plan.label,
        }),
        event(
          ctx,
          "core.company.updated",
          { type: "company", id: companyId },
          {
            version: 1,
            companyId,
            changedFields,
          },
          "capitalq://api/core/company",
        ),
      );
      if (plan.changes.marketplace_visibility !== undefined) {
        s.push(
          event(
            ctx,
            "core.company.visibility_changed",
            { type: "company", id: companyId },
            { version: 1, companyId, visibility: "network_visible" },
            "capitalq://api/core/company",
          ),
        );
      }
    }
  }

  for (const cp of plan.claims) {
    for (const old of cp.supersede) {
      const revId = seedUuid(
        ctx.seedKey,
        plan.key,
        "supersede",
        old.id,
        ctx.salt,
      );
      const next = old.current_revision_number + 1;
      s.push(
        `insert into evidence.claim_revisions (id, tenant_id, claim_id, revision_number, statement, structured_value, truth_class, evidence_status, lifecycle_status, valid_from, changed_by_type, changed_by_id, change_reason) values (${lit(revId)}, ${lit(ids.tenant)}, ${lit(old.id)}, ${next}, ${lit(old.statement)}, ${old.structured_value === null ? "null" : json(old.structured_value)}, ${lit(old.truth_class)}, ${lit(old.evidence_status)}, 'SUPERSEDED', ${old.valid_from === null ? "null" : `${lit(old.valid_from)}::timestamptz`}, 'USER', ${lit(ctx.authorityUserId)}, 'Superseded by the owner-approved demonstration seed');`,
        `update evidence.claims set lifecycle_status = 'SUPERSEDED', current_revision_id = ${lit(revId)}, current_revision_number = ${next} where id = ${lit(old.id)};`,
        audit(ctx, "claim.superseded", "claim", old.id, {
          claimKey: cp.claim.key,
        }),
        event(
          ctx,
          "evidence.claim.changed",
          { type: "claim", id: old.id },
          {
            claimId: old.id,
            subjectId: companyId,
            changeKind: "REVISED",
            subjectType: "COMPANY",
            revisionNumber: next,
          },
          "capitalq://api/evidence",
        ),
      );
    }
    const validFrom =
      cp.validFrom === null ? "null" : `${lit(cp.validFrom)}::timestamptz`;
    s.push(
      `insert into evidence.sources (id, tenant_id, source_type, subject_type, subject_id, provider, title, created_by_user_id, retrieved_at, reliability_class, visibility_scope, sensitivity_class, metadata) values (${lit(cp.sourceId)}, ${lit(ids.tenant)}, 'USER_STATEMENT', 'COMPANY', ${lit(companyId)}, 'demo_seed', 'Company statement (demonstration data)', null, ${lit(ctx.now)}, 'USER_STATEMENT', 'network_visible', 'PUBLIC', ${json({ seed: ctx.seedKey, demonstrationData: true })}) on conflict (id) do nothing;`,
      `insert into evidence.evidence_items (id, tenant_id, source_id, subject_type, subject_id, evidence_type, summary, structured_value, locator, evidence_status, reliability_class, visibility_scope, sensitivity_class, created_by_user_id) values (${lit(cp.itemId)}, ${lit(ids.tenant)}, ${lit(cp.sourceId)}, 'COMPANY', ${lit(companyId)}, 'user_statement.reported_fact', ${lit(cp.statement.slice(0, 500))}, ${json(cp.claim.value)}, ${json({ kind: "statement" })}, 'SELF_REPORTED', 'USER_STATEMENT', 'network_visible', 'PUBLIC', null) on conflict (id) do nothing;`,
      `insert into evidence.claim_revisions (id, tenant_id, claim_id, revision_number, statement, structured_value, truth_class, evidence_status, lifecycle_status, valid_from, changed_by_type, changed_by_id, source_id) values (${lit(cp.revisionId)}, ${lit(ids.tenant)}, ${lit(cp.id)}, 1, ${lit(cp.statement)}, ${json(cp.claim.value)}, ${lit(cp.truthClass)}, 'SELF_REPORTED', 'CURRENT', ${validFrom}, 'SOURCE', ${lit(cp.sourceId)}, ${lit(cp.sourceId)}) on conflict (id) do nothing;`,
      `insert into evidence.claims (id, tenant_id, subject_type, subject_id, claim_type, claim_key, statement, structured_value, asserted_by_type, asserted_by_id, asserted_at, valid_from, truth_class, evidence_status, lifecycle_status, visibility_scope, sensitivity_class, current_revision_id, current_revision_number) values (${lit(cp.id)}, ${lit(ids.tenant)}, 'COMPANY', ${lit(companyId)}, ${lit(cp.claim.type)}, ${lit(cp.claim.key)}, ${lit(cp.statement)}, ${json(cp.claim.value)}, 'SOURCE', ${lit(cp.sourceId)}, ${lit(ctx.now)}, ${validFrom}, ${lit(cp.truthClass)}, 'SELF_REPORTED', 'CURRENT', 'network_visible', 'PUBLIC', ${lit(cp.revisionId)}, 1) on conflict (id) do nothing;`,
      `insert into evidence.claim_evidence (tenant_id, claim_id, evidence_item_id, relationship, created_by_user_id) values (${lit(ids.tenant)}, ${lit(cp.id)}, ${lit(cp.itemId)}, 'SUPPORTS', null) on conflict do nothing;`,
      audit(ctx, "claim.created", "claim", cp.id, {
        claimKey: cp.claim.key,
        truthClass: cp.truthClass,
        evidenceStatus: "SELF_REPORTED",
      }),
      event(
        ctx,
        "evidence.claim.changed",
        { type: "claim", id: cp.id },
        {
          claimId: cp.id,
          subjectId: companyId,
          changeKind: "CREATED",
          subjectType: "COMPANY",
          revisionNumber: 1,
        },
        "capitalq://api/evidence",
      ),
    );
  }

  for (const t of plan.taxonomy) {
    s.push(
      `insert into taxonomy.entity_assignments (id, tenant_id, entity_type, entity_id, node_id, assignment_source, status, raw_source_text, valid_from) values (${lit(t.id)}, ${lit(ids.tenant)}, 'COMPANY', ${lit(companyId)}, ${lit(t.nodeId)}, 'admin_curated', 'ACTIVE', ${lit(t.name)}, ${lit(ctx.now)}) on conflict (id) do nothing;`,
    );
  }
  if (plan.taxonomy.length > 0) {
    const vocabs = [...new Set(plan.taxonomy.map((t) => t.vocab))];
    s.push(
      event(
        ctx,
        "taxonomy.entity_assignments.changed",
        { type: "company", id: companyId },
        {
          subjectId: companyId,
          subjectType: "COMPANY",
          changedVocabularyCodes: vocabs,
        },
        "capitalq://api/taxonomy",
      ),
    );
  }

  if (plan.raise !== null) {
    const r = plan.raise.spec;
    if (plan.raise.replace !== null) {
      const old = plan.raise.replace;
      s.push(
        `update core.capital_objectives set status = 'REPLACED', closed_at = greatest(${lit(ctx.now)}::timestamptz, started_at), version = version + 1 where id = ${lit(old.id)} and status = 'ACTIVE';`,
        `insert into core.capital_objective_events (tenant_id, capital_objective_id, event_type, actor_type, actor_id, payload) values (${lit(ids.tenant)}, ${lit(old.id)}, 'REPLACED', 'SYSTEM', ${lit(ctx.authorityUserId)}, ${json({ replacedBy: plan.raise.id, seed: ctx.seedKey })});`,
      );
    }
    s.push(
      `insert into core.capital_objectives (id, tenant_id, company_id, objective_type, status, target_amount, currency_code, target_stage, instrument_code, target_close_date, use_of_funds_summary, created_by_user_id) values (${lit(plan.raise.id)}, ${lit(ids.tenant)}, ${lit(companyId)}, 'RAISE', 'ACTIVE', ${lit(r.target.amount)}::numeric, ${lit(r.target.currency)}, ${lit(r.stageCode)}, ${lit(r.instrumentCode)}, ${r.targetCloseDate === null ? "null" : `${lit(r.targetCloseDate)}::date`}, ${lit(r.useOfFunds)}, ${lit(ctx.authorityUserId)}) on conflict (id) do nothing;`,
      `insert into core.capital_objective_events (tenant_id, capital_objective_id, event_type, actor_type, actor_id, payload) values (${lit(ids.tenant)}, ${lit(plan.raise.id)}, 'CREATED', 'SYSTEM', ${lit(ctx.authorityUserId)}, ${json({ seed: ctx.seedKey, demonstrationData: true })});`,
      audit(
        ctx,
        "capital_objective.created",
        "capital_objective",
        plan.raise.id,
        {
          targetAmount: r.target.amount,
          currency: r.target.currency,
        },
      ),
    );
  }

  if (plan.handle !== null) {
    s.push(
      `insert into core.handles (id, handle, tenant_id, organisation_id, subject_type, subject_id) values (${lit(plan.handle.id)}, ${lit(plan.handle.handle)}, ${lit(ids.tenant)}, ${lit(ids.organisation)}, 'COMPANY', ${lit(companyId)}) on conflict do nothing;`,
      audit(ctx, "handle.claimed", "handle", companyId, {
        subjectType: "COMPANY",
        handle: plan.handle.handle,
      }),
    );
  }
  if (plan.card !== null) {
    if (plan.card.create) {
      s.push(
        `insert into core.shareable_identities (id, tenant_id, organisation_id, subject_type, subject_id, public_code, field_scopes, created_by_user_id) values (${lit(plan.card.id)}, ${lit(ids.tenant)}, ${lit(ids.organisation)}, 'COMPANY', ${lit(companyId)}, ${lit(plan.card.code)}, ${json(plan.card.scopes)}, null) on conflict (subject_type, subject_id) do nothing;`,
      );
    } else {
      s.push(
        `update core.shareable_identities set field_scopes = ${json(plan.card.scopes)}, version = version + 1 where id = ${lit(plan.card.id)};`,
      );
    }
    s.push(
      audit(ctx, "q_card.updated", "shareable_identity", plan.card.id, {
        changedScopes: Object.keys(plan.card.scopes),
      }),
    );
  }

  s.push("commit;");
  return s.join("\n");
}

/** A person's own card, made on their behalf with their permission. */
export function renderPersonCardSql({
  seedKey,
  userId,
  handle,
  tenantId,
  existingHandle,
  existingCard,
}) {
  const s = ["begin;"];
  if (existingHandle === null) {
    s.push(
      `insert into core.handles (id, handle, tenant_id, organisation_id, subject_type, subject_id, claimed_by_user_id) values (${lit(seedUuid(seedKey, "person-handle", userId))}, ${lit(handle)}, ${lit(tenantId)}, null, 'PERSON', ${lit(userId)}, ${lit(userId)}) on conflict do nothing;`,
    );
  }
  if (existingCard === null) {
    s.push(
      `insert into core.shareable_identities (id, tenant_id, organisation_id, subject_type, subject_id, public_code, field_scopes, created_by_user_id) values (${lit(seedUuid(seedKey, "person-card", userId))}, ${lit(tenantId)}, null, 'PERSON', ${lit(userId)}, ${lit(
        seedUuid(seedKey, "person-card-code", userId)
          .replace(/[^a-z0-9]/g, "")
          .slice(0, 10),
      )}, ${json(PERSON_CARD_SCOPES)}, ${lit(userId)}) on conflict (subject_type, subject_id) do nothing;`,
    );
  }
  if (s.length === 1) return null;
  s.push("commit;");
  return s.join("\n");
}

/**
 * The team of a company, for people who already have accounts and agreed
 * (owner 2026-10-22): an active organisation membership with the baseline
 * member role only -- owner and admin are authority, and a seed never
 * grants them -- a current company membership with their title, and, for
 * founders, background lines that are their stated roles only. Nothing is
 * sent: no invitation, no email. Existing rows are kept as they are.
 */
export function renderTeamSql({
  seedKey,
  company,
  memberRoleId,
  authorityUserId,
  now,
  members,
}) {
  const s = [];
  const ctx = {
    seedKey,
    key: `team:${company.id}`,
    ids: { tenant: company.tenant, organisation: company.organisation },
    authorityUserId,
    now,
    salt: now,
    correlation: seedUuid(seedKey, "team", company.id, now),
  };
  for (const m of members) {
    const membershipId = seedUuid(
      seedKey,
      "membership",
      company.organisation,
      m.userId,
    );
    if (!m.hasMembership) {
      s.push(
        `insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id, membership_status, joined_at, primary_business_title, metadata) values (${lit(membershipId)}, ${lit(company.tenant)}, ${lit(company.organisation)}, ${lit(m.userId)}, 'active', now(), ${lit(m.title)}, ${json({ seed: seedKey, invitationSent: false })}) on conflict (id) do nothing;`,
        `insert into identity.membership_roles (membership_id, role_id) values (${lit(membershipId)}, ${lit(memberRoleId)}) on conflict do nothing;`,
        audit(
          ctx,
          "membership.created",
          "organisation_membership",
          membershipId,
          {
            role: "organisation_member",
            invitationSent: false,
          },
        ),
      );
      if (!m.hasActiveContext) {
        s.push(
          `insert into identity.user_active_contexts (user_id, membership_id) values (${lit(m.userId)}, ${lit(membershipId)}) on conflict do nothing;`,
        );
      }
    }
    if (!m.hasCompanyMember) {
      const memberId = seedUuid(
        seedKey,
        "company-member",
        company.id,
        m.userId,
      );
      s.push(
        `insert into core.company_members (id, tenant_id, company_id, user_id, relationship_type, business_title, is_founder) values (${lit(memberId)}, ${lit(company.tenant)}, ${lit(company.id)}, ${lit(m.userId)}, 'team_member', ${lit(m.title)}, ${m.isFounder ? "true" : "false"}) on conflict (id) do nothing;`,
        audit(ctx, "company_member.created", "company_member", memberId, {
          title: m.title,
          isFounder: m.isFounder,
        }),
      );
    }
    m.backgrounds
      .filter((title) => !m.existingBackgroundTitles.includes(title))
      .forEach((title, index) => {
        s.push(
          `insert into core.founder_background_entries (id, tenant_id, user_id, title, visibility_scope, sort_order) values (${lit(seedUuid(seedKey, "background", m.userId, title))}, ${lit(company.tenant)}, ${lit(m.userId)}, ${lit(title)}, 'network_visible', ${index}) on conflict (id) do nothing;`,
        );
      });
  }
  if (s.length === 0) return null;
  s.push(
    event(
      ctx,
      "core.company.updated",
      { type: "company", id: company.id },
      { version: 1, companyId: company.id, changedFields: ["team"] },
      "capitalq://api/core/company",
    ),
  );
  return ["begin;", ...s, "commit;"].join("\n");
}

export const DOCUMENT_BUCKET = "cq-documents-private";

/** ADR-001 scope each data-room level is stored as. */
const LEVEL_SCOPE = {
  PUBLIC: "network_visible",
  ON_REQUEST: "specifically_shared",
};

/**
 * The company's data-room documents (owner 2026-10-22: business documents
 * only), written exactly as an upload registers them: the document, its
 * first version in the private bucket, the data-room entry at its level,
 * an audit row and `evidence.document.version_created`, so the real
 * pipeline -- scanning, text extraction and Q's deck reading through the
 * model gateway -- runs on them. Uploaded by the founder who agreed.
 * A document already there (same title) is left alone.
 */
export function planDocuments({
  seedKey,
  company,
  uploaderUserId,
  documents,
  existingTitles,
}) {
  return documents
    .filter((d) => !existingTitles.includes(d.title))
    .map((d) => {
      const id = seedUuid(seedKey, "document", company.id, d.sha256);
      const versionId = seedUuid(
        seedKey,
        "document-version",
        company.id,
        d.sha256,
      );
      const keyHex = seedUuid(seedKey, "document-key", d.sha256).replace(
        /-/g,
        "",
      );
      return {
        ...d,
        id,
        versionId,
        storageKey: `raw/${company.tenant}/${keyHex}`,
        uploaderUserId,
      };
    });
}

export function renderDocumentsSql({
  seedKey,
  company,
  planned,
  authorityUserId,
  now,
}) {
  if (planned.length === 0) return null;
  const ctx = {
    seedKey,
    key: `documents:${company.id}`,
    ids: { tenant: company.tenant, organisation: company.organisation },
    authorityUserId,
    now,
    salt: now,
    correlation: seedUuid(seedKey, "documents", company.id, now),
  };
  const s = ["begin;"];
  for (const d of planned) {
    const audience =
      d.documentType === "PITCH_DECK" ? "INVESTORS" : "ORGANISATION";
    const scope = LEVEL_SCOPE[d.dataRoomLevel];
    if (scope === undefined)
      throw new Error(`unknown data-room level ${d.dataRoomLevel}`);
    s.push(
      `insert into evidence.documents (id, tenant_id, company_id, owner_organisation_id, document_type, title, visibility_scope, sensitivity_class, status, created_by_user_id, download_audience, owner_kind) values (${lit(d.id)}, ${lit(company.tenant)}, ${lit(company.id)}, ${lit(company.organisation)}, ${lit(d.documentType)}, ${lit(d.title)}, ${lit(scope)}, 'CONFIDENTIAL', 'ACTIVE', ${lit(d.uploaderUserId)}, ${lit(audience)}, 'ORGANISATION') on conflict (id) do nothing;`,
      `insert into evidence.document_versions (id, tenant_id, document_id, version_number, storage_bucket, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by_user_id) values (${lit(d.versionId)}, ${lit(company.tenant)}, ${lit(d.id)}, 1, ${lit(DOCUMENT_BUCKET)}, ${lit(d.storageKey)}, ${lit(d.file)}, ${lit(d.mime)}, ${d.sizeBytes}, ${lit(d.sha256)}, ${lit(d.uploaderUserId)}) on conflict (id) do nothing;`,
      `update evidence.documents set current_version_id = ${lit(d.versionId)} where id = ${lit(d.id)} and current_version_id is null;`,
      `insert into evidence.data_room_entries (document_id, tenant_id, company_id, folder_code, level, updated_by_user_id) values (${lit(d.id)}, ${lit(company.tenant)}, ${lit(company.id)}, ${lit(d.folderCode ?? "other")}, ${lit(d.dataRoomLevel)}, ${lit(d.uploaderUserId)}) on conflict do nothing;`,
      audit(ctx, "document.version_registered", "document", d.id, {
        documentVersionId: d.versionId,
        versionNumber: 1,
        sizeBytes: d.sizeBytes,
        level: d.dataRoomLevel,
        demonstrationDocument: true,
      }),
      event(
        ctx,
        "evidence.document.version_created",
        { type: "document", id: d.id },
        {
          documentId: d.id,
          documentVersionId: d.versionId,
          versionNumber: 1,
          supersedesVersionId: null,
        },
        "capitalq://api/evidence",
      ),
    );
  }
  s.push("commit;");
  return s.join("\n");
}

/**
 * The founder's confirmation of Q's reading of the deck, recorded on the
 * owner's approval (22 Oct): only for an existing reading of the current
 * deck version, exactly as the review screen records it.
 */
export function renderDeckConfirmationSql({
  seedKey,
  company,
  extractionId,
  documentId,
  userId,
  authorityUserId,
  now,
}) {
  const ctx = {
    seedKey,
    key: `deck:${company.id}`,
    ids: { tenant: company.tenant, organisation: company.organisation },
    authorityUserId,
    now,
    salt: now,
    correlation: seedUuid(seedKey, "deck-confirm", extractionId),
  };
  return [
    "begin;",
    `insert into evidence.deck_extraction_confirmations (extraction_id, tenant_id, confirmed_by_user_id) values (${lit(extractionId)}, ${lit(company.tenant)}, ${lit(userId)}) on conflict (extraction_id) do nothing;`,
    audit(ctx, "deck_extraction.confirmed", "document", documentId, {
      extractionId,
      confirmedOnOwnerApproval: true,
    }),
    "commit;",
  ].join("\n");
}

/** LOCAL ONLY: the hand-transcribed fixture reading (never hosted). */
export function renderFixtureReadingSql({
  seedKey,
  company,
  document,
  fixture,
}) {
  return `insert into evidence.deck_extractions (id, tenant_id, company_id, document_id, document_version_id, prompt_version, schema_version, page_count, sections) values (${lit(seedUuid(seedKey, "fixture-reading", document.versionId))}, ${lit(company.tenant)}, ${lit(company.id)}, ${lit(document.id)}, ${lit(document.versionId)}, ${fixture.promptVersion}, ${fixture.schemaVersion}, ${fixture.pageCount}, ${json(fixture.sections)}) on conflict do nothing;`;
}
