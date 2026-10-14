const { chromium } = require(
  require.resolve("@playwright/test", {
    paths: [process.cwd(), process.env.CQ_TOOL_CHECKOUT ?? "/workspace/q"],
  }),
);
(async () => {
  const b = await chromium.launch({
    executablePath: process.env.CQ_CHROMIUM ?? "/usr/bin/chromium",
  });
  let receipts = [];
  for (const width of [1440, 390]) {
    const p = await b.newPage({ viewport: { width, height: 900 } });
    await p.goto(
      "http://127.0.0.1:4321/design/relationship-hub/review/index.html",
    );
    await p.addScriptTag({
      path: require.resolve("axe-core/axe.min.js", {
        paths: [process.cwd(), process.env.CQ_TOOL_CHECKOUT ?? "/workspace/q"],
      }),
    });
    let axe = await p.evaluate(() =>
      axe.run(document, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"],
        },
      }),
    );
    let keyboard = [];
    for (let i = 0; i < 8; i++) {
      await p.keyboard.press("Tab");
      keyboard.push(
        await p.evaluate(() => ({
          tag: document.activeElement.tagName,
          text: document.activeElement.textContent.trim().slice(0, 60),
          outline: getComputedStyle(document.activeElement).outlineStyle,
        })),
      );
    }
    receipts.push({
      width,
      violations: axe.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        nodes: v.nodes.map((n) => n.target),
      })),
      passes: axe.passes.length,
      incomplete: axe.incomplete.map((x) => x.id),
      keyboard,
      nativeVideoControls: await p
        .locator("video")
        .evaluateAll((v) => v.every((x) => x.controls)),
    });
    await p.close();
  }
  console.log(JSON.stringify(receipts, null, 2));
  await b.close();
  if (receipts.some((r) => r.violations.length || !r.nativeVideoControls))
    process.exit(1);
})();
