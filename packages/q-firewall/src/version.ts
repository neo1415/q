import { Q_CONTEXT_FIREWALL_POLICY_VERSION } from "@capital-q/contracts";

/**
 * The policy generation every plan is stamped with (packet §43-44). A
 * change to any rule in this package — a scope's default label or
 * sensitivity, a purpose's candidate set, a combination rule, the
 * evaluation order — is a new version, so a stored run can be audited
 * against exactly the policy that allowed its context. Never "latest".
 */
export const CONTEXT_FIREWALL_POLICY_VERSION =
  Q_CONTEXT_FIREWALL_POLICY_VERSION;

/**
 * How long a plan is trusted before retrieval must ask again. A plan is a
 * decision at an instant, not a bearer token: membership, shares and
 * relationships change, and a resumed run always re-plans regardless.
 */
export const CONTEXT_PLAN_REVALIDATE_AFTER_MS = 15 * 60 * 1000;
