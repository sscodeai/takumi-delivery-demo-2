// Behavioural tests for the `bash summary.sh <csv>` deliverable.
// Run with: node --test *.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const SCRIPT = join(ROOT, 'summary.sh');

// The sample the requirement document declares for the deliverable.
const SAMPLE = [
  '2024-01-01,ALPHA,10.4',
  '2024-01-01,BRAVO,-2.5',
  '2024-01-02,ALPHA,11.6',
  '2024-01-02,BRAVO,0.0',
  '',
].join('\n');

const SAMPLE_OUTPUT = [
  'ALPHA 2 10.4 11.6 11.0',
  'BRAVO 2 -2.5 0.0 -1.3',
  'SKIPPED 0',
  'TOTAL 4',
  '',
].join('\n');

function run(args) {
  return spawnSync('bash', [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    input: '',
  });
}

// Run the deliverable on `content` written to a fresh temporary file.
function runOnContent(content) {
  const dir = mkdtempSync(join(tmpdir(), 'takumi-summary-'));
  const file = join(dir, 'input.csv');
  try {
    writeFileSync(file, content);
    return run([file]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function stdoutLines(result) {
  return result.stdout.split('\n').filter((line) => line !== '');
}

test('declared sample produces the declared summary', () => {
  const result = runOnContent(SAMPLE);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, SAMPLE_OUTPUT);
  assert.equal(result.stderr, '');
});

test('the summary is independent of the working directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'takumi-summary-cwd-'));
  try {
    const file = join(dir, 'input.csv');
    writeFileSync(file, SAMPLE);
    const result = spawnSync('bash', [SCRIPT, file], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, SAMPLE_OUTPUT);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stdin is ignored: input is read only from the CSV path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'takumi-summary-stdin-'));
  try {
    const file = join(dir, 'input.csv');
    writeFileSync(file, '2024-01-01,ALPHA,10.4\n');
    const result = spawnSync('bash', [SCRIPT, file], {
      cwd: ROOT,
      encoding: 'utf8',
      // Valid-looking rows on stdin must not affect the result.
      input: '2024-01-01,BRAVO,99.9\n2024-01-02,BRAVO,-99.9\n',
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'ALPHA 1 10.4 10.4 10.4\nSKIPPED 0\nTOTAL 1\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the implementation references no network access', () => {
  const source = ['summary.sh', 'src/cli.mjs', 'src/summary.mjs']
    .map((file) => readFileSync(join(ROOT, file), 'utf8'))
    .join('\n');
  assert.doesNotMatch(source, /\b(?:node:)?(?:net|http|https|dns|tls|dgram)\b/, 'network module');
  assert.doesNotMatch(source, /\bfetch\s*\(/, 'fetch call');
  assert.doesNotMatch(source, /\bXMLHttpRequest\b/, 'XMLHttpRequest');
  assert.doesNotMatch(source, /\b(?:curl|wget)\b/, 'network CLI utility');
});

test('no positional argument exits non-zero with usage on stderr', () => {
  const result = run([]);
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /usage/i);
});

test('two positional arguments exit non-zero with usage on stderr', () => {
  const result = run(['a.csv', 'b.csv']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /usage/i);
});

test('unreadable input path exits non-zero', () => {
  const result = run([join(ROOT, 'does-not-exist.csv')]);
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.notEqual(result.stderr, '');
});

test('the first line is a data record, not a header', () => {
  const result = runOnContent('2024-01-01,ALPHA,10.4\n');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'ALPHA 1 10.4 10.4 10.4\nSKIPPED 0\nTOTAL 1\n');
});

test('a leading declared header is not a data record and is not counted as skipped', () => {
  const result = runOnContent('date,station,temperature_c\n2024-01-01,ALPHA,10.4\n');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'ALPHA 1 10.4 10.4 10.4\nSKIPPED 0\nTOTAL 1\n');
});

test('a header-shaped line in data position is skipped as malformed', () => {
  const result = runOnContent('2024-01-01,ALPHA,10.4\ndate,station,temperature_c\n');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'ALPHA 1 10.4 10.4 10.4\nSKIPPED 1\nTOTAL 1\n');
});

test('a non-numeric temperature row is skipped and counted', () => {
  const result = runOnContent('2024-01-01,ALPHA,10.4\n2024-01-01,BRAVO,warm\n');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'ALPHA 1 10.4 10.4 10.4\nSKIPPED 1\nTOTAL 1\n');
});

test('malformed rows never contribute to count, min, max, mean or TOTAL', () => {
  const content = [
    '2024-01-01,ALPHA,10.4',
    '2024-01-02,ALPHA,1e400',
    '2024-13-01,ALPHA,50.0',
    '2024-01-03,ALPHA,abc',
    '2024-01-04,ALPHA,1.0,extra',
  ].join('\n');
  const result = runOnContent(content);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'ALPHA 1 10.4 10.4 10.4\nSKIPPED 4\nTOTAL 1\n');
});

test('blank lines are malformed and counted, a single trailing newline is not a line', () => {
  const result = runOnContent('2024-01-01,ALPHA,10.4\n\n\n');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'ALPHA 1 10.4 10.4 10.4\nSKIPPED 2\nTOTAL 1\n');
});

test('a whitespace-only line is malformed', () => {
  const result = runOnContent('2024-01-01,ALPHA,10.4\n   \n');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'ALPHA 1 10.4 10.4 10.4\nSKIPPED 1\nTOTAL 1\n');
});

test('invalid ISO dates are malformed and valid leap days are accepted', () => {
  const content = [
    '2024-02-30,ALPHA,1.0',
    '2023-02-29,ALPHA,1.0',
    '2024-13-01,ALPHA,1.0',
    '2024-00-10,ALPHA,1.0',
    '2024-01-00,ALPHA,1.0',
    '2024-1-01,ALPHA,1.0',
    '24-01-01,ALPHA,1.0',
    '2024-02-29,ALPHA,1.0',
    '',
  ].join('\n');
  const result = runOnContent(content);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'ALPHA 1 1.0 1.0 1.0\nSKIPPED 7\nTOTAL 1\n');
});

test('non-finite and non-decimal temperature fields are malformed', () => {
  const content = [
    '2024-01-01,ALPHA,NaN',
    '2024-01-01,ALPHA,Infinity',
    '2024-01-01,ALPHA,0x10',
    '2024-01-01,ALPHA,1.2.3',
    '2024-01-01,ALPHA,1e',
    '2024-01-01,ALPHA,--1',
    '2024-01-01,ALPHA,1e400',
    '2024-01-01,ALPHA,',
    '2024-01-01,ALPHA,10.4',
    '',
  ].join('\n');
  const result = runOnContent(content);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'ALPHA 1 10.4 10.4 10.4\nSKIPPED 8\nTOTAL 1\n');
});

test('station ids are case-sensitive and printed exactly as they appear', () => {
  const content = [
    '2024-01-01,Alpha,1.0',
    '2024-01-01,ALPHA,2.0',
    '2024-01-01,alpha,3.0',
    '',
  ].join('\n');
  const result = runOnContent(content);
  assert.equal(result.status, 0);
  assert.equal(
    result.stdout,
    'ALPHA 1 2.0 2.0 2.0\nAlpha 1 1.0 1.0 1.0\nalpha 1 3.0 3.0 3.0\nSKIPPED 0\nTOTAL 3\n',
  );
});

test('stations appearing on several dates produce exactly one line each', () => {
  const content = [
    '2024-01-01,ALPHA,1.0',
    '2024-01-02,ALPHA,2.0',
    '2024-01-03,ALPHA,3.0',
    '',
  ].join('\n');
  const result = runOnContent(content);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'ALPHA 3 1.0 3.0 2.0\nSKIPPED 0\nTOTAL 3\n');
});

test('station lines are sorted by station id in code-point order', () => {
  const content = [
    '2024-01-01,BRAVO,1.0',
    '2024-01-01,ALPHA,1.0',
    '2024-01-01,alpha,1.0',
    '2024-01-01,A,1.0',
    '2024-01-01,A1,1.0',
    '',
  ].join('\n');
  const result = runOnContent(content);
  assert.equal(result.status, 0);
  const stationLines = stdoutLines(result).slice(0, 5).map((line) => line.split(' ')[0]);
  assert.deepEqual(stationLines, ['A', 'A1', 'ALPHA', 'BRAVO', 'alpha']);
});

test('counts are integers and min, max and mean carry exactly one decimal digit', () => {
  const result = runOnContent('2024-01-01,ALPHA,5\n2024-01-02,ALPHA,7\n');
  assert.equal(result.status, 0);
  const [stationLine] = stdoutLines(result);
  const fields = stationLine.split(' ');
  assert.equal(fields.length, 5);
  assert.match(fields[1], /^\d+$/);
  for (const field of fields.slice(2)) {
    assert.match(field, /^-?\d+\.\d$/);
  }
  assert.equal(stationLine, 'ALPHA 2 5.0 7.0 6.0');
});

test('a whole-number mean prints with one decimal digit', () => {
  const result = runOnContent('2024-01-01,ALPHA,10.4\n2024-01-02,ALPHA,11.6\n');
  assert.equal(result.status, 0);
  assert.equal(stdoutLines(result)[0], 'ALPHA 2 10.4 11.6 11.0');
});

test('an exactly half mean rounds half away from zero (AMB-003)', () => {
  const positive = runOnContent('2024-01-01,ALPHA,11.2\n2024-01-02,ALPHA,11.3\n');
  assert.equal(positive.status, 0);
  assert.equal(stdoutLines(positive)[0], 'ALPHA 2 11.2 11.3 11.3');

  const negative = runOnContent('2024-01-01,ALPHA,-1.2\n2024-01-02,ALPHA,-1.3\n');
  assert.equal(negative.status, 0);
  assert.equal(stdoutLines(negative)[0], 'ALPHA 2 -1.3 -1.2 -1.3');
});

test('repeated station and date rows are all aggregated (AMB-002)', () => {
  const content = [
    '2024-01-01,ALPHA,1.0',
    '2024-01-01,ALPHA,2.0',
    '2024-01-01,ALPHA,3.0',
    '2024-01-01,BRAVO,9.0',
    '',
  ].join('\n');
  const result = runOnContent(content);
  assert.equal(result.status, 0);
  assert.equal(
    result.stdout,
    'ALPHA 3 1.0 3.0 2.0\nBRAVO 1 9.0 9.0 9.0\nSKIPPED 0\nTOTAL 4\n',
  );
});

test('station counts sum to the TOTAL count', () => {
  const content = [
    '2024-01-01,ALPHA,1.0',
    '2024-01-01,BRAVO,2.0',
    '2024-01-02,ALPHA,3.0',
    '2024-01-02,CHARLIE,oops',
    'blank-ish row without commas',
    '',
  ].join('\n');
  const result = runOnContent(content);
  assert.equal(result.status, 0);
  const lines = stdoutLines(result);
  const stationLines = lines.filter((line) => !line.startsWith('SKIPPED') && !line.startsWith('TOTAL'));
  const total = Number(lines.find((line) => line.startsWith('TOTAL')).split(' ')[1]);
  const summed = stationLines.reduce((acc, line) => acc + Number(line.split(' ')[1]), 0);
  assert.equal(summed, total);
  assert.equal(total, 3);
});

test('exactly one SKIPPED line and one TOTAL line are printed', () => {
  const result = runOnContent('2024-01-01,ALPHA,1.0\nnonsense\n2024-01-02,BRAVO,2.0\n');
  assert.equal(result.status, 0);
  const lines = stdoutLines(result);
  assert.equal(lines.filter((line) => line.startsWith('SKIPPED ')).length, 1);
  assert.equal(lines.filter((line) => line.startsWith('TOTAL ')).length, 1);
  assert.equal(lines[lines.length - 2], 'SKIPPED 1');
  assert.equal(lines[lines.length - 1], 'TOTAL 2');
});

test('a file with no malformed lines prints SKIPPED 0', () => {
  const result = runOnContent('2024-01-01,ALPHA,1.0\n');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /\nSKIPPED 0\n/);
});

test('a file with two malformed lines prints SKIPPED 2', () => {
  const result = runOnContent('nope\n2024-01-01,ALPHA,1.0\nalso-nope\n');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /\nSKIPPED 2\n/);
});

test('min is never greater than max on any station line', () => {
  const content = [
    '2024-01-01,ALPHA,-5.0',
    '2024-01-02,ALPHA,12.75',
    '2024-01-01,BRAVO,0.0',
    '2024-01-02,BRAVO,0.0',
    '',
  ].join('\n');
  const result = runOnContent(content);
  assert.equal(result.status, 0);
  for (const line of stdoutLines(result)) {
    if (line.startsWith('SKIPPED') || line.startsWith('TOTAL')) {
      continue;
    }
    const [, , min, max] = line.split(' ');
    assert.ok(Number(min) <= Number(max), `${line} has min > max`);
  }
});

test('output is independent of input row order (REL-004)', () => {
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
  const reversed = rows.slice().reverse();
  const second = runOnContent(`${reversed.join('\n')}\n`);
  assert.equal(second.status, 0);
  assert.equal(second.stdout, first.stdout);
  assert.equal(
    first.stdout,
    'ALPHA 2 10.4 11.6 11.0\nBRAVO 2 -2.5 0.0 -1.3\nCHARLIE 1 3.3 3.3 3.3\n' +
      'SKIPPED 1\nTOTAL 5\n',
  );
});

test('an empty file prints SKIPPED 0 and TOTAL 0 and exits 0', () => {
  const result = runOnContent('');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'SKIPPED 0\nTOTAL 0\n');
});

test('a file that is entirely malformed still exits 0 with TOTAL 0', () => {
  const result = runOnContent('nope\n\nstill nope\n');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'SKIPPED 3\nTOTAL 0\n');
});

test('missing trailing newline does not create a phantom blank line', () => {
  const result = runOnContent('2024-01-01,ALPHA,10.4');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'ALPHA 1 10.4 10.4 10.4\nSKIPPED 0\nTOTAL 1\n');
});

test('CRLF line endings are accepted', () => {
  const result = runOnContent('2024-01-01,ALPHA,10.4\r\n2024-01-01,BRAVO,-2.5\r\n');
  assert.equal(result.status, 0);
  assert.equal(
    result.stdout,
    'ALPHA 1 10.4 10.4 10.4\nBRAVO 1 -2.5 -2.5 -2.5\nSKIPPED 0\nTOTAL 2\n',
  );
});

test('stdout carries only station lines, the SKIPPED line and the TOTAL line', () => {
  const result = runOnContent('2024-01-01,ALPHA,10.4\nbroken\n2024-01-02,BRAVO,5\n');
  assert.equal(result.status, 0);
  for (const line of stdoutLines(result)) {
    if (line.startsWith('SKIPPED ') || line.startsWith('TOTAL ')) {
      assert.match(line, /^(SKIPPED|TOTAL) \d+$/);
      continue;
    }
    assert.match(line, /^\S+ \d+ -?\d+\.\d -?\d+\.\d -?\d+\.\d$/);
  }
});

test('the summary is computed in exact decimal arithmetic', () => {
  // 0.1 + 0.2 has no exact binary representation; the exact mean is 0.15,
  // which rounds half away from zero to 0.2.
  const result = runOnContent('2024-01-01,ALPHA,0.1\n2024-01-02,ALPHA,0.2\n');
  assert.equal(result.status, 0);
  assert.equal(stdoutLines(result)[0], 'ALPHA 2 0.1 0.2 0.2');
});

test('a mean just below a half rounds down', () => {
  // Exact mean is 0.149 -> 0.1, even though float arithmetic can drift up.
  const result = runOnContent('2024-01-01,ALPHA,0.148\n2024-01-02,ALPHA,0.15\n');
  assert.equal(result.status, 0);
  assert.equal(stdoutLines(result)[0], 'ALPHA 2 0.1 0.2 0.1');
});
