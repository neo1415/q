import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { founderFormContext } from "@/features/gateq/form/founder-prefill";
import { GateQForm } from "@/features/gateq/form/gateq-form";
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

/**
 * A gateway's own page: the link and QR an investor shares (CQ-GATE-002).
 * F1: the founder side is the GateQ form. Signed in, it starts from their
 * company's profile and lets them tick documents to share; signed out, it
 * asks the same questions with nothing filled in.
 */
export default async function GatewayPage({ params }: Props) {
  const gateway = await publicGateway((await params).publicId);
  if (gateway === null) notFound();
  const founder = await founderFormContext();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 px-4 py-10">
      <GateQForm
        gateway={gateway}
        prefill={founder.prefill}
        needsCompany={founder.needsCompany}
        materials={founder.materials}
      />
      <p className="cq-caption text-(--cq-text-tertiary)">
        Powered by Capital Q
      </p>
    </main>
  );
}
