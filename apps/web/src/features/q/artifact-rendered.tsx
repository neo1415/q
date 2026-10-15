"use client";

import { useEffect } from "react";

import {
  clearRenderedIf,
  setRendered,
  type RenderedObject,
} from "./artifact-rendered-store";

export {
  clearRendered,
  renderedObject,
  type RenderedObject,
} from "./artifact-rendered-store";

/**
 * Mounted beside a drawn object, inside its Suspense boundary: reports it
 * drawn after commit, and gone when it unmounts. Renders a marker an
 * end-to-end check (and a person's tooling) reads.
 */
export function RenderedMark({ run, kinds }: RenderedObject) {
  const signature = kinds.join(",");
  useEffect(
    () => {
      const mine: RenderedObject = { run, kinds: [...kinds] };
      setRendered(mine);
      return () => clearRenderedIf(mine);
    },
    // The kinds are rebuilt each render; their identity is the signature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run, signature],
  );
  return (
    <span
      hidden
      data-q-artifact-rendered={run}
      data-q-artifact-kinds={signature}
    />
  );
}
