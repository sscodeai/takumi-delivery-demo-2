# takumi-delivery-demo-2

Delivery target for the takumi unattended chain — a FRESH repository, so a delivery must be implemented from scratch rather than verified from history.

## Deliverable: station temperature summary

`summary.sh` reads a headerless CSV of `date,station,temperature_c` records and
prints a per-station summary followed by one `SKIPPED` line and one `TOTAL`
line.

```sh
bash summary.sh <csv>
```

### Input

Three comma-separated fields per line, in file order:

- `date` — ISO calendar date, `YYYY-MM-DD`
- `station` — case-sensitive station id, printed exactly as it appears
- `temperature_c` — finite decimal number of degrees Celsius

There is no header row: the first line is a data record. A line is therefore a
data record unless it is the *leading* declared column header: a first line that
is exactly `date,station,temperature_c` names the columns, so it is excluded
from every aggregate and from `TOTAL` and is not counted on `SKIPPED` either. A
header-shaped line anywhere else is an ordinary data line and is malformed.

### Output

```text
<station> <count> <min> <max> <mean>   one line per station, sorted by id in code-point order
SKIPPED <count>                        always printed exactly once
TOTAL <count>                          always printed exactly once
```

`count` fields are integers; `min`, `max` and `mean` always carry exactly one
decimal digit. The station counts sum to the `TOTAL` count.

### Decisions

- **AMB-001 (skip-count)** — a line is malformed when it does not have exactly
  three comma-separated fields, when its date is not a valid ISO date, or when
  its temperature is not a finite decimal number. Blank lines are malformed.
  Malformed lines are skipped, excluded from every station line and from
  `TOTAL`, and counted on the `SKIPPED` line.
- **AMB-002 (merge)** — repeated rows for the same station and date are
  independent readings; every occurrence contributes to count, min, max and
  mean.
- **AMB-003 (half-up)** — a value that falls exactly halfway between two
  one-decimal values is rounded away from zero. All arithmetic is exact decimal
  arithmetic, so rounding does not depend on binary floating point drift.

Success exits with status 0. Invoking the script without exactly one positional
argument exits non-zero and prints a usage message on stderr. The tool makes no
network access and reads no input other than the given CSV path.

## Tests

```sh
bash run-tests.sh
```

`run-tests.sh` runs the unit and integration suites and exits non-zero on
failure. The suites are also discoverable directly:

```sh
node --test *.test.mjs
```

## Layout

- `summary.sh` — the entry point (`bash summary.sh <csv>`)
- `src/cli.mjs` — argument handling and I/O
- `src/summary.mjs` — parsing, aggregation and formatting
- `summary.test.mjs` — behavioural (integration) tests for the deliverable
- `summary.unit.test.mjs` — unit tests for the exported summary functions
- `acceptance.test.mjs` — acceptance-criteria traceability suite (one test per REQ-nnn criterion and per AMB-nnn decision)
- `run-tests.sh` — the discoverable test entry point for the smoke gate
