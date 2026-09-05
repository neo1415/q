// Writes far more than the sandbox permits, without ever producing a result.
const chunk = "x".repeat(64 * 1024);
for (let index = 0; index < 512; index += 1) {
  process.stdout.write(chunk);
}
