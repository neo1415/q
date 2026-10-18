"use client";

import { useEffect, useState } from "react";

import type { FitCompanyDto } from "@capital-q/contracts";

import { fitProfilesAction } from "./fit-actions";

/**
 * One company's fit with the reader's own mandate, for any surface that
 * shows a company (ADR 0052; B3). Drop-in for the profile's FitPanelSlot:
 *
 *   const fit = useCompanyFit(companyId);
 *   <FitPanel companyId={companyId} name={name} fit={fit} />
 *
 * `NONE` covers every reason there is no fit to show (not an investor, no
 * mandate yet, a company this reader may not see, the Q API unreachable):
 * the surface hides the panel rather than guessing.
 */

export type CompanyFit =
  | { readonly status: "LOADING" }
  | { readonly status: "READY"; readonly fit: FitCompanyDto }
  | { readonly status: "NONE" };

export type FitProfilesPort = (
  companyIds: readonly string[],
) => Promise<readonly FitCompanyDto[] | null>;

export function useCompanyFit(
  companyId: string,
  options: {
    /** A fit already in hand (server-rendered, fixtures); skips the read. */
    readonly initial?: FitCompanyDto | null | undefined;
    readonly port?: FitProfilesPort | undefined;
  } = {},
): CompanyFit {
  const { initial, port = fitProfilesAction } = options;
  const [state, setState] = useState<CompanyFit>(
    initial === undefined
      ? { status: "LOADING" }
      : initial === null
        ? { status: "NONE" }
        : { status: "READY", fit: initial },
  );
  useEffect(() => {
    if (initial !== undefined) return;
    let live = true;
    port([companyId])
      .then((items) => {
        if (!live) return;
        const fit = items?.find((item) => item.companyId === companyId);
        setState(
          fit === undefined ? { status: "NONE" } : { status: "READY", fit },
        );
      })
      .catch(() => {
        if (live) setState({ status: "NONE" });
      });
    return () => {
      live = false;
    };
  }, [companyId, initial, port]);
  return state;
}
