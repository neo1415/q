"use client";

import { useRef } from "react";

import type { RelationshipSideDetailsRead } from "@capital-q/contracts";

import { PipelineImportScreen } from "@/features/relationships/pipeline-import-screen";
import type { PipelineImportOps } from "@/features/relationships/pipeline-import-ops";
import {
  RelationshipSideDetailsCard,
  type SideDetailsOps,
} from "@/features/relationships/relationship-side-details";

import {
  FIXTURE_DOCUMENT_ID,
  FIXTURE_SIDE_DETAILS,
  fixtureApplied,
  fixturePreview,
} from "./fixtures";

/**
 * The CRM import screen over fictional in-memory ops, for design review
 * and the browser checks (apps/web/e2e/pipeline-import.spec.ts). The file
 * is never uploaded anywhere: the first read answers "still being checked
 * for safety" once, as the real scan does, then the fixture proposal. The
 * last apply request is exposed on `window.__importHarness`.
 */
export function PipelineImportHarness() {
  const reads = useRef(0);
  const ops: PipelineImportOps = {
    upload: async () => {
      await wait(250);
      return { ok: true, documentId: FIXTURE_DOCUMENT_ID };
    },
    prepare: async (input) => {
      await wait(300);
      reads.current += 1;
      if (reads.current === 1) {
        return {
          ok: false,
          retry: true,
          message: "Checking the file for safety…",
        };
      }
      return { ok: true, value: fixturePreview(input.mapping) };
    },
    apply: async (input) => {
      (window as { __importHarness?: unknown }).__importHarness = input;
      await wait(600);
      const resolved = input.resolutions.filter(
        (one) => one.choice !== "SKIP" && one.choice !== "KEEP_PRIVATE",
      ).length;
      const kept = input.resolutions.filter(
        (one) => one.choice === "KEEP_PRIVATE",
      ).length;
      return { ok: true, value: fixtureApplied(resolved, kept) };
    },
  };
  return <PipelineImportScreen side="INVESTOR" ops={ops} scanWaitMs={400} />;
}

/** The record's "Your pipeline" card over in-memory saves. */
export function SideDetailsHarness() {
  const state = useRef<RelationshipSideDetailsRead>(FIXTURE_SIDE_DETAILS);
  const ops: SideDetailsOps = {
    save: async ({ request }) => {
      await wait(250);
      const before = state.current.details;
      const owner =
        request.ownerMembershipId === undefined
          ? before.owner
          : request.ownerMembershipId === null
            ? null
            : {
                membershipId: request.ownerMembershipId,
                name:
                  state.current.members.find(
                    (m) => m.membershipId === request.ownerMembershipId,
                  )?.name ?? null,
              };
      const details = {
        ...before,
        ...(request.stage === undefined ? {} : { stage: request.stage }),
        ...(request.stageLabel === undefined
          ? {}
          : { stageLabel: request.stageLabel }),
        owner,
        ...(request.source === undefined ? {} : { source: request.source }),
        ...(request.introducerName === undefined
          ? {}
          : { introducerName: request.introducerName }),
        ...(request.introducerEmail === undefined
          ? {}
          : { introducerEmail: request.introducerEmail }),
        ...(request.expected === undefined
          ? {}
          : { expected: request.expected }),
        ...(request.priority === undefined
          ? {}
          : { priority: request.priority }),
        revision: before.revision + 1,
      };
      state.current = { ...state.current, details };
      (window as { __sideHarness?: unknown }).__sideHarness = request;
      return { ok: true, value: details };
    },
    reload: async () => {
      await wait(100);
      return { ok: true, value: state.current };
    },
  };
  return (
    <RelationshipSideDetailsCard
      relationshipId={FIXTURE_SIDE_DETAILS.details.relationshipId}
      side="INVESTOR"
      read={{ kind: "READ", value: FIXTURE_SIDE_DETAILS }}
      ops={ops}
    />
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
