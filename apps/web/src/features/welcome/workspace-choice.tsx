"use client";

import "@/features/relationships/crm.css";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { MyOrganisationDto } from "@capital-q/contracts";
import { cx } from "@capital-q/ui";

import {
  AccountToastProvider,
  useAccountToast,
} from "@/features/settings/account-kit";

import {
  chooseWorkspaceAction,
  keepWorkspaceAction,
} from "./workspace-actions";
import { useT } from "@/features/i18n/language";

const ROLE = {
  OWNER: "an owner",
  ADMIN: "an admin",
  MEMBER: "a member",
} as const;

function monogram(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/u)
      .filter((word) => /^[\p{L}\p{N}]/u.test(word))
      .slice(0, 2)
      .map((word) => word[0] ?? "")
      .join("")
      .toUpperCase() || "?"
  );
}

/** "Investor workspace. You are an admin": what it is and who they are there. */
export function workspaceLine(workspace: MyOrganisationDto): string {
  const kind =
    workspace.kind === "FIRM" ? "Investor workspace" : "Company workspace";
  return `${kind}. You are ${ROLE[workspace.role]}`;
}

/**
 * Which workspace, for somebody who has more than one (owner directive
 * 2026-10-16, "Registration"; chosen design "Choose a workspace",
 * 2026-10-21).
 *
 * A person can be a founder at one company and an investor at one firm, or
 * a member of several teams. Each is a separate organisation with its own
 * membership; nothing from one leaks into another. Arriving, they choose
 * where they are working instead of being dropped into whichever context
 * happened to be active last. Each card says what kind of workspace it is
 * and their role there; the one they used last says so. The chooser
 * appears once per browser session.
 */
export function WorkspaceChoice(props: {
  /** Their name; the design asks the question without it. */
  readonly name: string | null;
  readonly workspaces: readonly MyOrganisationDto[];
}) {
  return (
    <AccountToastProvider>
      <Choice workspaces={props.workspaces} />
    </AccountToastProvider>
  );
}

function Choice({
  workspaces,
}: {
  readonly workspaces: readonly MyOrganisationDto[];
}) {
  const t = useT();
  const toast = useAccountToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);

  const choose = (workspace: MyOrganisationDto) => {
    setError(null);
    setChoosing(workspace.organisationId);
    toast(t(`Opening ${workspace.name}…`));
    start(async () => {
      const out = workspace.active
        ? await keepWorkspaceAction()
        : await chooseWorkspaceAction(workspace.organisationId);
      if (!out.ok) {
        setError(out.message);
        setChoosing(null);
        return;
      }
      router.push("/home");
      router.refresh();
    });
  };

  return (
    <div
      className="cq-stage fixed inset-0 z-(--cq-z-modal) overflow-y-auto text-(--cq-text-primary)"
      data-workspace-choice
    >
      <header className="sticky top-0 z-(--cq-z-sticky) flex h-14 items-center border-b border-(--cq-border-subtle) bg-(--cq-canvas) px-4 sm:h-16 sm:px-8">
        <span className="text-lg font-semibold tracking-[-0.01em]">
          Capital Q
        </span>
      </header>
      <main className="cq-crm-stagger mx-auto flex max-w-[640px] flex-col gap-[18px] px-4 pt-4 pb-28 sm:pt-[60px]">
        <span
          aria-hidden="true"
          className="inline-grid size-14 place-items-center self-start rounded-full border-2 border-(--cq-accent) text-[22px] font-semibold text-(--cq-accent) shadow-[0_0_0_6px_var(--cq-accent-soft)]"
        >
          Q
        </span>
        <h1 className="m-0 text-[27px] leading-[1.15] font-semibold tracking-[-0.025em] text-balance sm:text-[34px]">
          {t("Where are you working today?")}
        </h1>
        <p className="m-0 text-lg leading-normal text-(--cq-text-secondary)">
          {t("You belong to more than one workspace. Each keeps its own work.")}
        </p>
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {workspaces.map((workspace) => {
            const picked = choosing === workspace.organisationId;
            return (
              <li key={workspace.organisationId}>
                <button
                  type="button"
                  className={cx(
                    "cq-crm-lift grid min-h-[76px] w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3.5 rounded-[14px] border bg-(--cq-surface-raised) p-4 text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring) disabled:cursor-default",
                    picked
                      ? "border-(--cq-accent) shadow-[0_0_0_1px_var(--cq-accent)]"
                      : "border-(--cq-border-subtle)",
                  )}
                  disabled={pending}
                  aria-busy={picked}
                  onClick={() => choose(workspace)}
                  data-workspace={workspace.organisationId}
                  data-workspace-kind={workspace.kind}
                >
                  <span
                    aria-hidden="true"
                    className="grid size-9 place-items-center rounded-[8px] bg-[var(--cq-tile,var(--cq-text-primary))] text-xs font-semibold text-[var(--cq-on-tile,var(--cq-text-inverse))]"
                  >
                    {monogram(workspace.name)}
                  </span>
                  <span className="min-w-0">
                    <b className="block truncate text-base font-semibold">
                      {workspace.name}
                    </b>
                    <span className="text-[13px] text-(--cq-text-secondary)">
                      {t(workspaceLine(workspace))}
                    </span>
                  </span>
                  <span className="text-xs text-(--cq-text-tertiary)">
                    {picked
                      ? t("Opening…")
                      : workspace.active
                        ? t("Last used")
                        : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {error === null ? null : (
          <p role="alert" className="m-0 text-sm text-(--cq-text-primary)">
            {error}
          </p>
        )}
        <span className="text-xs text-(--cq-text-tertiary)">
          {t(
            "Switch any time from your name in the sidebar. Nothing moves between workspaces.",
          )}
        </span>
      </main>
    </div>
  );
}
