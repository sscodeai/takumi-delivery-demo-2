// Unit tests for the exported functions in src/summary.mjs.
// Run with: node --test *.test.mjs (or bash run-tests.sh)

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isIsoDate,
  parseTemperature,
  compareCodePoints,
  formatTimes10,
  isDeclaredHeader,
  summarize,
} from './src/summary.mjs';

// ---------------------------------------------------------------------------
// isDeclaredHeader
// ---------------------------------------------------------------------------

test('isDeclaredHeader recognises exactly the declared column header', () => {
  assert.equal(isDeclaredHeader('date,station,temperature_c'), true);
  for (const value of [
    '',
    'date,station',
    'date,station,temperature_c,extra',
    'Date,Station,Temperature_C',
    'date, station,temperature_c',
    '2024-01-01,ALPHA,10.4',
  ]) {
    assert.equal(isDeclaredHeader(value), false, `${JSON.stringify(value)} is not the header`);
  }
});

// ---------------------------------------------------------------------------
// isIsoDate
// ---------------------------------------------------------------------------

test('isIsoDate accepts ordinary valid calendar dates', () => {
  for (const value of ['2024-01-01', '2024-12-31', '1999-06-15', '0000-01-01']) {
    assert.equal(isIsoDate(value), true, `${value} should be valid`);
  }
});

test('isIsoDate applies month lengths and leap-year rules', () => {
  assert.equal(isIsoDate('2024-02-29'), true, '2024 is a leap year');
  assert.equal(isIsoDate('2000-02-29'), true, '2000 is a leap year (divisible by 400)');
  assert.equal(isIsoDate('2023-02-29'), false, '2023 is not a leap year');
  assert.equal(isIsoDate('1900-02-29'), false, '1900 is not a leap year (divisible by 100)');
  assert.equal(isIsoDate('2024-04-31'), false, 'April has 30 days');
  assert.equal(isIsoDate('2024-12-32'), false, 'December has 31 days');
});

test('isIsoDate rejects malformed and non-ISO shapes', () => {
  for (const value of [
    '',
    '2024-1-01',
    '24-01-01',
    '2024/01/01',
    '2024-13-01',
    '2024-00-10',
    '2024-01-00',
    '2024-01-01T00:00:00Z',
    'date',
  ]) {
    assert.equal(isIsoDate(value), false, `${value} should be invalid`);
  }
});

// ---------------------------------------------------------------------------
// parseTemperature
// ---------------------------------------------------------------------------

function valueOf(parsed) {
  // Reconstruct the exact decimal from { sign, digits, exp10 } as a Number.
  return Number(parsed.sign * parsed.digits) * 10 ** parsed.exp10;
}

test('parseTemperature decomposes signed integer and fraction decimals', () => {
  const cases = [
    ['10.4', 1n, 104n, -1],
    ['-2.5', -1n, 25n, -1],
    ['+3.0', 1n, 30n, -1],
    ['0.0', 1n, 0n, 0],
    ['-0.0', 1n, 0n, 0],
    ['5', 1n, 5n, 0],
    ['.5', 1n, 5n, -1],
    ['-.5', -1n, 5n, -1],
    ['1e3', 1n, 1n, 3],
    ['1.5e2', 1n, 15n, 1],
    ['2.5e-1', 1n, 25n, -2],
  ];
  for (const [input, sign, digits, exp10] of cases) {
    const parsed = parseTemperature(input);
    assert.notEqual(parsed, null, `${input} should parse`);
    assert.deepEqual(parsed, { sign, digits, exp10 }, `${input} decomposition`);
    // A negative zero field normalizes to a positive-zero decomposition.
    const expected = Number(input) === 0 ? 0 : Number(input);
    assert.equal(valueOf(parsed), expected, `${input} value round-trip`);
  }
});

test('parseTemperature rejects non-decimal and non-finite fields', () => {
  for (const value of [
    '',
    'NaN',
    'Infinity',
    '-Infinity',
    '0x10',
    '1.2.3',
    '1e',
    '--1',
    '1 0',
    '10,4',
    '1e400',
    '1e-401',
  ]) {
    assert.equal(parseTemperature(value), null, `${value} should be rejected`);
  }
});

// ---------------------------------------------------------------------------
// compareCodePoints
// ---------------------------------------------------------------------------

test('compareCodePoints orders by Unicode code point, not UTF-16 units', () => {
  assert.ok(compareCodePoints('A', 'B') < 0);
  assert.ok(compareCodePoints('Z', 'a') < 0, 'uppercase sorts before lowercase');
  assert.ok(compareCodePoints('A', 'A1') < 0, 'a prefix sorts first');
  assert.ok(compareCodePoints('abc', 'abc') === 0);
  // U+1F600 has code point 128512, which is greater than U+FFFF (65535);
  // a naive UTF-16 comparison would order the surrogate pair first.
  assert.ok(compareCodePoints('\u{1F600}', '\uFFFF') > 0);
});

// ---------------------------------------------------------------------------
// formatTimes10
// ---------------------------------------------------------------------------

test('formatTimes10 renders an integer tenths value with one decimal digit', () => {
  assert.equal(formatTimes10(110n), '11.0');
  assert.equal(formatTimes10(0n), '0.0');
  assert.equal(formatTimes10(5n), '0.5');
  assert.equal(formatTimes10(123n), '12.3');
  assert.equal(formatTimes10(-13n), '-1.3');
  assert.equal(formatTimes10(-5n), '-0.5');
});

// ---------------------------------------------------------------------------
// summarize (unit-level, no subprocess)
// ---------------------------------------------------------------------------

test('summarize returns the declared sample payload', () => {
  const sample = [
    '2024-01-01,ALPHA,10.4',
    '2024-01-01,BRAVO,-2.5',
    '2024-01-02,ALPHA,11.6',
    '2024-01-02,BRAVO,0.0',
    '',
  ].join('\n');
  assert.equal(
    summarize(sample),
    'ALPHA 2 10.4 11.6 11.0\nBRAVO 2 -2.5 0.0 -1.3\nSKIPPED 0\nTOTAL 4\n',
  );
});

test('summarize always terminates the payload with exactly one newline', () => {
  for (const input of ['', 'nonsense\n', '2024-01-01,ALPHA,1.0']) {
    const output = summarize(input);
    assert.equal(output.endsWith('\n'), true, 'ends with a newline');
    assert.equal(output.endsWith('\n\n'), false, 'does not end with a blank line');
  }
});

test('summarize ignores a leading declared header without counting it (AMB-001)', () => {
  assert.equal(
    summarize('date,station,temperature_c\n2024-01-01,ALPHA,10.4\n'),
    'ALPHA 1 10.4 10.4 10.4\nSKIPPED 0\nTOTAL 1\n',
  );
});

test('summarize treats a header-shaped data row as malformed (AMB-001)', () => {
  assert.equal(
    summarize('2024-01-01,ALPHA,10.4\ndate,station,temperature_c\n'),
    'ALPHA 1 10.4 10.4 10.4\nSKIPPED 1\nTOTAL 1\n',
  );
});

test('summarize is invariant under row permutations (REL-004)', () => {
  const rows = [
    '2024-01-01,ALPHA,10.4',
    '2024-01-01,BRAVO,-2.5',
    '2024-01-02,ALPHA,11.6',
    '2024-01-02,BRAVO,0.0',
    '2024-01-03,CHARLIE,3.3',
    'garbage',
  ];
  const expected = summarize(`${rows.join('\n')}\n`);
  const permutations = [
    [...rows].reverse(),
    [...rows].sort(),
    [...rows.slice(3), ...rows.slice(0, 3)],
    [rows[4], rows[1], rows[5], rows[0], rows[3], rows[2]],
  ];
  for (const permutation of permutations) {
    assert.equal(summarize(`${permutation.join('\n')}\n`), expected);
  }
});

test('summarize preserves additivity: station counts sum to TOTAL (REL-002)', () => {
  const output = summarize(
    [
      '2024-01-01,ALPHA,1.0',
      '2024-01-01,BRAVO,2.0',
      '2024-01-02,ALPHA,3.0',
      '2024-01-02,CHARLIE,oops',
      'no-commas-here',
      '',
    ].join('\n'),
  );
  const lines = output.trimEnd().split('\n');
  const stationLines = lines.filter((line) => !line.startsWith('SKIPPED ') && !line.startsWith('TOTAL '));
  const total = Number(lines.find((line) => line.startsWith('TOTAL ')).split(' ')[1]);
  const summed = stationLines.reduce((acc, line) => acc + Number(line.split(' ')[1]), 0);
  assert.equal(summed, total);
  assert.equal(summed, 3);
});
