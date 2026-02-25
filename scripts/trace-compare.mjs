#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function printHelp() {
  process.stdout.write(`Usage:\n  node scripts/trace-compare.mjs --baseline <metrics.json> --candidate <metrics.json> [--out <report.json>] [--fail-on-regression]\n\nOptions:\n  --baseline <path>        Baseline metrics file produced by trace-export\n  --candidate <path>       Candidate metrics file produced by trace-export\n  --out <path>             Optional output file path (prints to stdout when omitted)\n  --fail-on-regression     Exit non-zero when any tracked metric regresses\n  --help                   Show this help\n`);
}

function parseArgs(argv) {
  const args = {
    baselinePath: null,
    candidatePath: null,
    outPath: null,
    failOnRegression: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (token === "--baseline") {
      args.baselinePath = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (token === "--candidate") {
      args.candidatePath = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (token === "--out") {
      args.outPath = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (token === "--fail-on-regression") {
      args.failOnRegression = true;
    }
  }

  return args;
}

function getPathValue(input, path, fallback = 0) {
  let current = input;
  for (const segment of path) {
    if (current === null || typeof current !== "object") {
      return fallback;
    }
    current = current[segment];
  }

  return typeof current === "number" && Number.isFinite(current)
    ? current
    : fallback;
}

function toFixed(value) {
  return Number(value.toFixed(3));
}

function createMetric(name, baseline, candidate, lowerIsBetter = true) {
  const delta = candidate - baseline;
  const deltaPct = baseline === 0 ? (candidate === 0 ? 0 : 100) : (delta / baseline) * 100;
  let status = "unchanged";

  if (delta !== 0) {
    if (lowerIsBetter) {
      status = delta < 0 ? "improved" : "regressed";
    } else {
      status = delta > 0 ? "improved" : "regressed";
    }
  }

  return {
    name,
    baseline,
    candidate,
    delta: toFixed(delta),
    delta_pct: toFixed(deltaPct),
    status,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (args.baselinePath === null || args.candidatePath === null) {
    throw new Error("Missing required --baseline or --candidate argument");
  }

  const baselinePath = resolve(args.baselinePath);
  const candidatePath = resolve(args.candidatePath);
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const candidate = JSON.parse(readFileSync(candidatePath, "utf8"));

  const metrics = [
    createMetric(
      "renderer_main.total_ms",
      getPathValue(baseline, ["renderer_main", "total_ms"]),
      getPathValue(candidate, ["renderer_main", "total_ms"]),
    ),
    createMetric(
      "renderer_main.long_tasks.count",
      getPathValue(baseline, ["renderer_main", "long_tasks", "count"]),
      getPathValue(candidate, ["renderer_main", "long_tasks", "count"]),
    ),
    createMetric(
      "renderer_main.long_tasks.max_ms",
      getPathValue(baseline, ["renderer_main", "long_tasks", "max_ms"]),
      getPathValue(candidate, ["renderer_main", "long_tasks", "max_ms"]),
    ),
    createMetric(
      "plugin_function_call.total_ms",
      getPathValue(baseline, ["plugin_function_call", "total_ms"]),
      getPathValue(candidate, ["plugin_function_call", "total_ms"]),
    ),
    createMetric(
      "plugin_function_call.max_ms",
      getPathValue(baseline, ["plugin_function_call", "max_ms"]),
      getPathValue(candidate, ["plugin_function_call", "max_ms"]),
    ),
    createMetric(
      "layout.update_layout_tree.total_ms",
      getPathValue(baseline, ["layout", "update_layout_tree", "total_ms"]),
      getPathValue(candidate, ["layout", "update_layout_tree", "total_ms"]),
    ),
    createMetric(
      "layout.layout.total_ms",
      getPathValue(baseline, ["layout", "layout", "total_ms"]),
      getPathValue(candidate, ["layout", "layout", "total_ms"]),
    ),
    createMetric(
      "layout.paint.total_ms",
      getPathValue(baseline, ["layout", "paint", "total_ms"]),
      getPathValue(candidate, ["layout", "paint", "total_ms"]),
    ),
    createMetric(
      "gc.major.total_ms",
      getPathValue(baseline, ["gc", "major", "total_ms"]),
      getPathValue(candidate, ["gc", "major", "total_ms"]),
    ),
  ];

  const regressed = metrics.filter((metric) => metric.status === "regressed");
  const improved = metrics.filter((metric) => metric.status === "improved");
  const unchanged = metrics.filter((metric) => metric.status === "unchanged");

  const report = {
    compared_at: new Date().toISOString(),
    baseline_file: baselinePath,
    candidate_file: candidatePath,
    summary: {
      improved: improved.length,
      regressed: regressed.length,
      unchanged: unchanged.length,
      overall: regressed.length > 0 ? "regressed" : "improved_or_unchanged",
    },
    metrics,
  };

  const formatted = JSON.stringify(report, null, 2);
  if (args.outPath !== null) {
    const outPath = resolve(args.outPath);
    writeFileSync(outPath, formatted + "\n", "utf8");
    process.stdout.write(`Wrote comparison to ${outPath}\n`);
  } else {
    process.stdout.write(formatted + "\n");
  }

  if (args.failOnRegression && regressed.length > 0) {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`trace-compare failed: ${message}\n`);
  process.exitCode = 1;
}
