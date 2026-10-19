// Command line entry point for the station temperature summary.
// Usage: bash summary.sh <csv>

import { readFileSync } from 'node:fs';
import { summarize } from './summary.mjs';

const USAGE = 'usage: bash summary.sh <csv>\n';

function main(argv) {
  if (argv.length !== 1) {
    process.stderr.write(USAGE);
    return 2;
  }

  const path = argv[0];
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    process.stderr.write(`summary.sh: cannot read ${path}: ${error.code ?? error.message}\n`);
    return 1;
  }

  let output;
  try {
    output = summarize(text);
  } catch (error) {
    process.stderr.write(`summary.sh: ${error.message}\n`);
    return 1;
  }

  process.stdout.write(output);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
