"use client";

import { QAperture } from "../q-aperture";

/**
 * The voice surface between two lines (founder live 2026-10-05: "it's
 * either the form or the Q presence voice, not a mix").
 *
 * When Q's first minute hands a person over to their setup by voice, the
 * welcome line ends and the interview's line starts on the next screen.
 * Between the two, this holds the same stage — Q thinking, one plain line
 * — so the person never sees the typed chat or the form flash past on
 * the way from one spoken conversation to the next.
 */
export function VoiceHandover({ line }: { readonly line: string }) {
  return (
    <div
      className="cq-stage fixed inset-0 z-(--cq-z-modal) flex flex-col items-center justify-center gap-6 px-6 text-(--cq-text-primary)"
      role="status"
      aria-live="polite"
      data-voice-handover
    >
      <QAperture state="THINKING" size="stage" />
      <p className="cq-body text-center text-(--cq-text-secondary)">{line}</p>
    </div>
  );
}
