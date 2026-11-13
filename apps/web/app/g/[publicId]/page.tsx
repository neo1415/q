import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { founderFormContext } from "@/features/gateq/form/founder-prefill";
import { GateQForm } from "@/features/gateq/form/gateq-form";
import {
  GatewayAccentStyle,
  GatewayBrandMark,
} from "@/features/gateq/gateway-brand";
import { publicGateway } from "@/features/gateq/public-gateway";
import { serverT } from "@/features/i18n/server";

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
  const t = await serverT();

  const gateway = await publicGateway((await params).publicId);
  if (gateway === null) notFound();
  const founder = await founderFormContext();
  const signedInAs = founder.prefill?.contactName ?? null;
  // Design gatepub-1: the bar, who is signed in, then the form. B6: the bar
  // carries the investing organisation's name, mark and (AA-safe) accent;
  // Capital Q stays attributed in the footer.
  return (
    <div className="min-h-dvh bg-(--cq-canvas)">
      <GatewayAccentStyle hex={gateway.organisationAccentHex} />
      <header className="sticky top-0 z-(--cq-z-sticky) flex h-14 items-center gap-3 border-t-2 border-b border-t-(--cq-accent) border-b-(--cq-border-subtle) bg-(--cq-canvas) px-4 sm:h-16 sm:px-8">
        <GatewayBrandMark gateway={gateway} />
        <span className="flex-1" />
        {signedInAs === null ? null : (
          <span className="cq-caption text-(--cq-text-tertiary)">
            {t("Signed in as")} {signedInAs}
          </span>
        )}
      </header>
      <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 px-4 pt-5 pb-16 sm:px-10 sm:pt-8">
        <GateQForm
          gateway={gateway}
          prefill={founder.prefill}
          needsCompany={founder.needsCompany}
          materials={founder.materials}
        />
        <p className="cq-caption text-(--cq-text-tertiary)">
          {t("Powered by Capital Q")}
        </p>
      </main>
    </div>
  );
}
