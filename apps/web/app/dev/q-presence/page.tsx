import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { Q_APERTURE_STATES, type QApertureState } from "@/features/q-aperture";

import { ApertureGallery } from "./presence-gallery";

export const metadata: Metadata = {
  title: "Q Aperture",
  robots: { index: false },
};

/**
 * Every state of the Q Aperture, on the app surface and on the stage, at
 * the stage size and the dock size, for design review and the acceptance
 * checks (spec §15, UX-02). Development only; a production build has no
 * such page.
 *
 * `?states=IDLE,THINKING` narrows the states (the idle frame-count check
 * renders IDLE alone); `?sizes=dock` or `?sizes=stage` narrows the sizes.
 */
export default async function QApertureGalleryPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  const params = await searchParams;
  const list = (value: string | string[] | undefined) =>
    (Array.isArray(value) ? value.join(",") : (value ?? ""))
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  const wanted = list(params["states"]);
  const states = Q_APERTURE_STATES.filter(
    (state: QApertureState) => wanted.length === 0 || wanted.includes(state),
  );
  const sizes = list(params["sizes"]);
  return (
    <PageContainer width="content">
      <PageHeader
        title="Q Aperture"
        description="The nine states on the app surface and on the stage, at the stage size and the dock size. Listening and speaking follow a synthetic level here; in the product they follow the microphone and the speaker."
      />
      <ApertureGallery
        states={states}
        showStage={sizes.length === 0 || sizes.includes("stage")}
        showDock={sizes.length === 0 || sizes.includes("dock")}
      />
    </PageContainer>
  );
}
