-- Founder-stated financial figures recorded before the owner's 2026-10-28
-- rule become CONFIDENTIAL (owner decision 2026-10-29, DECISIONS 46).
--
-- The rule (founder-onboarding/src/integration/financial-claims.ts): a
-- figure the founder states or confirms is their own claim, which Q may use
-- in their own answers -- CONFIDENTIAL, reviewed providers only. About 1,256
-- earlier rows (cash, burn, revenue, runway, margin) were still stored
-- HIGHLY_CONFIDENTIAL, so Q named them as held back and the founder had to
-- say them again. The owner chose to let Q use them.
--
-- Scope, exactly: q_knowledge objects about a COMPANY, knowledge_key
-- financial.*, truth_class USER_CLAIM, visibility founder_private, not read
-- from a document (structured_value origin DOCUMENT_FIGURE stays
-- HIGHLY_CONFIDENTIAL until the founder confirms it, as before). Their
-- visibility does not change: founder_private never reaches an investor,
-- a ranking or a feed. Highly confidential source documents are untouched.
--
-- History, not overwrite: each object gains a revision that restates its
-- current values with change_reason OWNER_RECLASSIFIED_CONFIDENTIAL, and
-- only then is its classification lowered. Re-running changes nothing.

with targets as (
  select o.id, o.tenant_id, o.statement, o.structured_value, o.truth_class,
         o.evidence_status, o.confidence_class, o.valid_from, o.valid_to,
         o.current_revision_number
    from q_knowledge.objects o
   where o.subject_type = 'COMPANY'
     and o.knowledge_key like 'financial.%'
     and o.truth_class = 'USER_CLAIM'
     and o.visibility_scope = 'founder_private'
     and o.sensitivity_class = 'HIGHLY_CONFIDENTIAL'
     and coalesce(o.structured_value ->> 'origin', '') <> 'DOCUMENT_FIGURE'
   for update
),
revised as (
  insert into q_knowledge.revisions (
    tenant_id, knowledge_object_id, revision_number, statement,
    structured_value, truth_class, evidence_status, confidence_class,
    valid_from, valid_to, change_reason, created_by_type)
  select t.tenant_id, t.id, t.current_revision_number + 1,
         left(t.statement, 2000), t.structured_value, t.truth_class,
         t.evidence_status, t.confidence_class, t.valid_from, t.valid_to,
         'OWNER_RECLASSIFIED_CONFIDENTIAL', 'SYSTEM'
    from targets t
  returning id, knowledge_object_id, revision_number
)
update q_knowledge.objects o
   set sensitivity_class       = 'CONFIDENTIAL',
       current_revision_id     = r.id,
       current_revision_number = r.revision_number
  from revised r
 where o.id = r.knowledge_object_id;
