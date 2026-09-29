import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ApplyExperience } from "@/features/gateq/apply-experience";
import { publicGateway } from "@/features/gateq/public-gateway";

export const dynamic = "force-dynamic";

type Props = { readonly params: Promise<{ readonly publicId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const gateway = await publicGateway((await params).publicId);
  return gateway === null
    ? { title: "Capital Q" }
    : {
        title: `${gateway.title} · Capital Q`,
        description: gateway.description ?? undefined,
      };
}

/** A gateway's own page: the link and QR an investor shares (CQ-GATE-002). */
export default async function GatewayPage({ params }: Props) {
  const gateway = await publicGateway((await params).publicId);
  if (gateway === null) notFound();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-4 py-10">
      <ApplyExperience gateway={gateway} />
      <p className="cq-caption text-(--cq-text-tertiary)">
        Powered by Capital Q
      </p>
    </main>
  );
}
