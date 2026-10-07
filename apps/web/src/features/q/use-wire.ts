"use client";

import { useSyncExternalStore } from "react";

import { subscribeWire, wireNow, type WireContracts } from "./wire";

/**
 * Q room W7: the wire's contracts in a component: null at first, then
 * re-rendered with them once they are in (wire.ts).
 */
export function useWire(): WireContracts | null {
  return useSyncExternalStore(subscribeWire, wireNow, () => null);
}
