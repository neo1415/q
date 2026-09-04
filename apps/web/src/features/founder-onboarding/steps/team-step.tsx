"use client";

import { useState, type FormEvent } from "react";

import { ChoiceList, MultiChoiceList } from "@capital-q/ui/choice-list";
import { Input } from "@capital-q/ui/input";

import { StepHeading, type StepProps } from "./step-props";

const digits = (value: string) => value.replace(/[^0-9]/g, "").slice(0, 9);

/**
 * F4. Structured team facts, recorded exactly: counts are numbers the
 * founder types, never bands turned into guesses. Functions are optional.
 */
export function TeamStep({ step, formId, busy, actions }: StepProps<"team">) {
  const saved = step.response;
  const [role, setRole] = useState<string | undefined>(saved?.role);
  const [founders, setFounders] = useState(saved?.founders ?? "");
  const [fullTime, setFullTime] = useState<string | undefined>(saved?.fullTime);
  const [teamSize, setTeamSize] = useState(saved?.teamSize ?? "");
  const [functions, setFunctions] = useState<readonly string[]>(
    saved?.functions ?? [],
  );
  const [error, setError] = useState<string | undefined>(undefined);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      role === undefined ||
      fullTime === undefined ||
      founders.length === 0 ||
      teamSize.length === 0
    ) {
      setError(
        "Answer the four structured questions to continue. Functions are optional.",
      );
      return;
    }
    if (
      Number.parseInt(founders, 10) < 1 ||
      Number.parseInt(teamSize, 10) < 1
    ) {
      setError("Counts start at one: you're on the team.");
      return;
    }
    void actions.submit({
      kind: "team",
      role,
      founders,
      fullTime,
      teamSize,
      functions: [...functions],
    });
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-7">
      <StepHeading title={step.title} prompt={step.prompt} help={step.help} />
      <ChoiceList
        id="team-role"
        name="role"
        legend="Your role"
        options={step.roleOptions}
        value={role}
        disabled={busy}
        onChange={(next) => {
          setRole(next);
          setError(undefined);
        }}
      />
      <Input
        id="team-founders"
        label="How many founders?"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={founders}
        disabled={busy}
        onChange={(event) => {
          setFounders(digits(event.target.value));
          setError(undefined);
        }}
      />
      <ChoiceList
        id="team-fulltime"
        name="fullTime"
        legend="Are the founders full-time?"
        options={step.fullTimeOptions}
        value={fullTime}
        disabled={busy}
        onChange={(next) => {
          setFullTime(next);
          setError(undefined);
        }}
      />
      <Input
        id="team-size"
        label="How many people work on the company today?"
        description="Founders included."
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={teamSize}
        disabled={busy}
        error={error}
        onChange={(event) => {
          setTeamSize(digits(event.target.value));
          setError(undefined);
        }}
      />
      <MultiChoiceList
        id="team-functions"
        name="functions"
        legend="Which of these does the founding team cover?"
        description="Optional. Choose any that apply."
        options={step.functionOptions}
        values={functions}
        disabled={busy}
        onChange={setFunctions}
      />
    </form>
  );
}
