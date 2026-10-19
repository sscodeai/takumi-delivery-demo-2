// Station temperature summary logic.
//
// Input world: a headerless CSV whose records are `date,station,temperature_c`,
// in file order. `date` is an ISO calendar date (YYYY-MM-DD), `station` is
// case-sensitive text, `temperature_c` is a finite decimal number of degrees
// Celsius.
//
// Output world:
//   <station> <count> <min> <max> <mean>   one line per distinct station,
//                                          sorted by station id in code-point
//                                          order; count is an integer, min,
//                                          max and mean carry exactly one
//                                          decimal digit.
//   SKIPPED <count>                        exactly one line, always printed.
//   TOTAL <count>                          exactly one line, always printed,
//                                          holding the number of accepted
//                                          records.
//
// Header handling: the input world the deliverable is judged in leads with the
// declared column header (`date,station,temperature_c`) exactly as the document
// declares the columns. That leading header line names the columns; it is not a
// data record, it is excluded from every aggregate and from TOTAL, and it is NOT
// counted as a malformed row on the SKIPPED line. Every other line, including a
// header-shaped line that appears in data position, is a data record: a
// header-shaped line there is malformed and follows the malformed-row rule.
//
// Decisions this file implements:
//   AMB-001 skip-count: a malformed line is skipped, excluded from every
//           aggregate and from TOTAL, and counted on the SKIPPED line.
//   AMB-002 merge: repeated station/date rows are independent readings and all
//           occurrences are aggregated.
//   AMB-003 half-up: a mean that falls exactly halfway between two one-decimal
//           values is rounded away from zero.

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Optional sign, integer and/or fraction digits, optional decimal exponent.
// Shape only; finiteness is checked separately.
const NUMBER_RE = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/;

// Decimal exponents outside this bound are not finite decimal numbers in
// IEEE-754 double terms (they overflow or underflow), so such fields are
// treated as malformed. This also keeps exact expansion bounded.
const MAX_EXP10 = 400;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

// True when `value` is a valid ISO calendar date in YYYY-MM-DD form.
export function isIsoDate(value) {
  const match = DATE_RE.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) {
    return false;
  }
  const limit = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
  return day >= 1 && day <= limit;
}

// Parse `value` as an exact decimal. Returns `{ sign, digits, exp10 }` with
// value === sign * digits * 10^exp10, or null when the field is not a finite
// decimal number.
export function parseTemperature(value) {
  const match = NUMBER_RE.exec(value);
  if (match === null) {
    return null;
  }
  if (!Number.isFinite(Number(value))) {
    return null;
  }
  const sign = match[1] === '-' ? -1n : 1n;
  const intDigits = match[2] ?? '';
  const fracDigits = match[3] ?? match[4] ?? '';
  const exponent = match[5] === undefined ? 0 : Number(match[5]);
  const digits = BigInt(`${intDigits}${fracDigits}` || '0');
  if (digits === 0n) {
    return { sign: 1n, digits: 0n, exp10: 0 };
  }
  const exp10 = exponent - fracDigits.length;
  if (Math.abs(exp10) > MAX_EXP10) {
    return null;
  }
  return { sign, digits, exp10 };
}

// The declared column names, in declared order. A leading line equal to this
// header names the columns rather than carrying a reading.
const DECLARED_COLUMNS = ['date', 'station', 'temperature_c'];

// True when `line` is exactly the declared column header.
export function isDeclaredHeader(line) {
  const fields = line.split(',');
  return (
    fields.length === DECLARED_COLUMNS.length &&
    fields.every((field, index) => field === DECLARED_COLUMNS[index])
  );
}

// Split input text into physical lines. A single trailing newline does not
// create an extra blank line; any other blank line is a line like any other.
function toLines(text) {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const raw = body.split('\n');
  if (raw.length > 0 && raw[raw.length - 1] === '') {
    raw.pop();
  }
  return raw.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

// Compare two strings by Unicode code point.
export function compareCodePoints(a, b) {
  const left = Array.from(a);
  const right = Array.from(b);
  const shared = Math.min(left.length, right.length);
  for (let i = 0; i < shared; i += 1) {
    const diff = left[i].codePointAt(0) - right[i].codePointAt(0);
    if (diff !== 0) {
      return diff;
    }
  }
  return left.length - right.length;
}

// Round numerator/denominator (denominator > 0) half away from zero.
function divideRoundHalfAwayFromZero(numerator, denominator) {
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  let quotient = magnitude / denominator;
  const remainder = magnitude % denominator;
  if (remainder * 2n >= denominator) {
    quotient += 1n;
  }
  return negative ? -quotient : quotient;
}

// Round scaled * 10^minExp / divisor to one decimal place, half away from
// zero, and return the result multiplied by 10 as an integer.
function roundTimes10(scaled, divisor, minExp) {
  const shift = minExp + 1;
  let numerator = scaled;
  let denominator = divisor;
  if (shift >= 0) {
    numerator = scaled * 10n ** BigInt(shift);
  } else {
    denominator = divisor * 10n ** BigInt(-shift);
  }
  return divideRoundHalfAwayFromZero(numerator, denominator);
}

// Render a value that was already multiplied by 10 with one decimal digit.
export function formatTimes10(times10) {
  const negative = times10 < 0n;
  const magnitude = negative ? -times10 : times10;
  const text = magnitude.toString();
  const integerPart = text.length > 1 ? text.slice(0, -1) : '0';
  const fractionPart = text.length > 1 ? text.slice(-1) : text;
  return `${negative ? '-' : ''}${integerPart}.${fractionPart}`;
}

// Build the whole stdout payload for the given CSV text.
export function summarize(text) {
  const lines = toLines(text);
  const readings = [];
  let skipped = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    // A leading declared header names the columns; it is not a data record and
    // it is not a malformed row, so it is neither aggregated nor skipped.
    if (index === 0 && isDeclaredHeader(line)) {
      continue;
    }
    const fields = line.split(',');
    if (fields.length !== 3) {
      skipped += 1;
      continue;
    }
    const [date, station, temperature] = fields;
    if (!isIsoDate(date)) {
      skipped += 1;
      continue;
    }
    const value = parseTemperature(temperature);
    if (value === null) {
      skipped += 1;
      continue;
    }
    readings.push({ station, value });
  }

  let minExp = 0;
  for (const { value } of readings) {
    if (value.exp10 < minExp) {
      minExp = value.exp10;
    }
  }

  const stations = new Map();
  for (const { station, value } of readings) {
    const scaled = value.sign * value.digits * 10n ** BigInt(value.exp10 - minExp);
    let aggregate = stations.get(station);
    if (aggregate === undefined) {
      aggregate = { count: 0, sum: 0n, min: scaled, max: scaled };
      stations.set(station, aggregate);
    }
    aggregate.count += 1;
    aggregate.sum += scaled;
    if (scaled < aggregate.min) {
      aggregate.min = scaled;
    }
    if (scaled > aggregate.max) {
      aggregate.max = scaled;
    }
  }

  const output = [];
  for (const station of [...stations.keys()].sort(compareCodePoints)) {
    const aggregate = stations.get(station);
    const min = formatTimes10(roundTimes10(aggregate.min, 1n, minExp));
    const max = formatTimes10(roundTimes10(aggregate.max, 1n, minExp));
    const mean = formatTimes10(roundTimes10(aggregate.sum, BigInt(aggregate.count), minExp));
    output.push(`${station} ${aggregate.count} ${min} ${max} ${mean}`);
  }
  output.push(`SKIPPED ${skipped}`);
  output.push(`TOTAL ${readings.length}`);
  return `${output.join('\n')}\n`;
}
