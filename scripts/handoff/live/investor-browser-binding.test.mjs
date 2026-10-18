import assert from "node:assert/strict";
import { test } from "node:test";
import { renderedInvestorAnswer } from "./investor-browser-binding.mjs";

const cards = [
  { key: "company-one", name: "One", subject: { companyId: "one" } },
  { key: "company-two", name: "Two", subject: { companyId: "two" } },
];
const expected = {
  runId: "fresh-run",
  messageId: "fresh-answer",
  question: "Current question?",
  text: "**One** fits at 3.8%; **Two** does not fit at -2.5%.",
  cards,
};
function fixture({
  visible = "One fits at 3.8%; Two does not fit at -2.5%.",
  runId = expected.runId,
  messageId = expected.messageId,
  keys = cards.map((card) => card.key),
  streaming = false,
  table = null,
} = {}) {
  const root = {
    getClientRects: () => [{}],
    getAttribute: () => (streaming ? "streaming" : "settled"),
    setAttribute: () => {},
    querySelector: () => ({ innerText: visible }),
    querySelectorAll: (selector) =>
      selector === "[data-ac-card]"
        ? keys.map((key) => ({ getAttribute: () => key }))
        : table
          ? [table]
          : [],
    __reactFiber$test: {
      memoizedProps: {
        turn: {
          kind: "Q",
          id: messageId,
          runId,
          text: expected.text,
          streaming,
        },
      },
    },
  };
  globalThis.document = {
    querySelectorAll: (selector) =>
      selector === "[data-q-answer]" ? [root] : [],
  };
  return root;
}
test("fresh canonical answer and exact visible cards pass; missing question remains reported", () => {
  fixture();
  const result = renderedInvestorAnswer({ expected });
  assert.equal(result.rendered, true);
  assert.equal(result.cardCount, 2);
  assert.equal(result.currentQuestionVisible, false);
});
test("stale run/message identity cannot borrow a matching visible answer", () => {
  fixture({ runId: "old-run" });
  assert.equal(renderedInvestorAnswer({ expected }), null);
  fixture({ messageId: "old-answer" });
  assert.equal(renderedInvestorAnswer({ expected }), null);
});
test("matching React identity cannot stand in for a complete visible answer", () => {
  for (const visible of [
    "One fits at 3.8%",
    "One fits at 38%; Two does not fit at -2.5%.",
    "One fits at 3.8%; Two does fit at -2.5%.",
    "One fits at 3.8%; Two does not fit at 2.5%.",
  ]) {
    fixture({ visible });
    assert.equal(renderedInvestorAnswer({ expected }), null);
  }
});
test("streaming, wrong/extra/reordered cards and another fresh run all fail", () => {
  fixture({ streaming: true });
  assert.equal(renderedInvestorAnswer({ expected }), null);
  for (const keys of [
    ["foreign"],
    ["company-two", "company-one"],
    [...cards.map((card) => card.key), "extra"],
  ]) {
    fixture({ keys });
    assert.equal(renderedInvestorAnswer({ expected }), null);
  }
  fixture();
  assert.equal(renderedInvestorAnswer({ priorRuns: [expected.runId] }), null);
});
test("committed alternate React props are accepted only with matching visible content", () => {
  const root = fixture({ messageId: "old-answer" });
  root.__reactFiber$test.alternate = {
    memoizedProps: {
      turn: {
        kind: "Q",
        id: expected.messageId,
        runId: expected.runId,
        text: expected.text,
        streaming: false,
      },
    },
  };
  assert.equal(renderedInvestorAnswer({ expected }).rendered, true);
});
test("D7 table needs exact visible columns and canonical company IDs", () => {
  const table = {
    querySelectorAll: () =>
      cards.map((card) => ({
        querySelector: () => ({
          childNodes: [{ nodeType: 3, textContent: card.name }],
        }),
      })),
    __reactFiber$test: {
      memoizedProps: { block: { kind: "ANSWER_CARDS", cards } },
    },
  };
  fixture({ keys: [], table });
  assert.equal(renderedInvestorAnswer({ expected }).comparison, true);
  table.__reactFiber$test.memoizedProps.block.cards = cards.map((card) => ({
    ...card,
    subject: { companyId: "foreign-company" },
  }));
  assert.equal(renderedInvestorAnswer({ expected }), null);
});
