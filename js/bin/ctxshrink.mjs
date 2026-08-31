#!/usr/bin/env node
/**
 * Command-line interface for ctxshrink.
 *
 * Subcommands
 * -----------
 *
 * count      count tokens for stdin or a file
 * analyze    content-type detection and text statistics
 * compress   detect + reduce + safety-check, print the result
 * toon encode|decode   the TOON re-encoder, standalone
 * benchmark  run the bundled fixture corpus, print a savings table
 * dashboard  serve the local metrics dashboard
 * levels     print the optimization level / safety class reference
 */

import { readFileSync } from "node:fs";
import { VERSION, analyze, compress, countTokens, estimateTokens, toonDecode, toonEncode } from "../src/index.js";
import { LEVEL_NAMES, SAFETY_NAMES } from "../src/levels.js";

function readStdin() {
  return new Promise((resolvePromise, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolvePromise(data));
    process.stdin.on("error", reject);
  });
}

async function readInput(path) {
  if (path && path !== "-") return readFileSync(path, "utf8");
  return readStdin();
}

function printJSON(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

async function cmdCount(args) {
  const { positional, flags } = parseArgs(args);
  const text = await readInput(positional[0]);
  if (flags.exact) {
    const result = await countTokens(text, flags.model || "auto");
    printJSON(result);
  } else {
    const tokens = estimateTokens(text);
    if (flags.json) {
      printJSON({ tokens, chars: text.length, method: "estimate" });
    } else {
      console.log(tokens);
    }
  }
  return 0;
}

async function cmdAnalyze(args) {
  const { positional, flags } = parseArgs(args);
  const text = await readInput(positional[0]);
  printJSON(analyze(text, flags.type || null));
  return 0;
}

async function cmdCompress(args) {
  const { positional, flags } = parseArgs(args);
  const text = await readInput(positional[0]);
  const level = flags.level !== undefined ? parseInt(flags.level, 10) : 2;
  const result = compress(text, level, flags.type || null);

  if (flags["stats-only"]) {
    printJSON(result.asDict());
    return 0;
  }
  if (flags.json) {
    printJSON({ ...result.asDict(), text: result.text });
    return 0;
  }

  process.stdout.write(result.text);
  if (!result.text.endsWith("\n")) process.stdout.write("\n");
  if (flags.stats) {
    const d = result.asDict();
    console.error(
      `--- ${d.contentType}: ${d.originalTokens} -> ${d.resultTokens} tokens ` +
        `(${(d.savingsRatio * 100).toFixed(1)}% saved), method=${d.method}`
    );
  }
  return 0;
}

async function cmdToonEncode(args) {
  const { positional, flags } = parseArgs(args);
  const text = await readInput(positional[0]);
  const out = toonEncode(text, flags.delimiter || ",");
  if (out === null) {
    console.error("error: input is not TOON-encodable JSON");
    return 1;
  }
  process.stdout.write(out);
  return 0;
}

async function cmdToonDecode(args) {
  const { positional } = parseArgs(args);
  const text = await readInput(positional[0]);
  const out = toonDecode(text);
  if (out === null) {
    console.error("error: input is not valid TOON");
    return 1;
  }
  console.log(out);
  return 0;
}

function cmdLevels() {
  console.log("Optimization levels:");
  for (const [value, name] of Object.entries(LEVEL_NAMES).sort((a, b) => a[0] - b[0])) {
    console.log(`  ${value}  ${name.padEnd(14)}`);
  }
  console.log();
  console.log("Safety classes:");
  for (const [code, name] of Object.entries(SAFETY_NAMES)) {
    console.log(`  ${code.padEnd(3)} ${name}`);
  }
  return 0;
}

async function cmdBenchmark(args) {
  const { flags } = parseArgs(args);
  const { runBenchmark } = await import("../src/benchmark.js");
  const levels = flags.levels
    ? String(flags.levels).split(",").map((s) => parseInt(s, 10))
    : [1, 2, 3];
  const report = runBenchmark({ fixturesDir: flags.fixtures || null, levels, saveTo: flags.save || null });
  if (flags.json) {
    const { renderTable: _r, ...plain } = report;
    void _r;
    printJSON(plain);
  } else {
    console.log(report.renderTable());
  }
  return 0;
}

async function cmdDashboard(args) {
  const { flags } = parseArgs(args);
  const { serve } = await import("../src/dashboard.js");
  serve({
    host: flags.host || "127.0.0.1",
    port: flags.port ? parseInt(flags.port, 10) : 8877,
    metricsFile: flags["metrics-file"] || null,
    openBrowser: !flags["no-browser"],
  });
  return "keep-alive";
}

function printHelp() {
  console.log(`ctxshrink ${VERSION}

Usage: ctxshrink <command> [options]

Commands:
  count [file] [--exact] [--model NAME] [--json]
  analyze [file] [--type TYPE]
  compress [file] [--level 0-3] [--type TYPE] [--stats] [--stats-only] [--json]
  toon encode|decode [file] [--delimiter CHAR]
  levels
  benchmark [--fixtures DIR] [--levels 1,2,3] [--json] [--save FILE]
  dashboard [--host HOST] [--port PORT] [--metrics-file FILE] [--no-browser]

Reads from stdin when [file] is omitted or "-".`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  try {
    switch (command) {
      case "count":
        return await cmdCount(rest);
      case "analyze":
        return await cmdAnalyze(rest);
      case "compress":
        return await cmdCompress(rest);
      case "toon": {
        const [sub, ...toonRest] = rest;
        if (sub === "encode") return await cmdToonEncode(toonRest);
        if (sub === "decode") return await cmdToonDecode(toonRest);
        console.error("error: toon subcommand must be 'encode' or 'decode'");
        return 1;
      }
      case "levels":
        return cmdLevels();
      case "benchmark":
        return await cmdBenchmark(rest);
      case "dashboard":
        return await cmdDashboard(rest);
      case "--version":
      case "-v":
        console.log(`ctxshrink ${VERSION}`);
        return 0;
      case "--help":
      case "-h":
      case undefined:
        printHelp();
        return command === undefined ? 1 : 0;
      default:
        console.error(`error: unknown command '${command}'`);
        printHelp();
        return 1;
    }
  } catch (err) {
    console.error("error:", err.message);
    return 1;
  }
}

const exitCode = await main();
if (exitCode !== "keep-alive") {
  process.exitCode = exitCode;
}