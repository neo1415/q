// Emits the request it was given as extracted text, which is how the test
// proves a filename crosses the boundary as data and never as a command.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const request = JSON.parse(
  readFileSync(join(process.argv[2], "request.json"), "utf8"),
);
const input = readFileSync(join(process.argv[2], "input.bin"), "utf8");
process.stdout.write(
  JSON.stringify({
    ok: true,
    extractorId: "fixture",
    extractorVersion: "1.0.0",
    output: {
      blocks: [
        { kind: "paragraph", text: request.filename, locator: { index: 0 } },
        { kind: "paragraph", text: input, locator: { index: 1 } },
      ],
      metadata: { parser: "fixture", parserVersion: "1.0.0" },
    },
  }),
);
