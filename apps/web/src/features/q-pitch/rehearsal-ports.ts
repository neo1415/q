import type { QRehearsalDto } from "@capital-q/contracts";
import type { RehearsalPorts, RehearsalRead } from "@capital-q/q-pitch";

import {
  finishRehearsalAction,
  readRehearsalAction,
  sayInRehearsalAction,
  startRehearsalAction,
  type RehearsalResult,
} from "@/features/rehearsal/rehearsal-actions";

import { demoRehearsalCounterpartAction } from "./rehearsal-actions";

/**
 * Short Q-to-Q rehearsal ports over the EXISTING rehearsal session server
 * actions (Lane G owns them; this only calls them). Each call is the same
 * authorised, entitlement-checked path a person's own rehearsal uses.
 *
 * Cost: every counterpart reply is a real model turn. Use this only in an
 * approved live run (owner cap: Lane P, 2 short rehearsals of about 30 s).
 */
function readOf(result: RehearsalResult): RehearsalRead | null {
  if (!result.ok) return null;
  const dto: QRehearsalDto = result.value;
  return {
    rehearsalId: dto.id,
    status: dto.status,
    turns: dto.turns.map((turn) => ({ from: turn.from, text: turn.text })),
    reviewReady: dto.review !== null,
  };
}

export function rehearsalPorts(fixtureKey: string): RehearsalPorts {
  return {
    start: async () => {
      const counterpart = await demoRehearsalCounterpartAction(fixtureKey);
      if (counterpart === null) return null;
      return readOf(
        await startRehearsalAction({
          kind: counterpart.kind,
          counterpartId: counterpart.id,
        }),
      );
    },
    say: async (id, text) => readOf(await sayInRehearsalAction(id, text)),
    finish: async (id) => readOf(await finishRehearsalAction(id)),
    read: async (id) => readOf(await readRehearsalAction(id)),
    now: () => performance.now(),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}
