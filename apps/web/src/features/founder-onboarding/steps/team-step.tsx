"use client";

import { useState, type FormEvent } from "react";

import { ChoiceList, MultiChoiceList } from "@capital-q/ui/choice-list";

import { StepHeading, type StepProps } from "./step-props";

/** F4. Structured team facts; the narrative is its own optional step. */
export function TeamStep({ step, formId, busy, actions }: StepProps<"team">) {
  const saved = step.response;
  const [founders, setFounders] = useState<string | undefined>(saved?.founders);
  const [fullTime, setFullTime] = useState<string | undefined>(saved?.fullTime);
  const [role, setRole] = useState<string | undefined>(saved?.role);
  const [functions, setFunctions] = useState<readonly string[]>(
    saved?.functions ?? [],
  );
  const [teamSize, setTeamSize] = useState<string | undefined>(saved?.teamSize);
  const [error, setError] = useState<string | undefined>(undefined);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      founders === undefined ||
      fullTime === undefined ||
      role === undefined ||
      teamSize === undefined
    ) {
      setError(
        "Answer the four structured questions to continue. Functions are optional.",
      );
      return;
    }
    void actions.submit({
      kind: "team",
      founders,
      fullTime,
      role,
      functions: [...functions],
      teamSize,
    });
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-7">
      <StepHeading title={step.title} prompt={step.prompt} help={step.help} />
      <ChoiceList
        id="team-founders"
        name="founders"
        legend="How many founders?"
        options={step.founderOptions}
        value={founders}
        disabled={busy}
        onChange={setFounders}
      />
      <ChoiceList
        id="team-fulltime"
        name="fullTime"
        legend="Full-time?"
        options={step.fullTimeOptions}
        value={fullTime}
        disabled={busy}
        onChange={setFullTime}
      />
      <ChoiceList
        id="team-role"
        name="role"
        legend="Your role"
        options={step.roleOptions}
        value={role}
        disabled={busy}
        onChange={setRole}
      />
      <MultiChoiceList
        id="team-functions"
        name="functions"
        legend="Key functions the founders cover"
        description="Optional. Choose any that apply."
        options={step.functionOptions}
        values={functions}
        disabled={busy}
        onChange={setFunctions}
      />
      <ChoiceList
        id="team-size"
        name="teamSize"
        legend="Team size today"
        options={step.teamSizeOptions}
        value={teamSize}
        disabled={busy}
        error={error}
        onChange={(next) => {
          setTeamSize(next);
          setError(undefined);
        }}
      />
    </form>
  );
}
