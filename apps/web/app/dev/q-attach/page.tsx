import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { composeBrandStyle } from "@/features/brand-theme/brand-compose";
import { brandPreset } from "@/features/brand-theme/brand-presets";
import { BrandStyle } from "@/features/brand-theme/brand-style";

import { QAttachHarness } from "./q-attach-harness";

// Read per request: the harness's gate is the running server's setting.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Q attach harness",
  robots: { index: false },
};

/**
 * Lane 8: Q's real composer and attachments store, over an upload and a Q
 * that the browser reaches at `/dev/q-attach/upload` and `/dev/q-attach/ask`
 * -- paths no server serves: the browser suite answers them with fixtures
 * (apps/web/e2e/q-attach.spec.ts), so nothing here reaches Q, the database,
 * storage or a provider. `?preset=black_gold` dresses it in that preset.
 *
 * Development only; a production build serves it only when
 * CQ_DEV_PREVIEW=1 is set on that server.
 */
export default async function QAttachHarnessPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (
    process.env.NODE_ENV === "production" &&
    process.env["CQ_DEV_PREVIEW"] !== "1"
  ) {
    notFound();
  }
  const params = await searchParams;
  const raw = params["preset"];
  const preset = brandPreset(Array.isArray(raw) ? raw[0] : raw);
  return (
    <>
      <BrandStyle
        css={composeBrandStyle({ presetKey: preset.key, primaryHex: null })}
      />
      <QAttachHarness />
    </>
  );
}
