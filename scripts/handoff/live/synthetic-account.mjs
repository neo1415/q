// The markers a live e2e script puts on the fictional account it creates,
// matching the fictional seeds (scripts/seed/fictional-bulk/seed.mjs,
// scripts/seed/tavus20/lib.mjs): app_metadata.synthetic is the service-role
// marker the attested synthetic verification decider and the workers'
// sweep require. Without it a test founder's claims stay PENDING forever
// and the company never becomes marketplace-ready (owner, 13 Nov 2026).
//
// CQ_E2E_REAL_VERIFICATION=1 leaves the account unmarked, for a run that
// deliberately exercises the human admin queue (four-eyes) instead.
export const FICTIONAL_ACCOUNT = /^[a-z0-9._+-]+@fictional\.capitalq\.local$/i;

/** `{ user_metadata, app_metadata }` for the admin create-user body. */
export function syntheticAccountMetadata(email, userMetadata) {
  if (!FICTIONAL_ACCOUNT.test(email))
    throw new Error("fictional accounts only (@fictional.capitalq.local)");
  if (process.env.CQ_E2E_REAL_VERIFICATION === "1")
    return { user_metadata: userMetadata };
  return {
    user_metadata: { ...userMetadata, synthetic: true, fictional_demo: true },
    app_metadata: { synthetic: true, fictional_demo: true },
  };
}
