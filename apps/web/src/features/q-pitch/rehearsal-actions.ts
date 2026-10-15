"use server";

import { z } from "zod";

import { getRehearsalPartners } from "@capital-q/api-client";
import type { QRehearsalCounterpartDto } from "@capital-q/contracts";

import { qApiSession } from "@/features/q/context";

/**
 * The demo counterpart for a short Q-to-Q rehearsal (blueprint §16.1 P8),
 * chosen from the signed-in actor's OWN rehearsal partners through the
 * existing authorised listing. No id is accepted from the browser: the
 * browser names a fixture key and the server answers with one of this
 * actor's partners, or nothing.
 */
const FIXTURE_NAMES: Readonly<Record<string, RegExp>> = {
  ledgerfold: /^ledgerfold\b/iu,
  f2: /^f2\b/iu,
  "savanna-seed": /^savanna seed\b/iu,
};

const FixtureKey = z.string().regex(/^[a-z][a-z0-9-]{1,62}$/u);

export async function demoRehearsalCounterpartAction(
  fixtureKey: unknown,
): Promise<QRehearsalCounterpartDto | null> {
  const key = FixtureKey.safeParse(fixtureKey);
  const pattern = key.success ? FIXTURE_NAMES[key.data] : undefined;
  if (pattern === undefined) return null;
  const session = await qApiSession();
  if (session === null) return null;
  try {
    const partners = await getRehearsalPartners(session);
    const all = [
      ...partners.upcoming.map((u) => u.counterpart),
      ...partners.people.map((p) => p.counterpart),
    ];
    return all.find((c) => pattern.test(c.name)) ?? null;
  } catch {
    return null;
  }
}
