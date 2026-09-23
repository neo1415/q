import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";

import { PresenceGallery } from "./presence-gallery";

export const metadata: Metadata = {
  title: "Q presence",
  robots: { index: false },
};

/**
 * Every state of Q's presence, side by side, for design review and
 * screenshots. Development only; a production build has no such page.
 */
export default function QPresenceGalleryPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return (
    <PageContainer width="content">
      <PageHeader
        title="Q presence"
        description="The seven states at the stage size and the shell size. Listening and speaking are driven here by a synthetic level; on the product they follow the microphone and the speaker."
      />
      <PresenceGallery />
    </PageContainer>
  );
}
