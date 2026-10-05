import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ApplyExperience } from "@/features/gateq/apply-experience";
import { publicGateway } from "@/features/gateq/public-gateway";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false } };

type Props = { readonly params: Promise<{ readonly publicId: string }> };

/**
 * The gateway inside an investor's own website (GateQ spec §1: embed; P7:
 * the "Do we fit? Ask Q" panel `gateq.js` opens). The only page Capital Q
 * lets another site frame; see next.config. It reads nothing of the host
 * page, sets no cookie of its own, and keeps the founder's session token in
 * memory only, because a third-party frame cannot rely on storage.
 */
export default async function GatewayEmbedPage({ params }: Props) {
  const gateway = await publicGateway((await params).publicId);
  if (gateway === null) notFound();
  return (
    <main className="flex min-h-dvh w-full flex-col">
      <ApplyExperience gateway={gateway} compact />
    </main>
  );
}
