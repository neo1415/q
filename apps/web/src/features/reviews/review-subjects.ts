// Outside the "use client" form: the server-rendered reviews page reads it.
// In the order the form offers them (chosen design 2026-10-21), each with
// the one line under it that says what it covers.
export const SUBJECT_OPTIONS = [
  {
    value: "Q_ASSESSMENT",
    label: "An assessment Q made",
    description: "A score, a reading or a summary about you or your company.",
  },
  {
    value: "READINESS_ASSESSMENT",
    label: "My readiness reading",
    description: "What Q says is missing before investors see you.",
  },
  {
    value: "ACCOUNT_ACTION",
    label: "An action on my account",
    description: "Something sent, held or changed that you didn’t expect.",
  },
  {
    value: "VERIFICATION_DECISION",
    label: "A verification decision",
    description: "A verification Capital Q declined, or hasn’t decided.",
  },
  {
    value: "OTHER",
    label: "Something else",
    description: "Anything a person should look at.",
  },
] as const;
