-- ---------------------------------------------------------------------------
-- CQ-C5-R2A — Groq provider data-use review (§21-§25)
--
-- A dated, versioned record of what Capital Q has decided a model provider
-- may be sent. It raises no data classification and lowers no firewall: the
-- Context Firewall still classifies a person's own Q conversation
-- CONFIDENTIAL, and this migration does not touch that. What changes is the
-- other side of the comparison — what one vendor's reviewed terms justify.
--
-- WHY THIS EXISTS
--
-- Before this, both configured providers sat at UNREVIEWED with model
-- ceilings of PUBLIC and INTERNAL, so every Q request — which is always at
-- least CONFIDENTIAL, because it always includes the person's own
-- conversation — was refused with SENSITIVITY_EXCEEDS_CEILING. The product
-- reached every Wave-5 layer and then declined to answer. That was correct
-- behaviour under an unreviewed vendor, and the fix is a review, not a
-- lowered classification.
--
-- WHAT WAS REVIEWED (2026-09-08)
--
--   * Inputs and Outputs are the customer's data under Groq's Services
--     Agreement.
--   * Groq states it may not use Inputs or Outputs for training or
--     fine-tuning unless the customer explicitly permits it.
--   * Ordinary inference is not retained by default, except for limited
--     reliability and abuse-investigation purposes.
--   * Groq Data Controls offers Zero Data Retention, which disables that
--     remaining retention for inference customer data.
--   * Usage metadata is still retained, and data location and subprocessor
--     questions remain open.
--
-- WHAT IS ASSERTED, AND BY WHOM
--
-- `supports_zero_retention` records that ZDR is ENABLED FOR THIS
-- ORGANISATION. That is an assertion made by the human operator on
-- 2026-09-08, recorded here because it is a fact about a console no
-- automated process in this repository can read. It was NOT verified by
-- inspecting Groq's console, and the metadata below says so in the row
-- itself rather than only in a commit message. If ZDR is ever turned off,
-- this row is wrong and must be corrected by a forward migration — which is
-- exactly why it is a row with a date on it and not a constant in code.
--
-- WHAT IS DELIBERATELY NOT DONE
--
--   * Gemini is untouched. Its free tier's terms permit training on content,
--     which is the one class that must never receive customer data, so it
--     stays UNREVIEWED at PUBLIC and remains available for public and
--     synthetic work only.
--   * Nothing reaches HIGHLY_CONFIDENTIAL or RESTRICTED. No privacy class
--     justifies those, by construction, in
--     `providerJustifiedCeiling` — approving a vendor for confidential work
--     is not approving it for everything.
-- ---------------------------------------------------------------------------

update ai_ops.providers
set
  privacy_policy_class = 'NO_TRAINING_ZERO_RETENTION',
  supports_zero_retention = true,
  metadata = jsonb_build_object(
    'review_status', 'REVIEWED',
    'policy_version', 'groq.v1',
    'reviewed_at', '2026-09-08',
    'reviewed_by', 'human operator',
    'training_use', 'NOT PERMITTED unless the customer explicitly opts in',
    'retention', 'no default retention for inference; limited reliability and abuse retention disabled by Zero Data Retention',
    'zero_data_retention',
      'ENABLED for this organisation. Asserted by the human operator on 2026-09-08 and recorded here; Capital Q has no authorised method to read the provider console, so this is an assertion, not a verification.',
    'residual_considerations',
      'usage metadata is retained; data location and subprocessors are not covered by this review',
    'terms_url', 'https://groq.com/terms-of-sale/',
    'data_controls_url', 'https://console.groq.com/docs/data-controls'
  ),
  updated_at = now()
where code = 'groq';

-- The models themselves. A provider's approved ceiling is the maximum any of
-- its models may claim; each model still carries its own, so a future model
-- with different terms can be stricter without a second provider row.
update ai_ops.models
set
  sensitivity_ceiling = 'CONFIDENTIAL',
  metadata = metadata || jsonb_build_object(
    'ceiling_basis', 'ai_ops.providers.privacy_policy_class = NO_TRAINING_ZERO_RETENTION with zero data retention enabled (groq.v1, 2026-09-08)'
  ),
  updated_at = now()
where provider_id = (select id from ai_ops.providers where code = 'groq')
  and model_code in ('openai/gpt-oss-120b', 'openai/gpt-oss-20b');

-- Gemini's row is restated rather than left implicit, so the contrast is
-- recorded at the same date as the decision that separates the two.
update ai_ops.providers
set
  metadata = metadata || jsonb_build_object(
    'review_status', 'UNREVIEWED',
    'policy_version', 'gemini.v1',
    'reviewed_at', '2026-09-08',
    'decision',
      'NOT approved for confidential customer data. Free-tier terms permit content to be used to improve the vendor''s products, which is incompatible with customer data at any classification above PUBLIC. Remains available for public and synthetic work.'
  ),
  updated_at = now()
where code = 'google';
