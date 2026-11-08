import { randomUUID } from "node:crypto";

import type { Logger } from "@capital-q/observability";
import {
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

/**
 * Batch 13 (owner, 8 Nov 2026): the first fast-navigation call after a
 * deploy took 12.2 s over 49 database round trips; the next took 0.8 s.
 * The request pool opens its connections lazily, so the first request
 * paid every TCP + TLS + pooler handshake and the first run of each code
 * path. This pays them once, at boot, outside any request.
 *
 * Fire and forget: it starts after the server listens, never delays
 * readiness, and a failure is a log line, never a failed boot.
 *
 * The fast-navigation pass runs as a synthetic actor that belongs to no
 * tenant, so the firewall finds no grants and open_page opens nothing:
 * it reads, it writes nothing, and it can see nothing.
 */
export async function warmAfterListen(dependencies: {
  /** One trivial query; run poolMax at once so the pool opens them all. */
  readonly ping: () => Promise<unknown>;
  readonly poolMax: number;
  readonly fastNavigation?:
    ((actor: ActorContext, text: string) => Promise<unknown>) | undefined;
  readonly logger?: Logger | undefined;
  readonly now?: (() => number) | undefined;
}): Promise<void> {
  const now = dependencies.now ?? (() => performance.now());
  const started = now();
  const ms = () => Math.max(0, Math.round(now() - started));
  try {
    const pings = await Promise.allSettled(
      Array.from({ length: Math.max(1, dependencies.poolMax) }, () =>
        dependencies.ping(),
      ),
    );
    const opened = pings.filter((p) => p.status === "fulfilled").length;
    const poolMs = ms();
    let navigationMs: number | null = null;
    if (dependencies.fastNavigation !== undefined) {
      await dependencies
        .fastNavigation(warmupActor(), "open Capital Q Warmup")
        .catch(() => undefined);
      navigationMs = ms() - poolMs;
    }
    dependencies.logger?.info(
      {
        connections: opened,
        poolMax: dependencies.poolMax,
        poolMs,
        navigationMs,
        ms: ms(),
      },
      "q-api boot warm-up done",
    );
  } catch (error: unknown) {
    dependencies.logger?.warn({ err: error }, "q-api boot warm-up failed");
  }
}

/** Nobody: fresh ids every boot, in no tenant, with no membership rows. */
function warmupActor(): ActorContext {
  return {
    userId: UserIdSchema.parse(randomUUID()),
    tenantId: TenantIdSchema.parse(randomUUID()),
    organisationId: OrganisationIdSchema.parse(randomUUID()),
    membershipId: MembershipIdSchema.parse(randomUUID()),
    actorType: "HUMAN",
  };
}
