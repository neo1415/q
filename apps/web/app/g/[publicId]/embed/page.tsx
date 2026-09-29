import { notFound } from "next/navigation";

import { ApplyExperience } from "@/features/gateq/apply-experience";
import { publicGateway } from "@/features/gateq/public-gateway";

export const dynamic = "force-dynamic";

type Props = { readonly params: Promise<{ readonly publicId: string }> };

/**
 * The gateway inside an investor's own website (GateQ spec §1: embed).
 * The only page Capital Q lets another site frame; see next.config.
 */
export default async function GatewayEmbedPage({ params }: Props) {
  const gateway = await publicGateway((await params).publicId);
  if (gateway === null) notFound();
  return (
    <main className="flex min-h-dvh w-full flex-col gap-4 p-4">
      <ApplyExperience gateway={gateway} compact />
      <p className="cq-caption text-(--cq-text-tertiary)">
        Powered by Capital Q
      </p>
    </main>
  );
}
