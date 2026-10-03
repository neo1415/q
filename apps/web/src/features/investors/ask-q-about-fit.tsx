"use client";

import { Button } from "@capital-q/ui/button";

import { useGlobalQ } from "@/components/app-shell/global-q";
import { QAperture } from "@/features/q-aperture";

/**
 * "Ask Q about fit" on an investor (ux spec §9.6): opens the one Q with the
 * question as a draft; nothing is sent until the founder sends it, and the
 * list itself carries no score.
 */
export function AskQAboutFit({ name }: { readonly name: string }) {
  const { askAbout } = useGlobalQ();
  return (
    <Button
      variant="quiet"
      size="compact"
      className="min-h-11 self-start"
      onClick={() =>
        askAbout(
          `How well does ${name} fit my raise, from what they have declared publicly? What is unknown?`,
        )
      }
    >
      <QAperture state="IDLE" size="chrome" />
      Ask Q about fit
    </Button>
  );
}
