# Scripts to compare devtools traces

## How to use:

bun run trace:export -- --trace Trace-20260225T165633.json --out metrics-baseline.json
bun run trace:export -- --trace Trace-new.json --out metrics-candidate.json
bun run trace:compare -- --baseline metrics-baseline.json --candidate metrics-candidate.json
