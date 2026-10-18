-- Restore the reviewed provider posture for Google Gemini (CQ-REC-002R).
--
-- Migrations 20260919 (model ceilings → CONFIDENTIAL) and 20260921
-- (provider class → ENTERPRISE_CONTRACT) recorded a demo posture: "for demo
-- and development traffic only", with the vendor's actual terms unchanged
-- and unreviewed. Inspection against the locked sources shows that posture
-- cannot stand as data:
--
--   * doc 13 §57.2 and doc 15 §62: free Gemini endpoints are not eligible
--     for private Capital Q customer data until terms are reviewed; "free"
--     is a cost property, not a privacy classification;
--   * the gateway derives a provider's justified ceiling from its privacy
--     class (CQ-C5-R2A), so relabelling the class as ENTERPRISE_CONTRACT
--     does not describe a demo — it clears confidential customer material
--     for the vendor in every environment the migration reaches, hosted
--     included;
--   * config's deployment environment is operational metadata and "no
--     permission decision may depend on it", so there is no legitimate
--     environment-scoped provider eligibility to express here;
--   * the repository's own database tests (rls/320_ai_ops) assert
--     google = UNREVIEWED and Gemini ceilings = PUBLIC.
--
-- What the demo intent legitimately allows is kept: migration 20260920's
-- routing preference (Gemini first for dialogue, synthesis and extraction)
-- stays, and takes effect exactly where Gemini is eligible — PUBLIC work,
-- synthetic development data, and any request a reviewed paid tier later
-- justifies. Confidential customer traffic routes to the provider whose
-- reviewed terms carry it (Groq under zero retention), as before 20260919.
--
-- The rows keep their history: the demo-posture metadata is retained with
-- `demo_posture = false` and a restoration note, and the model ceilings
-- return to the value the provider review justifies.

update ai_ops.providers
set
  privacy_policy_class = 'UNREVIEWED',
  metadata = metadata || jsonb_build_object(
    'demo_posture', false,
    'demo_posture_restored_at', '2026-09-18',
    'demo_posture_restoration_note',
      'ENTERPRISE_CONTRACT posture from 20260921 reverted to the reviewed class: free-tier terms are unreviewed for confidential data (doc 13 §57.2, doc 15 §62). Routing preference for eligible (PUBLIC) work is unchanged.'
  ),
  updated_at = now()
where code = 'google';

update ai_ops.models
set
  sensitivity_ceiling = 'PUBLIC',
  metadata = metadata || jsonb_build_object(
    'ceiling_basis',
      'PUBLIC: the google provider is UNREVIEWED for anything above public data (doc 13 §57.2). The 20260919 demo raise to CONFIDENTIAL was reverted on 2026-09-18; a reviewed paid tier is the route to a higher ceiling.'
  ),
  updated_at = now()
where provider_id = (select id from ai_ops.providers where code = 'google');
