// Outside the "use client" form: the server-rendered reviews page reads it.
export const SUBJECT_OPTIONS = [
  { value: "VERIFICATION_DECISION", label: "A verification decision" },
  { value: "READINESS_ASSESSMENT", label: "My readiness reading" },
  { value: "ACCOUNT_ACTION", label: "An action on my account" },
  { value: "Q_ASSESSMENT", label: "An assessment Q made" },
  { value: "OTHER", label: "Something else" },
] as const;
