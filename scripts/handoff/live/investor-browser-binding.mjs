/** Browser-only, serialized by Playwright. No provider or network calls.
 * QAnswer has no run DOM attribute in this release. Its committed React
 * turn supplies identity; visible Markdown and card content must ALSO match.
 * This never accepts another settled answer merely because one exists. */
export function renderedInvestorAnswer({
  expected = null,
  priorRuns = [],
} = {}) {
  const normalized = (text) => {
    // Compare the complete ordered words/numbers after the renderer's
    // Markdown syntax is removed. Preserve signs, decimals and percentages;
    // a prefix, a bag of words or a matching run ID is insufficient.
    const plain = String(text ?? "")
      .replace(/\r\n?/gu, "\n")
      .split("\n")
      .filter((line) => !/^\s*[|:\s-]+\s*$/u.test(line))
      .map((line) =>
        line
          .replace(/^\s*(?:```|~~~).*$/u, "")
          .replace(/^\s*#{1,6}\s+/u, "")
          .replace(/^\s*>\s?/u, "")
          .replace(/^\[!([A-Za-z]+)\]\s*/u, "$1 ")
          .replace(/^\s*(?:[-+*]|\d+[.)])\s+/u, "")
          .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
          .replace(/(\*\*|__)(.+?)\1/gu, "$2")
          .replace(/(^|[^\w*])[*_](\S(?:.*?\S)?)[*_](?=[^\w*]|$)/gu, "$1$2")
          .replace(/`([^`]*)`/gu, "$1"),
      )
      .join("\n")
      .normalize("NFKC")
      .replace(/\u2212(?=\d)/gu, "-");
    return (
      plain.match(
        /[+-]?\d+(?:[.,]\d+)*(?:%|x)?|(?:<=|>=|[<>=€£¥$₹%+*/-])|[\p{L}\p{M}][\p{L}\p{M}\p{N}'’_-]*/gu,
      ) ?? []
    )
      .map((word) => word.toLowerCase())
      .join(" ");
  };
  const propsAbove = (element) => {
    const key = Object.keys(element).find((name) =>
      name.startsWith("__reactFiber$"),
    );
    let fiber = key === undefined ? null : element[key];
    const props = [];
    for (let depth = 0; fiber && depth < 60; depth += 1, fiber = fiber.return) {
      for (const current of [fiber, fiber.alternate]) {
        if (current?.memoizedProps) props.push(current.memoizedProps);
      }
    }
    return props;
  };
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  for (const element of document.querySelectorAll("[data-q-answer]")) {
    if (element.getClientRects().length === 0) continue;
    const body = element.querySelector(":scope > .cq-body");
    const visibleText = body?.innerText ?? "";
    if (!normalized(visibleText)) continue;
    const streaming = element.getAttribute("data-q-answer") === "streaming";
    const turn = propsAbove(element)
      .map((props) => props.turn)
      .find(
        (candidate) =>
          candidate?.kind === "Q" &&
          typeof candidate.runId === "string" &&
          typeof candidate.id === "string" &&
          candidate.streaming === streaming &&
          normalized(candidate.text) === normalized(visibleText) &&
          (expected === null
            ? !priorRuns.includes(candidate.runId)
            : !streaming &&
              candidate.runId === expected.runId &&
              candidate.id === expected.messageId &&
              candidate.text === expected.text &&
              normalized(visibleText) === normalized(expected.text)),
      );
    if (!turn) continue;
    const cardElements = [...element.querySelectorAll("[data-ac-card]")];
    const cardKeys = cardElements.map((card) =>
      card.getAttribute("data-ac-card"),
    );
    let cardCount = cardKeys.length;
    let comparison = false;
    let cardsCorrect =
      expected === null ||
      same(
        cardKeys,
        expected.cards.map((card) => card.key),
      );
    const tables = [...element.querySelectorAll("[data-ac-compare]")];
    if (expected !== null && tables.length === 1 && expected.cards.length > 0) {
      const table = tables[0];
      const columns = [...table.querySelectorAll('th[scope="col"]')];
      const names = columns.map((column) => {
        const name = column.querySelector(".cname");
        return [...(name?.childNodes ?? [])]
          .filter((node) => node.nodeType === 3)
          .map((node) => node.textContent)
          .join("")
          .trim();
      });
      const block = propsAbove(table)
        .map((props) => props.block)
        .find(
          (candidate) =>
            candidate?.kind === "ANSWER_CARDS" &&
            same(
              candidate.cards.map((card) => [
                card.key,
                card.subject?.companyId,
              ]),
              expected.cards.map((card) => [card.key, card.subject?.companyId]),
            ),
        );
      cardsCorrect =
        cardKeys.length === 0 &&
        Boolean(block) &&
        same(
          names,
          expected.cards.map((card) => card.name),
        );
      comparison = cardsCorrect;
      cardCount = columns.length;
    }
    if (!cardsCorrect) continue;
    const questions = [
      ...document.querySelectorAll(
        "[data-q-panel-person], [data-q-row='person']",
      ),
    ];
    const currentQuestionVisible =
      expected !== null &&
      questions.some(
        (question) =>
          question.getClientRects().length > 0 &&
          question.textContent.replace(/^\s*You:\s*/u, "").trim() ===
            expected.question,
      );
    if (expected !== null)
      element.setAttribute("data-cq-demo-run", expected.runId);
    return {
      rendered: true,
      runId: turn.runId,
      messageId: turn.id,
      streaming,
      textLength: visibleText.trim().length,
      cardCount,
      comparison,
      currentQuestionVisible,
    };
  }
  return null;
}
