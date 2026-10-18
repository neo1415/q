import type {
  GateqUnicornPotentialDto,
  UnicornPotentialDto,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

/** Current assessment enrichment; never changes the frozen submitted dossier. */
export function createGateqUnicornReader(ports: {
  readonly onError?: ((error: unknown) => void) | undefined;
  readonly premium: (actor: ActorContext) => Promise<boolean>;
  readonly companies: (
    actor: ActorContext,
    ids: readonly string[],
    audience: "INVESTOR" | "FOUNDER",
  ) => Promise<ReadonlyMap<string, string>>;
  readonly investorMayRead: (
    actor: ActorContext,
    companyId: string,
  ) => Promise<boolean>;
  readonly current: (
    companyIds: readonly string[],
  ) => Promise<ReadonlyMap<string, UnicornPotentialDto>>;
}) {
  const read = async (
    actor: ActorContext,
    applicationIds: readonly string[],
    audience: "INVESTOR" | "FOUNDER",
  ): Promise<ReadonlyMap<string, GateqUnicornPotentialDto>> => {
    if (
      actor.actorType !== "HUMAN" ||
      applicationIds.length === 0 ||
      !(await ports.premium(actor))
    )
      return new Map();
    const ids = [...new Set(applicationIds)].slice(0, 100);
    const linked = await ports.companies(actor, ids, audience);
    const companies = [...new Set(ids.flatMap((id) => linked.get(id) ?? []))];
    const visible =
      audience === "FOUNDER"
        ? companies
        : (
            await Promise.all(
              companies.map(async (companyId) =>
                (await ports.investorMayRead(actor, companyId))
                  ? companyId
                  : null,
              ),
            )
          ).filter((id): id is string => id !== null);
    if (visible.length === 0) return new Map();
    const values = await ports.current(visible);
    const allowed = new Set(visible);
    const result = new Map<string, GateqUnicornPotentialDto>();
    for (const id of ids) {
      const companyId = linked.get(id);
      const assessment =
        companyId === undefined || !allowed.has(companyId)
          ? undefined
          : values.get(companyId);
      if (companyId !== undefined && assessment !== undefined)
        result.set(id, { companyId, assessment });
    }
    return result;
  };
  return (
    actor: ActorContext,
    applicationIds: readonly string[],
    audience: "INVESTOR" | "FOUNDER",
  ) =>
    read(actor, applicationIds, audience).catch((error: unknown) => {
      ports.onError?.(error);
      return new Map<string, GateqUnicornPotentialDto>();
    });
}
