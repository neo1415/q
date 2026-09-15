-- Demo posture, final piece (human operator decision, 2026-09-15). The
-- gateway derives a provider's justified ceiling from its privacy policy
-- class, so the model-row ceiling raised on 2026-09-19 never took effect:
-- Google stayed at PUBLIC and Gemini was never attempted. For demo and
-- development traffic only, the google provider is classed as if under an
-- enterprise contract. The metadata records the truth: this is a posture,
-- the vendor's actual terms are unchanged and unreviewed, and the class
-- must be reverted to UNREVIEWED before real customer data is processed.
update ai_ops.providers
set
  privacy_policy_class = 'ENTERPRISE_CONTRACT',
  metadata = metadata || jsonb_build_object(
    'demo_posture', true,
    'demo_posture_note',
      'privacy_policy_class set to ENTERPRISE_CONTRACT on 2026-09-15 by the human operator for demo/development traffic only. Actual terms: free tier, unreviewed. Revert before production data.',
    'actual_privacy_policy_class', 'UNREVIEWED'
  ),
  updated_at = now()
where code = 'google';
