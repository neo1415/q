"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { MyOrganisationDto } from "@capital-q/contracts";

import {
  chooseWorkspaceAction,
  keepWorkspaceAction,
} from "./workspace-actions";

const ROLE = { OWNER: "Owner", ADMIN: "Admin", MEMBER: "Member" } as const;

/**
 * Which workspace, for somebody who has more than one (owner directive
 * 2026-10-16, "Registration").
 *
 * A person can be a founder at one company and an investor at one firm, or
 * a member of several teams. Each is a separate organisation with its own
 * membership; nothing from one leaks into another. Arriving, they choose
 * where they are working instead of being dropped into whichever context
 * happened to be active last. The current one is marked, and the chooser
 * appears once per browser session.
 */
export function WorkspaceChoice({
  name,
  workspaces,
}: {
  readonly name: string | null;
  readonly workspaces: readonly MyOrganisationDto[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);

  const choose = (workspace: MyOrganisationDto) => {
    setError(null);
    setChoosing(workspace.organisationId);
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
      className="cq-stage fixed inset-0 z-(--cq-z-modal) overflow-y-auto px-6 py-10 text-(--cq-text-primary)"
      data-workspace-choice
    >
      <div className="mx-auto flex min-h-full max-w-xl flex-col justify-center gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="cq-title-lg text-balance">
            {name === null
              ? "Where are you working today?"
              : `Welcome back, ${name}.`}
          </h1>
          <p className="cq-body text-(--cq-text-secondary)">
            {name === null
              ? "You belong to more than one workspace. Each keeps its own work."
              : "Where are you working today? Each workspace keeps its own work."}
          </p>
        </div>
        <ul className="flex flex-col divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
          {workspaces.map((workspace) => (
            <li key={workspace.organisationId}>
              <button
                type="button"
                className="flex min-h-14 w-full items-center gap-3 px-3 py-3 text-start transition-colors duration-(--cq-motion-fast) hover:bg-(--cq-surface-subtle) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--cq-focus-ring) disabled:opacity-50"
                disabled={pending}
                onClick={() => choose(workspace)}
                data-workspace={workspace.organisationId}
                data-workspace-kind={workspace.kind}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="cq-body font-medium text-(--cq-text-primary)">
                    {workspace.name}
                  </span>
                  <span className="cq-body-sm text-(--cq-text-secondary)">
                    {workspace.kind === "FIRM" ? "Investing" : "Company"} ·{" "}
                    {ROLE[workspace.role]}
                    {workspace.active ? " · Last used" : ""}
                  </span>
                </span>
                <span className="cq-body-sm text-(--cq-text-secondary)">
                  {choosing === workspace.organisationId ? "Opening…" : "Open"}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {error === null ? null : (
          <p role="alert" className="cq-body-sm text-(--cq-danger)">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
