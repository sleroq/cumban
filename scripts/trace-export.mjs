#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const PROFILER_ARTIFACT_NAMES = new Set([
  "V8.StackGuard",
  "V8.HandleInterrupts",
  "V8.InvokeApiInterruptCallbacks",
  "CpuProfiler::StartProfiling",
]);

function printHelp() {
  process.stdout.write(`Usage:\n  node scripts/trace-export.mjs --trace <trace.json> [--out <metrics.json>] [--plugin-url <url>] [--long-task-ms <ms>]\n\nOptions:\n  --trace <path>        Path to Chrome/DevTools trace JSON file\n  --out <path>          Optional output file path (prints to stdout when omitted)\n  --plugin-url <url>    Plugin script URL to aggregate (default: plugin:cumban)\n  --long-task-ms <ms>   Long task threshold in milliseconds (default: 50)\n  --help                Show this help\n`);
}

function parseArgs(argv) {
  const args = {
    tracePath: null,
    outPath: null,
    pluginUrl: "plugin:cumban",
    longTaskMs: 50,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (token === "--trace") {
      args.tracePath = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (token === "--out") {
      args.outPath = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (token === "--plugin-url") {
      args.pluginUrl = argv[i + 1] ?? args.pluginUrl;
      i += 1;
      continue;
    }
    if (token === "--long-task-ms") {
      const raw = Number(argv[i + 1]);
      if (!Number.isFinite(raw) || raw <= 0) {
        throw new Error(`Invalid --long-task-ms value: ${argv[i + 1] ?? ""}`);
      }
      args.longTaskMs = raw;
      i += 1;
      continue;
    }
  }

  return args;
}

function toMs(value) {
  return Number((value / 1000).toFixed(3));
}

function getMetadata(traceEvents) {
  const threadNames = new Map();
  const processNames = new Map();

  for (const event of traceEvents) {
    if (event?.ph !== "M") {
      continue;
    }
    if (event.name === "thread_name") {
      const key = `${event.pid}:${event.tid}`;
      threadNames.set(key, event.args?.name ?? "");
      continue;
    }
    if (event.name === "process_name") {
      processNames.set(event.pid, event.args?.name ?? "");
    }
  }

  return { threadNames, processNames };
}

function findRendererMainThread(traceEvents, metadata) {
  for (const event of traceEvents) {
    if (event?.ph !== "M" || event.name !== "thread_name") {
      continue;
    }
    if (event.args?.name !== "CrRendererMain") {
      continue;
    }

    const processName = metadata.processNames.get(event.pid);
    if (processName === "Renderer") {
      return {
        pid: event.pid,
        tid: event.tid,
      };
    }
  }

  return null;
}

function aggregateByName(events) {
  const map = new Map();
  for (const event of events) {
    const name = event.name;
    const current = map.get(name) ?? { count: 0, totalUs: 0, maxUs: 0 };
    current.count += 1;
    current.totalUs += event.dur;
    if (event.dur > current.maxUs) {
      current.maxUs = event.dur;
    }
    map.set(name, current);
  }

  return [...map.entries()]
    .map(([name, stats]) => ({
      name,
      count: stats.count,
      total_ms: toMs(stats.totalUs),
      max_ms: toMs(stats.maxUs),
    }))
    .sort((a, b) => b.total_ms - a.total_ms);
}

function summarizeFunctionCallsByUrl(events) {
  const map = new Map();
  for (const event of events) {
    if (event.name !== "FunctionCall") {
      continue;
    }
    const url = event.args?.data?.url ?? "<unknown>";
    const current = map.get(url) ?? { count: 0, totalUs: 0, maxUs: 0 };
    current.count += 1;
    current.totalUs += event.dur;
    if (event.dur > current.maxUs) {
      current.maxUs = event.dur;
    }
    map.set(url, current);
  }

  return [...map.entries()]
    .map(([url, stats]) => ({
      url,
      count: stats.count,
      total_ms: toMs(stats.totalUs),
      max_ms: toMs(stats.maxUs),
    }))
    .sort((a, b) => b.total_ms - a.total_ms);
}

function summarizeNamedEvents(events, name) {
  const selected = events.filter((event) => event.name === name);
  const totalUs = selected.reduce((sum, event) => sum + event.dur, 0);
  const maxEvent = selected.reduce((currentMax, event) => {
    if (currentMax === null || event.dur > currentMax.dur) {
      return event;
    }
    return currentMax;
  }, null);

  return {
    name,
    count: selected.length,
    total_ms: toMs(totalUs),
    max_ms: maxEvent === null ? 0 : toMs(maxEvent.dur),
    max_event: maxEvent
      ? {
          ts_us: maxEvent.ts,
          dur_ms: toMs(maxEvent.dur),
          data: maxEvent.args ?? {},
        }
      : null,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.tracePath === null) {
    throw new Error("Missing required --trace argument");
  }

  const tracePath = resolve(args.tracePath);
  const raw = readFileSync(tracePath, "utf8");
  const parsed = JSON.parse(raw);
  const traceEvents = Array.isArray(parsed.traceEvents) ? parsed.traceEvents : [];
  const metadata = getMetadata(traceEvents);
  const rendererMain = findRendererMainThread(traceEvents, metadata);

  const xEvents = traceEvents.filter((event) => {
    return event?.ph === "X" && typeof event.dur === "number";
  });

  const breadcrumb = parsed.metadata?.modifications?.initialBreadcrumb?.window;
  const windowMinUs = typeof breadcrumb?.min === "number" ? breadcrumb.min : null;
  const windowMaxUs = typeof breadcrumb?.max === "number" ? breadcrumb.max : null;

  const aggregate = aggregateByName(xEvents);
  const functionCallsByUrl = summarizeFunctionCallsByUrl(xEvents);

  const pluginFunctionCalls = xEvents.filter((event) => {
    if (event.name !== "FunctionCall") {
      return false;
    }
    const eventUrl = event.args?.data?.url;
    return eventUrl === args.pluginUrl;
  });

  const pluginFunctionTotalUs = pluginFunctionCalls.reduce(
    (sum, event) => sum + event.dur,
    0,
  );
  const pluginMaxFunction = pluginFunctionCalls.reduce((currentMax, event) => {
    if (currentMax === null || event.dur > currentMax.dur) {
      return event;
    }
    return currentMax;
  }, null);

  const rendererMainEvents =
    rendererMain === null
      ? []
      : xEvents.filter((event) => {
          return event.pid === rendererMain.pid && event.tid === rendererMain.tid;
        });
  const rendererMainTotalUs = rendererMainEvents.reduce(
    (sum, event) => sum + event.dur,
    0,
  );

  const longTaskThresholdUs = args.longTaskMs * 1000;
  const longTasks = rendererMainEvents
    .filter((event) => {
      return (
        event.dur >= longTaskThresholdUs && !PROFILER_ARTIFACT_NAMES.has(event.name)
      );
    })
    .map((event) => {
      const tsMs =
        windowMinUs === null ? null : Number(((event.ts - windowMinUs) / 1000).toFixed(3));
      return {
        name: event.name,
        category: event.cat ?? "",
        dur_ms: toMs(event.dur),
        ts_from_window_start_ms: tsMs,
      };
    })
    .sort((a, b) => b.dur_ms - a.dur_ms);

  const majorGc = summarizeNamedEvents(xEvents, "MajorGC");
  const minorGc = summarizeNamedEvents(xEvents, "MinorGC");
  const updateLayoutTree = summarizeNamedEvents(xEvents, "UpdateLayoutTree");
  const layout = summarizeNamedEvents(xEvents, "Layout");
  const paint = summarizeNamedEvents(xEvents, "Paint");

  const output = {
    trace_file: tracePath,
    exported_at: new Date().toISOString(),
    plugin_url: args.pluginUrl,
    long_task_threshold_ms: args.longTaskMs,
    event_counts: {
      all_events: traceEvents.length,
      duration_events: xEvents.length,
    },
    window: {
      start_us: windowMinUs,
      end_us: windowMaxUs,
      range_ms:
        windowMinUs === null || windowMaxUs === null
          ? null
          : Number(((windowMaxUs - windowMinUs) / 1000).toFixed(3)),
    },
    renderer_main:
      rendererMain === null
        ? null
        : {
            pid: rendererMain.pid,
            tid: rendererMain.tid,
            total_ms: toMs(rendererMainTotalUs),
            long_tasks: {
              count: longTasks.length,
              max_ms: longTasks.length > 0 ? longTasks[0].dur_ms : 0,
              items: longTasks,
            },
          },
    plugin_function_call: {
      count: pluginFunctionCalls.length,
      total_ms: toMs(pluginFunctionTotalUs),
      max_ms: pluginMaxFunction === null ? 0 : toMs(pluginMaxFunction.dur),
      max_location:
        pluginMaxFunction === null
          ? null
          : {
              line: pluginMaxFunction.args?.data?.lineNumber ?? null,
              column: pluginMaxFunction.args?.data?.columnNumber ?? null,
            },
    },
    layout: {
      update_layout_tree: updateLayoutTree,
      layout,
      paint,
    },
    gc: {
      major: majorGc,
      minor: minorGc,
    },
    top_event_names_by_total_ms: aggregate.slice(0, 30),
    function_call_by_url: functionCallsByUrl.slice(0, 30),
  };

  const formatted = JSON.stringify(output, null, 2);
  if (args.outPath !== null) {
    const outPath = resolve(args.outPath);
    writeFileSync(outPath, formatted + "\n", "utf8");
    process.stdout.write(`Wrote metrics to ${outPath}\n`);
    return;
  }

  process.stdout.write(formatted + "\n");
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`trace-export failed: ${message}\n`);
  process.exitCode = 1;
}
