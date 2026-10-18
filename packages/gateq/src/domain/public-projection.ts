import {
  PublicGatewaySchema,
  type GatewayPolicy,
  type PublicGateway,
} from "../contracts/index.js";

/**
 * What the world may see of a published gateway (CQ-GATE-001 §19–§20).
 *
 * Built as a whitelist rather than by removing fields from the private
 * object. A redaction is a list of things somebody remembered to delete,
 * and the failure mode is silent: a field added upstream later appears in
 * public output because nobody updated the list. Constructing the public
 * shape from named parts inverts that — a new private field is invisible
 * here until somebody deliberately adds it.
 *
 * A CLOSED gateway still has a public projection. Hiding it would turn "we
 * are not open to unsolicited applications" into "this link is wrong",
 * which is worse for the founder and no safer for the investor (§20).
 */
export function publicProjectionOf(input: {
  readonly policy: GatewayPolicy;
  readonly organisationDisplayName: string;
}): PublicGateway | null {
  const { policy, organisationDisplayName } = input;
  const { gateway, version } = policy;
  // Only a published version of an active gateway has a public existence.
  // A draft is not a quieter gateway; it is not a gateway yet.
  if (version.status !== "PUBLISHED" || version.publishedAt === null) {
    return null;
  }
  if (gateway.status !== "ACTIVE") return null;

  return PublicGatewaySchema.parse({
    publicId: gateway.publicId,
    organisationDisplayName,
    title: version.publicTitle,
    description: version.publicDescription,
    inboundMode: version.inboundMode,
    acceptingApplications: version.inboundMode !== "CLOSED",
    // What is asked about, never the configured answers. "Sector" is a
    // useful thing for a founder to know; the exact node ids an investor
    // will accept are their own commercial position.
    criteria: [...policy.criteria]
      .sort((a, b) => a.position - b.position)
      .map((criterion) => ({
        label: criterion.label,
        requiredness: criterion.requiredness,
        dimension: criterion.config.type,
      })),
    publishedAt: version.publishedAt,
  });
}
