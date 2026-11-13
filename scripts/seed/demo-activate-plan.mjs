/**
 * Pure planning for `demo-activate.mjs` (owner direction, 13 Nov 2026):
 * curated FICTIONAL demo companies are demo data and never undergo real
 * verification. This module decides, from a read-only snapshot, which
 * companies may be touched at all and what is still missing for each. It
 * performs no I/O, so the rules are unit-tested (`demo-activate-plan.test.mjs`).
 *
 * The provenance is not invented here. Marking a person synthetic
 * (`auth.users.raw_app_meta_data.synthetic = true`, service-role only) is
 * what lets the deployment's existing attested synthetic decider decide
 * their PENDING claims, which it records as SYNTHETIC_DEMO_ATTESTATION /
 * CAPITAL_Q_SYNTHETIC_DEMO and readers see as "Demo verified (synthetic)".
 * Nothing here writes a claim, a status or a readiness state directly.
 */

/** Every seeded fictional account lives on this reserved domain. */
export const FICTIONAL_EMAIL = /^[a-z0-9._+-]+@fictional\.capitalq\.local$/i;

/**
 * The tavus-20 seed (`scripts/seed/tavus20/lib.mjs` `emailFor`) created its
 * fictional people as `+cq-` aliases of the owner's mailbox. Such an alias
 * counts as fictional ONLY when the account was also created with
 * `user_metadata.fictional_demo = true` (the seed's own marker); any other
 * alias, or any other address, is a genuine account and refuses the company.
 */
export const OWNER_SEED_ALIAS = /^adedaniel502\+cq-[a-z0-9-]+@gmail\.com$/i;

export const STEP = Object.freeze({
  MARK_SYNTHETIC: "mark-synthetic",
  SET_STAGE: "set-stage",
  REQUEST_VERIFICATION: "request-verification",
  ASSESS: "assess",
});

export const NOTE = Object.freeze({
  NEEDS_VALUE: "needs-value",
  AWAITING_SWEEP: "awaiting-sweep",
  DECIDED_NOT_VERIFIED: "decided-not-verified",
  VISIBILITY_NOT_CHOSEN: "visibility-not-chosen",
  NOT_ACTIVE: "company-not-active",
  NO_FOUNDER: "no-founder",
});

const CLAIM_TYPES = ["FOUNDER_IDENTITY", "ORGANISATION"];
/**
 * The stage vocabulary's ACTIVE codes (taxonomy vocabulary
 * 581f6374-…, seeded by 20260904180000_taxonomy_foundation.sql and read on
 * production 13 Nov). A test keeps this list equal to the migration.
 */
export const STAGE_CODES = Object.freeze([
  "pre_seed",
  "seed",
  "series_a",
  "series_b",
  "series_c_plus",
]);
/** Recognisable non-code stage wording in seed data, and the code it maps to. */
const MAPPED_STAGES = Object.freeze({
  "pre-series_a": "seed",
  "pre-series a": "seed",
  pre_series_a: "seed",
});
export const DEMO_DEFAULT_STAGE = "seed";

const inBand = (band, v) =>
  Array.isArray(band) && Number.isFinite(v) && v >= band[0] && v <= band[1];

/**
 * A company's stage for demo activation (owner direction 13 Nov: missing
 * demo requirements are completed for fictional demo data). A stage a
 * source states wins. Otherwise the value is CHOSEN by demo activation and
 * says so in `stageSource` (demo-mapped / demo-derived / demo-default) with
 * the rule in `stageRule`: never presented as anyone's statement.
 *
 *   declared  a stage code the source states
 *   raw       the source's own wording when it is not a code ("pre-series_a", "unsure")
 *   signal    { targetUsd, teamSize } from the seed world, with `bands`
 *             { raiseUsd, teamSize } (the world's own per-stage ranges)
 */
export function resolveStage({ declared, source, raw, signal, bands }) {
  if (STAGE_CODES.includes(declared))
    return { stage: declared, stageSource: source };
  const key = typeof raw === "string" ? raw.trim().toLowerCase() : null;
  if (key !== null && Object.hasOwn(MAPPED_STAGES, key))
    return {
      stage: MAPPED_STAGES[key],
      stageSource: `demo-mapped:${key}`,
      stageRule: `${source} states "${raw}", which is not a stage code; demo activation maps it to ${MAPPED_STAGES[key]}`,
    };
  if (signal && bands) {
    for (const code of STAGE_CODES) {
      if (
        inBand(bands.raiseUsd?.[code], signal.targetUsd) &&
        inBand(bands.teamSize?.[code], signal.teamSize)
      )
        return {
          stage: code,
          stageSource: "demo-derived:world-bands",
          stageRule: `${source} states ${raw === undefined ? "no stage" : `"${raw}"`}; demo activation chose the earliest stage whose seed-world raise band (USD ${bands.raiseUsd[code].join("-")}) and team band (${bands.teamSize[code].join("-")}) hold the company's raise target (USD ${Math.round(signal.targetUsd)}) and team size (${signal.teamSize})`,
        };
    }
  }
  return {
    stage: DEMO_DEFAULT_STAGE,
    stageSource: "demo-default",
    stageRule: `${source ?? "no source"} ${raw === undefined || raw === null ? "states no stage" : `states "${raw}"`} and gives no usable signal; demo activation uses ${DEMO_DEFAULT_STAGE}`,
  };
}

/** Why a person makes the company out of scope, or null when they are fictional. */
export function personRefusal(person) {
  const email = String(person.email ?? "").toLowerCase();
  if (FICTIONAL_EMAIL.test(email)) return null;
  if (OWNER_SEED_ALIAS.test(email) && person.userFictionalDemo === true)
    return null;
  if (OWNER_SEED_ALIAS.test(email))
    return `${email}: owner alias without the seed's fictional_demo marker`;
  return `${email || "(no email)"}: not a fictional account`;
}

/**
 * Whether a company may be touched at all. Refusal is by construction:
 * real demonstration companies, a manifest hold, and any attached person
 * (any membership table, any status) who is not a fictional account.
 */
export function refusalsFor(entry, snapshot) {
  const reasons = [];
  if (snapshot === null || snapshot === undefined) return ["company not found"];
  const { company, people } = snapshot;
  if (company.demonstration_data !== false)
    reasons.push(
      "demonstration_data is not false (a real demonstration company)",
    );
  if (entry.hold) reasons.push(`held by the manifest: ${entry.hold}`);
  if (!people.some((p) => p.current)) reasons.push("no current member");
  for (const person of people) {
    const why = personRefusal(person);
    if (why !== null) reasons.push(why);
  }
  return reasons;
}

const present = (v) => typeof v === "string" && v.trim().length > 0;

/** A claim's standing now, as `standingOf` in packages/verification reads it. */
export function standingOf(claim, now) {
  if (claim === null || claim === undefined) return "NONE";
  if (claim.revoked_at) return "REVOKED";
  if (claim.status === "VERIFIED") {
    if (claim.expires_at && new Date(claim.expires_at) <= now) return "EXPIRED";
    return "VERIFIED";
  }
  return claim.status;
}

/**
 * The company's current claim of each type: ORGANISATION for the
 * organisation itself; FOUNDER_IDENTITY for any current member, a verified
 * one winning (as `founderIdentityOf`). `claims` are already the highest
 * revision per subject.
 */
export function currentClaims(snapshot, now) {
  const { company, people, claims } = snapshot;
  const memberIds = new Set(
    people.filter((p) => p.current && p.profileId).map((p) => p.profileId),
  );
  const org = claims.find(
    (c) =>
      c.claim_type === "ORGANISATION" &&
      c.subject_id === company.organisation_id,
  );
  const founders = claims.filter(
    (c) => c.claim_type === "FOUNDER_IDENTITY" && memberIds.has(c.subject_id),
  );
  const founder =
    founders.find((c) => standingOf(c, now) === "VERIFIED") ??
    founders.find((c) => standingOf(c, now) === "PENDING") ??
    founders[0];
  return { FOUNDER_IDENTITY: founder ?? null, ORGANISATION: org ?? null };
}

/**
 * What is still missing for one in-scope company. Only absent things are
 * planned, so a company that is already marketplace-ready plans nothing,
 * and a value the seed world never defined is reported, never invented.
 */
export function planCompany(entry, snapshot, { now = new Date() } = {}) {
  const base = {
    companyId: entry.companyId,
    name: snapshot?.company?.canonical_name ?? entry.name,
    emails: (snapshot?.people ?? []).map((p) => p.email).sort(),
    steps: [],
    notes: [],
  };
  const refused = refusalsFor(entry, snapshot);
  if (refused.length > 0) return { ...base, refused };

  const { company, people } = snapshot;
  const steps = [];
  const notes = [];

  // (a) Every person the synthetic decider looks at must carry the marker:
  // the requester, the PERSON subject, and every tenant member not left.
  const marked = new Set();
  for (const p of people) {
    if (!p.counted || p.appSynthetic) continue;
    if (marked.has(p.authUserId)) continue;
    marked.add(p.authUserId);
    steps.push({
      kind: STEP.MARK_SYNTHETIC,
      authUserId: p.authUserId,
      email: p.email,
      reason:
        "app_metadata.synthetic absent, so the synthetic decider skips this company",
    });
  }
  const syntheticAfter = (authUserId) =>
    marked.has(authUserId) ||
    people.some((p) => p.authUserId === authUserId && p.appSynthetic);

  const founder =
    people.find((p) => p.current && p.isFounder) ??
    people.find((p) => p.current && /^founder\./i.test(p.email)) ??
    // A one-person company (the real-companies seed) acts as its only member.
    (people.filter((p) => p.current).length === 1
      ? people.find((p) => p.current)
      : null) ??
    null;
  let blocked = false;
  if (founder === null) {
    notes.push({
      kind: NOTE.NO_FOUNDER,
      reason: "no current founder to act as",
    });
    blocked = true;
  }
  if (company.company_status !== "active") {
    notes.push({
      kind: NOTE.NOT_ACTIVE,
      reason: `company_status is ${company.company_status}`,
    });
    blocked = true;
  }
  if (company.marketplace_visibility !== "network_visible") {
    // Visibility is the founder's own choice; activation never widens it.
    notes.push({
      kind: NOTE.VISIBILITY_NOT_CHOSEN,
      reason: `visibility is ${company.marketplace_visibility}; the founder's choice, not changed`,
    });
    blocked = true;
  }

  // (b) Minimum profile: the stage the manifest resolved (stated by a
  // source, or chosen by demo activation and labelled as such).
  if (!present(company.current_stage_code)) {
    if (STAGE_CODES.includes(entry.stage)) {
      const chosen = String(entry.stageSource ?? "").startsWith("demo-");
      steps.push({
        kind: STEP.SET_STAGE,
        value: entry.stage,
        stageSource: entry.stageSource,
        reason: chosen
          ? `current_stage_code absent; ${entry.stage} chosen by demo activation (${entry.stageSource}), not stated by anyone`
          : `current_stage_code absent; ${entry.stageSource ?? "seed world"} defines ${entry.stage}`,
      });
    } else {
      notes.push({
        kind: NOTE.NEEDS_VALUE,
        field: "current_stage_code",
        reason: `current_stage_code absent and no source defines one (${entry.stageSource ?? "no seed definition"})`,
      });
      blocked = true;
    }
  }
  for (const [field, ok] of [
    [
      "description",
      present(company.short_description) ||
        present(company.primary_description),
    ],
    ["headquarters_country", present(company.headquarters_country)],
  ]) {
    if (!ok) {
      notes.push({
        kind: NOTE.NEEDS_VALUE,
        field,
        reason: `${field} absent and not supplied by this tool`,
      });
      blocked = true;
    }
  }

  // (c) Verification: the workers' sweep decides PENDING claims; a claim
  // that does not exist yet is requested by the founder through the product.
  const current = currentClaims(snapshot, now);
  const missing = [];
  let allVerified = true;
  for (const type of CLAIM_TYPES) {
    const claim = current[type];
    const standing = standingOf(claim, now);
    if (standing === "VERIFIED") continue;
    allVerified = false;
    if (standing === "NONE") missing.push(type);
    else if (standing === "PENDING") {
      const requesterOk = syntheticAfter(claim.requester_auth_user_id);
      notes.push({
        kind: NOTE.AWAITING_SWEEP,
        claimType: type,
        reason: requesterOk
          ? `${type} PENDING; the workers' synthetic sweep decides it once marked`
          : `${type} PENDING but its requester is not a marked member; the sweep will not offer it`,
      });
      if (!requesterOk) blocked = true;
    } else {
      // A decided outcome (rejected, revoked, expired) is never overridden.
      notes.push({
        kind: NOTE.DECIDED_NOT_VERIFIED,
        claimType: type,
        reason: `${type} is ${standing}; a decided claim is left for a human`,
      });
      blocked = true;
    }
  }
  if (missing.length > 0 && founder !== null) {
    steps.push({
      kind: STEP.REQUEST_VERIFICATION,
      claimTypes: missing,
      reason: `no ${missing.join("/")} claim exists; the founder asks through the product`,
    });
  }

  // (d) Readiness is re-run only when it can now pass. While claims are
  // still waiting for the sweep, a later run plans it (or the decision's
  // own reconciliation already made the company ready, and nothing is left).
  const willBeVerified = allVerified && missing.length === 0;
  if (
    !blocked &&
    willBeVerified &&
    company.marketplace_readiness_state !== "marketplace_ready"
  ) {
    steps.push({
      kind: STEP.ASSESS,
      reason: `readiness is ${company.marketplace_readiness_state}; every requirement is now met`,
    });
  }
  return { ...base, founderEmail: founder?.email ?? null, steps, notes };
}

/** Counts per step and note kind, plus refused and needs-value lists. */
export function summarise(plans) {
  const count = (kind) =>
    plans.reduce(
      (n, p) => n + p.steps.filter((s) => s.kind === kind).length,
      0,
    );
  const companiesWith = (kind) =>
    plans.filter((p) => p.notes.some((n) => n.kind === kind));
  return {
    companies: plans.length,
    refused: plans
      .filter((p) => p.refused)
      .map((p) => ({
        name: p.name,
        companyId: p.companyId,
        reasons: p.refused,
      })),
    nothingToDo: plans.filter(
      (p) => !p.refused && p.steps.length === 0 && p.notes.length === 0,
    ).length,
    markSynthetic: count(STEP.MARK_SYNTHETIC),
    markSyntheticCompanies: plans.filter((p) =>
      p.steps.some((s) => s.kind === STEP.MARK_SYNTHETIC),
    ).length,
    setStage: count(STEP.SET_STAGE),
    requestVerification: count(STEP.REQUEST_VERIFICATION),
    assess: count(STEP.ASSESS),
    awaitingSweep: companiesWith(NOTE.AWAITING_SWEEP).length,
    needsValue: companiesWith(NOTE.NEEDS_VALUE).map((p) => ({
      name: p.name,
      companyId: p.companyId,
      fields: p.notes
        .filter((n) => n.kind === NOTE.NEEDS_VALUE)
        .map((n) => n.field),
    })),
    decidedNotVerified: companiesWith(NOTE.DECIDED_NOT_VERIFIED).map(
      (p) => p.name,
    ),
    visibilityNotChosen: companiesWith(NOTE.VISIBILITY_NOT_CHOSEN).map(
      (p) => p.name,
    ),
  };
}

/** Plain-text table: one block per company that has anything to say. */
export function renderPlan(plans) {
  const lines = [];
  for (const p of plans) {
    if (!p.refused && p.steps.length === 0 && p.notes.length === 0) continue;
    lines.push(`${p.name} (${p.companyId})`);
    lines.push(`  members: ${p.emails.join(", ") || "-"}`);
    if (p.refused) {
      for (const r of p.refused) lines.push(`  REFUSED  ${r}`);
      continue;
    }
    for (const s of p.steps) {
      const what =
        s.kind === STEP.MARK_SYNTHETIC
          ? `${s.kind} ${s.email}`
          : s.kind === STEP.SET_STAGE
            ? `${s.kind} ${s.value}`
            : s.kind === STEP.REQUEST_VERIFICATION
              ? `${s.kind} ${s.claimTypes.join("+")}`
              : s.kind;
      lines.push(`  STEP     ${what.padEnd(60)} ${s.reason}`);
    }
    for (const n of p.notes)
      lines.push(`  NOTE     ${n.kind.padEnd(60)} ${n.reason}`);
  }
  return lines.join("\n");
}

/**
 * The checked-in manifest, from repo sources. Sources are merged by
 * company id; the first source that speaks to the stage is the one
 * resolved (see `resolveStage`), so every entry carries a valid code and
 * an explicit `stageSource`. `devWorldIds` maps a dev-world key to a
 * company id (resolved read-only by founder email).
 */
export function buildManifest({
  fictionalBulk,
  tavus20,
  devWorld,
  devWorldIds,
  demoCompanies,
  curated,
  holds = [],
  bands,
}) {
  const byId = new Map();
  const add = (companyId, name, why, stageInput, extra = {}) => {
    if (!companyId) return;
    let hit = byId.get(companyId);
    if (!hit) {
      hit = { companyId, name, why: [] };
      byId.set(companyId, hit);
    }
    if (!hit.why.includes(why)) hit.why.push(why);
    if (stageInput && hit.stageInput === undefined) hit.stageInput = stageInput;
    Object.assign(hit, extra);
  };
  for (const c of fictionalBulk)
    add(c.companyId, c.name, `fictional-bulk world ${c.key}`, {
      declared: c.stage,
      source: `fictional-bulk world ${c.key}`,
      raw: c.rawStage,
      signal: c.signal,
    });
  for (const c of tavus20)
    add(c.companyId, c.name, `tavus-20 seed #${c.n}`, {
      declared: c.stage,
      source: `docs/seed/tavus-20/companies-full.json #${c.n}`,
      raw: c.stage ?? undefined,
    });
  for (const c of devWorld)
    add(devWorldIds[c.key], c.name, `dev fictional world ${c.key}`, {
      declared: c.stage,
      source: `apps/q-api/src/dev/fictional-world/companies.ts ${c.key}`,
      raw: c.rawStage,
    });
  for (const c of demoCompanies)
    add(c.companyId, c.name, `packages/q-pitch demo company ${c.key}`);
  for (const c of curated)
    add(
      c.companyId,
      c.name,
      c.why,
      c.stageSource === undefined
        ? undefined
        : { declared: c.stage, source: c.stageSource, raw: c.rawStage },
    );
  for (const h of holds)
    add(h.companyId, h.name, h.why, undefined, { hold: h.hold });
  return [...byId.values()]
    .map(({ stageInput, ...entry }) => ({
      ...entry,
      ...resolveStage({
        ...(stageInput ?? { source: "no repo source" }),
        bands,
      }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
