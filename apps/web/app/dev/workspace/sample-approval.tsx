"use client";

import { useEffect } from "react";

import { requestApproval } from "@/features/q/control/approval-requests";
import { QActPrompts } from "@/features/q/control/q-act-prompts";

/** Batch 8 harness: Q's approval prompt with a fixture payload; Approve runs nothing real. */
export function SampleApproval() {
  useEffect(() => {
    requestApproval({
      id: "button.send-questions",
      summary: () => "Send 3 questions to Babatunde Oyelaran",
      prepare: () => ({
        To: "Babatunde Oyelaran",
        "Question 1":
          "What is your monthly burn, and your runway after this round?",
        "Question 2":
          "What is Market size today, and where does the figure come from?",
        "Question 3":
          "What is Pricing today, and where does the figure come from?",
      }),
      execute: () => Promise.resolve("DONE"),
    });
  }, []);
  return <QActPrompts />;
}
