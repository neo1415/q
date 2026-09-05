// Valid JSON that is not a parser result, plus noise around it.
process.stdout.write("warning: something\n");
process.stdout.write(JSON.stringify({ unexpected: true }));
