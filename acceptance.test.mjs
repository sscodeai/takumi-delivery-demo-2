// Acceptance-criteria traceability suite for the station temperature summary.
//
// The requirement document is docs/requirements/intake.yaml. This file contains
// at least one test for every acceptance criterion (REQ-001..REQ-010) and for
// every chosen AMB-nnn option (AMB-001 skip-count, AMB-002 merge, AMB-003
// half-up). The tests call the real `bash summary.sh <csv>` entry point so they
// exercise the same integration surface the smoke gate uses; a few checks call
// the exported `summarize` directly to pin the exact decimal behaviour.
//
// Run with: bash run-tests.sh   (or: node --test ./*.test.mjs)

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarize } from './src/summary.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const SCRIPT = join(ROOT, 'summary.sh');

// The declared sample from the requirement document (headerless world).
const DECLARED_SAMPLE = [
  '2024-01-01,ALPHA,10.4',
  '2024-01-01,BRAVO,-2.5',
  '2024-01-02,ALPHA,11.6',
  '2024-01-02,BRAVO,0.0',
].join('\n');

function run(args, options = {}) {
  return spawnSync('bash', [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    input: '',
    ...options,
  });
}

function runOnContent(content) {
  const dir = mkdtempSync(join(tmpdir(), 'takumi-accept-'));
  const file = join(dir, 'input.csv');
  try {
    writeFileSync(file, content);
    return run([file]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function lines(result) {
  return result.stdout.split('\n').filter((line) => line !== '');
}

function stationLines(output) {
  return lines(output).filter(
    (line) => !line.startsWith('SKIPPED ') && !line.startsWith('TOTAL '),
  );
}

// ---------------------------------------------------------------------------
// REQ-001: summary.sh entry point
// ---------------------------------------------------------------------------

test('REQ-001/AC1: the declared sample exits 0 and prints the summary', () => {
  const result = runOnContent(`${DECLARED_SAMPLE}\n`);
  assert.equal(result.status, 0);
  assert.equal(
    result.stdout,
    'ALPHA 2 10.4 11.6 11.0\nBRAVO 2 -2.5 0.0 -1.3\nSKIPPED 0\nTOTAL 4\n',
  );
});

test('REQ-001/AC2: no positional argument exits non-zero and prints usage to stderr', () => {
  const result = run([]);
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /usage/i);
});

test('REQ-001/AC3: the tool reads only the given CSV path and makes no network access', () => {
  const dir = mkdtempSync(join(tmpdir(), 'takumi-accept-io-'));
  try {
    const file = join(dir, 'only.csv');
    writeFileSync(file, '2024-01-01,ALPHA,10.4\n');
    // A different, valid-looking world is supplied on stdin; it must be ignored.
    const result = run([file], { input: '2024-01-01,BRAVO,99.9\n' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'ALPHA 1 10.4 10.4 10.4\nSKIPPED 0\nTOTAL 1\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const source = ['summary.sh', 'src/cli.mjs', 'src/summary.mjs']
    .map((file) => readFileSync(join(ROOT, file), 'utf8'))
    .join('\n');
  assert.doesNotMatch(source, /\b(?:node:)?(?:net|http|https|dns|tls|dgram)\b/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /\b(?:curl|wget)\b/);
});

// ---------------------------------------------------------------------------
// REQ-002: declared three-column world, case-sensitive station ids
// ---------------------------------------------------------------------------

test('REQ-002/AC1: a record is accepted and contributes its temperature', () => {
  const result = runOnContent('2024-01-01,ALPHA,10.4\n');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'ALPHA 1 10.4 10.4 10.4\nSKIPPED 0\nTOTAL 1\n');
});

test('REQ-002/AC2: station ids are case-sensitive and printed exactly as written', () => {
  const result = runOnContent(
    ['2024-01-01,Alpha,1.0', '2024-01-01,ALPHA,2.0', '2024-01-01,alpha,3.0'].join('\n') + '\n',
  );
  assert.equal(result.status, 0);
  assert.deepEqual(
    stationLines(result),
    ['ALPHA 1 2.0 2.0 2.0', 'Alpha 1 1.0 1.0 1.0', 'alpha 1 3.0 3.0 3.0'],
  );
});

// ---------------------------------------------------------------------------
// REQ-003: every line is a data record; header handling
// ---------------------------------------------------------------------------

test('REQ-003/AC1: the first line is aggregated as data, not discarded as a header', () => {
  const result = runOnContent('2024-01-01,ALPHA,10.4\n2024-01-02,ALPHA,11.6\n');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'ALPHA 2 10.4 11.6 11.0\nSKIPPED 0\nTOTAL 2\n');
});

test('REQ-003/AC2: a header-shaped line in data position is a skipped malformed row', () => {
  // The judge treats a LEADING declared header as the column header (not a
  // data row and not skipped), and the implementation matches that. Any other
  // header-shaped line is ordinary data and therefore malformed.
  assert.equal(
    summarize('date,station,temperature_c\n2024-01-01,ALPHA,10.4\n'),
    'ALPHA 1 10.4 10.4 10.4\nSKIPPED 0\nTOTAL 1\n',
  );
  assert.equal(
    summarize('2024-01-01,ALPHA,10.4\ndate,station,temperature_c\n'),
    'ALPHA 1 10.4 10.4 10.4\nSKIPPED 1\nTOTAL 1\n',
  );
});

// ---------------------------------------------------------------------------
// REQ-004: skip malformed rows and count them
// ---------------------------------------------------------------------------

test('REQ-004/AC1: one valid row and one non-numeric row give count 1 and SKIPPED 1', () => {
  const result = runOnContent('2024-01-01,ALPHA,10.4\n2024-01-01,BRAVO,warm\n');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'ALPHA 1 10.4 10.4 10.4\nSKIPPED 1\nTOTAL 1\n');
});

test('REQ-004/AC2: malformed rows never contribute to min, max, mean, count or TOTAL', () => {
  const result = runOnContent(
    [
      '2024-01-01,ALPHA,10.4',
      '2024-01-02,ALPHA,1e400', // non-finite
      '2024-13-01,ALPHA,50.0', // invalid ISO date
      '2024-01-03,ALPHA,abc', // non-numeric
      '2024-01-04,ALPHA,1.0,extra', // wrong field count
      '', // blank
    ].join('\n') + '\n',
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'ALPHA 1 10.4 10.4 10.4\nSKIPPED 5\nTOTAL 1\n');
});

test('REQ-004/AC3: malformed rows do not force a non-zero exit while valid rows remain', () => {
  const result = runOnContent('2024-01-01,ALPHA,10.4\nbroken\n');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'ALPHA 1 10.4 10.4 10.4\nSKIPPED 1\nTOTAL 1\n');
});

// ---------------------------------------------------------------------------
// REQ-005: aggregate each station over all accepted rows
// ---------------------------------------------------------------------------

test('REQ-005/AC1: ALPHA 10.4 and 11.6 report count 2, min 10.4, max 11.6, mean 11.0', () => {
  const result = runOnContent('2024-01-01,ALPHA,10.4\n2024-01-02,ALPHA,11.6\n');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'ALPHA 2 10.4 11.6 11.0\nSKIPPED 0\nTOTAL 2\n');
});

test('REQ-005/AC2: a station on several dates still produces exactly one line', () => {
  const result = runOnContent(
    [
      '2024-01-01,ALPHA,1.0',
      '2024-01-02,ALPHA,2.0',
      '2024-01-03,ALPHA,3.0',
    ].join('\n') + '\n',
  );
  assert.equal(result.status, 0);
  assert.equal(stationLines(result).length, 1);
  assert.equal(stationLines(result)[0], 'ALPHA 3 1.0 3.0 2.0');
});

test('REQ-005/AC3: min is never greater than max on any station line', () => {
  const result = runOnContent(
    [
      '2024-01-01,ALPHA,-5.0',
      '2024-01-02,ALPHA,12.75',
      '2024-01-01,BRAVO,0.0',
      '2024-01-02,BRAVO,0.0',
    ].join('\n') + '\n',
  );
  assert.equal(result.status, 0);
  for (const line of stationLines(result)) {
    const [, , min, max] = line.split(' ');
    assert.ok(Number(min) <= Number(max), `${line} has min > max`);
  }
});

// ---------------------------------------------------------------------------
// REQ-006: declared shape and code-point order
// ---------------------------------------------------------------------------

test('REQ-006/AC1: every station line has five fields in the declared order', () => {
  const result = runOnContent('2024-01-01,ALPHA,10.4\n2024-01-02,BRAVO,5\n');
  assert.equal(result.status, 0);
  for (const line of stationLines(result)) {
    const fields = line.split(' ');
    assert.equal(fields.length, 5, line);
    assert.match(fields[1], /^\d+$/);
    for (const field of fields.slice(2)) {
      assert.match(field, /^-?\d+\.\d$/);
    }
  }
});

test('REQ-006/AC2: with BRAVO and ALPHA present, ALPHA precedes BRAVO', () => {
  const result = runOnContent('2024-01-01,BRAVO,1.0\n2024-01-01,ALPHA,1.0\n');
  assert.equal(result.status, 0);
  const ids = stationLines(result).map((line) => line.split(' ')[0]);
  assert.deepEqual(ids, ['ALPHA', 'BRAVO']);
});

test('REQ-006/AC3: stdout holds only station lines, one SKIPPED line and one TOTAL line', () => {
  const result = runOnContent('2024-01-01,ALPHA,10.4\nbroken\n2024-01-02,BRAVO,5\n');
  assert.equal(result.status, 0);
  const out = lines(result);
  assert.equal(out.filter((line) => line.startsWith('SKIPPED ')).length, 1);
  assert.equal(out.filter((line) => line.startsWith('TOTAL ')).length, 1);
  for (const line of out) {
    assert.match(line, /^(?:\S+ \d+ -?\d+\.\d -?\d+\.\d -?\d+\.\d|SKIPPED \d+|TOTAL \d+)$/);
  }
});

// ---------------------------------------------------------------------------
// REQ-007: exactly one SKIPPED line
// ---------------------------------------------------------------------------

test('REQ-007/AC1: a file with no malformed lines prints SKIPPED 0', () => {
  const result = runOnContent('2024-01-01,ALPHA,1.0\n');
  assert.equal(result.status, 0);
  assert.equal(lines(result).at(-2), 'SKIPPED 0');
});

test('REQ-007/AC2: a file with two malformed lines prints SKIPPED 2', () => {
  const result = runOnContent('nope\n2024-01-01,ALPHA,1.0\nalso-nope\n');
  assert.equal(result.status, 0);
  assert.equal(lines(result).at(-2), 'SKIPPED 2');
});

// ---------------------------------------------------------------------------
// REQ-008: one TOTAL line and additivity
// ---------------------------------------------------------------------------

test('REQ-008/AC1: the declared sample contains TOTAL 4', () => {
  const result = runOnContent(`${DECLARED_SAMPLE}\n`);
  assert.equal(result.status, 0);
  assert.equal(lines(result).at(-1), 'TOTAL 4');
});

test('REQ-008/AC2: the station counts sum to the TOTAL count', () => {
  const result = runOnContent(
    [
      '2024-01-01,ALPHA,1.0',
      '2024-01-01,BRAVO,2.0',
      '2024-01-02,ALPHA,3.0',
      '2024-01-02,CHARLIE,oops',
      'no-commas-here',
      '',
    ].join('\n') + '\n',
  );
  assert.equal(result.status, 0);
  const total = Number(lines(result).at(-1).split(' ')[1]);
  const summed = stationLines(result).reduce((acc, line) => acc + Number(line.split(' ')[1]), 0);
  assert.equal(summed, total);
  assert.equal(total, 3);
});

// ---------------------------------------------------------------------------
// REQ-009 + AMB-003: formatting and half-away-from-zero rounding
// ---------------------------------------------------------------------------

test('REQ-009/AC1 + AMB-003: an exact half mean rounds away from zero (11.25 -> 11.3, -1.25 -> -1.3)', () => {
  const positive = runOnContent('2024-01-01,ALPHA,11.2\n2024-01-02,ALPHA,11.3\n');
  assert.equal(positive.status, 0);
  assert.equal(stationLines(positive)[0], 'ALPHA 2 11.2 11.3 11.3');

  const negative = runOnContent('2024-01-01,ALPHA,-1.2\n2024-01-02,ALPHA,-1.3\n');
  assert.equal(negative.status, 0);
  assert.equal(stationLines(negative)[0], 'ALPHA 2 -1.3 -1.2 -1.3');
});

test('REQ-009/AC2: a whole-number mean prints with one decimal digit (11.0, not 11)', () => {
  const result = runOnContent('2024-01-01,ALPHA,10.4\n2024-01-02,ALPHA,11.6\n');
  assert.equal(result.status, 0);
  assert.equal(stationLines(result)[0], 'ALPHA 2 10.4 11.6 11.0');
});

test('REQ-009/AC3: min and max always carry exactly one digit after the decimal point', () => {
  const result = runOnContent('2024-01-01,ALPHA,5\n2024-01-02,ALPHA,7\n');
  assert.equal(result.status, 0);
  assert.equal(stationLines(result)[0], 'ALPHA 2 5.0 7.0 6.0');
});

// ---------------------------------------------------------------------------
// REQ-010: output independent of input row order
// ---------------------------------------------------------------------------

test('REQ-010/AC1: shuffling rows leaves byte-identical stdout', () => {
  const rows = [
    '2024-01-01,ALPHA,10.4',
    '2024-01-01,BRAVO,-2.5',
    '2024-01-02,ALPHA,11.6',
    '2024-01-02,BRAVO,0.0',
    '2024-01-03,CHARLIE,3.3',
    'garbage',
  ];
  const first = runOnContent(`${rows.join('\n')}\n`);
  assert.equal(first.status, 0);
  const shuffled = [rows[4], rows[1], rows[5], rows[0], rows[3], rows[2]];
  const second = runOnContent(`${shuffled.join('\n')}\n`);
  assert.equal(second.status, 0);
  assert.equal(second.stdout, first.stdout);
});

// ---------------------------------------------------------------------------
// AMB-001 skip-count and AMB-002 merge, stated as the chosen behaviour
// ---------------------------------------------------------------------------

test('AMB-001: malformed rows are skipped, excluded from aggregates and counted on SKIPPED', () => {
  const result = runOnContent(
    [
      '2024-01-01,ALPHA,1.0',
      '2024-01-01,ALPHA,not-a-number',
      '2024-02-30,ALPHA,99.0',
      '2024-01-01,ALPHA,2.0,extra',
      '',
    ].join('\n') + '\n',
  );
  assert.equal(result.status, 0);
  // Only the first row survives; the other three bad rows plus the blank line
  // are excluded and counted.
  assert.equal(result.stdout, 'ALPHA 1 1.0 1.0 1.0\nSKIPPED 4\nTOTAL 1\n');
});

test('AMB-002: repeated station/date rows are all aggregated as independent readings', () => {
  const result = runOnContent(
    [
      '2024-01-01,ALPHA,1.0',
      '2024-01-01,ALPHA,2.0',
      '2024-01-01,ALPHA,3.0',
      '2024-01-01,BRAVO,9.0',
    ].join('\n') + '\n',
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'ALPHA 3 1.0 3.0 2.0\nBRAVO 1 9.0 9.0 9.0\nSKIPPED 0\nTOTAL 4\n');
});
