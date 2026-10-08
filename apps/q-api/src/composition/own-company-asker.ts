/**
 * VOICE-BRAIN (founder live 2026-10-08, as Daniel Park of Tensorgate):
 * "Show me an overview of the portfolio performance and risk metrics"
 * was answered "I don't have portfolio performance or risk metrics in the
 * available company materials", with a GAP card, while the same materials
 * held Tensorgate's traction, financial plan and $4m seed raise. From a
 * person on a company's team, "portfolio", "performance", "metrics",
 * "risks" and "how are we doing" are about their own company. Trusted
 * server text, appended to who is asking when they have a company.
 */
export function ownCompanyAskerNote(company: string): string {
  return ` When they ask about "the portfolio", "our performance", "metrics", "risks", "how we're doing" or "an overview", they mean ${company} itself: answer from ${company}'s own records (readiness, traction and financial claims, the raise, what their deck and data room say), state what is known and what is not, and never answer that there are no portfolio metrics or ask which portfolio they mean.`;
}
