import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { getKyb } from "@capital-q/api-client";

import { getSessionUser } from "@/auth/session";
import {
  FoundSection,
  type FoundSubject,
} from "@/features/profile/found-section";
import { OwnProfileView } from "@/features/profile/own-profile-view";
import {
  loadProfileAnswers,
  loadProfileFindings,
  loadProfileImages,
  loadProfilePage,
} from "@/features/profile/profile-data";
import { apiSession, resolveOwnContext } from "@/features/q/context";
import { serverT } from "@/features/i18n/server";
import { qPitchEnabled } from "@/features/q-pitch/flag";

export const metadata: Metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

/**
 * Your profile (BIZ-002; chosen design "One page, edit in place",
 * 2026-10-21). Every value is the API's answer under the person's own
 * session; every edit goes through the same write path Q's approved
 * actions use. Photos and logos go browser -> storage directly on a signed
 * upload and are shown from short-lived signed URLs. The page itself is
 * OwnProfileView, which /dev/account-review renders with fixtures.
 */
export default async function ProfilePage() {
  const t = await serverT();
  const [user, session, context] = await Promise.all([
    getSessionUser(),
    apiSession(),
    resolveOwnContext(),
  ]);
  const [data, kyb] = await Promise.all([
    loadProfilePage(session, context),
    session === null || context.kind === "NONE"
      ? Promise.resolve(null)
      : getKyb(session).catch(() => null),
  ]);
  const { person, company, investor } = data;
  const [personImages, orgImages, answers] = await Promise.all([
    person === null
      ? Promise.resolve(null)
      : loadProfileImages(session, "PERSON", person.userId),
    company !== null
      ? loadProfileImages(session, "COMPANY", company.id)
      : investor !== null
        ? loadProfileImages(session, "INVESTOR_ORGANISATION", investor.id)
        : Promise.resolve(null),
    company === null && investor === null
      ? Promise.resolve(null)
      : loadProfileAnswers(session, context),
  ]);
  return (
    <OwnProfileView
      t={t}
      email={user?.email ?? null}
      context={context}
      data={data}
      kyb={kyb}
      personImages={personImages}
      orgImages={orgImages}
      answers={answers}
      requestKey={randomUUID()}
      qPitch={qPitchEnabled()}
      found={(subjects, visibility) => (
        <Suspense
          fallback={
            <FoundSection
              visibility={visibility}
              subjects={subjects.map((subject) => ({
                ...subject,
                findings: { status: "LOADING" },
              }))}
            />
          }
        >
          <FoundRead subjects={subjects} visibility={visibility} />
        </Suspense>
      )}
    />
  );
}

/** What Q found in public, streamed: it holds no other section. */
async function FoundRead({
  subjects,
  visibility,
}: {
  readonly subjects: readonly Omit<FoundSubject, "findings">[];
  readonly visibility: ReactNode;
}) {
  const findings = await Promise.all(
    subjects.map((subject) =>
      loadProfileFindings(subject.subjectType, subject.subjectId),
    ),
  );
  return (
    <FoundSection
      visibility={visibility}
      subjects={subjects.map((subject, at) => ({
        ...subject,
        findings: findings[at] ?? { status: "UNAVAILABLE" },
      }))}
    />
  );
}
