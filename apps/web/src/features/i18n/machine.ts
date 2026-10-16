import "server-only";

import { getUiText } from "@capital-q/api-client";

import { qApiSession } from "@/features/q/context";

import { registerMachineCatalogue, type UiLanguage } from "./messages";
import type { MachineUiText } from "./language";

/**
 * Q's machine translations of the interface for a language, as the Q API
 * serves them (any-language interface, 2026-10-16). Capital Q's own
 * product copy, the same for every person, so one process-wide cache
 * serves everyone: a complete language is re-read every ten minutes, one
 * still being translated every fifteen seconds. English needs none; a
 * failed read is English for now, never a broken page.
 */
const COMPLETE_MS = 10 * 60_000;
const FILLING_MS = 15_000;

const CACHE = new Map<
  UiLanguage,
  { readonly at: number; readonly value: MachineUiText }
>();

export async function machineUiText(
  language: UiLanguage,
): Promise<MachineUiText | null> {
  if ((language.split("-")[0] ?? "").toLowerCase() === "en") return null;
  const hit = CACHE.get(language);
  const now = Date.now();
  if (
    hit !== undefined &&
    now - hit.at < (hit.value.complete ? COMPLETE_MS : FILLING_MS)
  ) {
    registerMachineCatalogue(language, hit.value.entries);
    return hit.value;
  }
  try {
    const session = await qApiSession();
    if (session === null) return hit?.value ?? null;
    const served = await getUiText(session, language);
    const value: MachineUiText = {
      entries: served.entries,
      complete: served.complete,
    };
    CACHE.set(language, { at: now, value });
    // Server components translate with it in this render too.
    registerMachineCatalogue(language, value.entries);
    return value;
  } catch {
    return hit?.value ?? null;
  }
}
