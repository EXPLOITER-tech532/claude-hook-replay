#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { HOOK_EVENTS, VALID_EVENTS } from "../src/constants.mjs";
import { loadAllHooks } from "../src/loader.mjs";
import { buildPayload } from "../src/payloads.mjs";
import { simulateEvent } from "../src/runner.mjs";
import { runDoctor } from "../src/doctor.mjs";
import { runTestSuite } from "../src/tester.mjs";
import { badge, c, formatTable } from "../src/format.mjs";

const VERSION = "0.1.0";

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args.flags[key] = true;
      } else {
        args.flags[key] = next;
        i++;
      }
    } else if (a === "-h") {
      args.flags.help = true;
    } else if (a === "-v") {
      args.flags.version = true;
    } else {
      args._.push(a);
    }
  }
  return args;
}

function printHelp() {
  console.log(`
${c.bold("claude-hook-replay")} ${c.dim(`v${VERSION}`)} — Offline simulator, doctor & profiler for Claude Code hooks

${c.bold("USAGE")}
  claude-hook-replay <command> [options]

${c.bold("COMMANDS")}
  ${c.cyan("doctor")}                Static check for invalid events, broken regexes, missing scripts & Stop loops
  ${c.cyan("sim <Event>")}           Simulate a single Claude Code lifecycle event offline (0 tokens spent)
  ${c.cyan("test")}                  Run declarative hook assertions from .claude/hook-tests.json
  ${c.cyan("bench")}                 Profile latency (ms) and injected context tokens for every configured hook
  ${c.cyan("init")}                  Scaffold a starter .claude/hook-tests.json in the current project

${c.bold("OPTIONS")}
  --settings <path>     Path to a specific settings.json (default: auto-discover .claude/settings*.json)
  --suite <path>        Path to hook test suite (default: .claude/hook-tests.json)
  --tool <name>         Tool name for sim (e.g. Bash, Edit, Write, Read)
  --cmd <command>       Shell command for Bash tool simulation
  --file <path>         File path for Edit/Write/Read tool simulation
  --prompt <text>       Prompt text for UserPromptSubmit simulation
  --no-user             Skip ~/.claude/settings.json when auto-discovering hooks
  --json                Emit machine-readable JSON output (great for CI)
  -h, --help            Show this help message
  -v, --version         Show version

${c.bold("EXAMPLES")}
  claude-hook-replay doctor
  claude-hook-replay sim PreToolUse --tool Bash --cmd "rm -rf /"
  claude-hook-replay sim PreToolUse --tool Edit --file .env.production
  claude-hook-replay test --suite .claude/hook-tests.json
  claude-hook-replay bench
`);
}

async function cmdDoctor(flags) {
  const loaded = loadAllHooks({
    settingsPath: flags.settings,
    includeUser: !flags["no-user"],
  });
  const report = runDoctor(loaded);

  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
  }

  console.log(
    `\n${c.bold("claude-hook-replay doctor")} ${c.dim(`(${report.totalHooks} hooks across ${loaded.files.length} file(s))`)}\n`
  );

  if (report.issues.length === 0) {
    console.log(`${badge("PASS")} All hooks look healthy! Zero errors, zero warnings.\n`);
    process.exit(0);
  }

  for (const issue of report.issues) {
    const tag = issue.severity === "error" ? badge("ERROR") : badge("WARN");
    console.log(`${tag} ${c.bold(issue.code)} ${c.dim(`(${issue.source})`)}`);
    console.log(`       ${issue.message}\n`);
  }

  console.log(
    c.dim(`Summary: ${report.errors} error(s), ${report.warnings} warning(s)\n`)
  );
  process.exit(report.ok ? 0 : 1);
}

async function cmdSim(event, flags) {
  if (!event || !VALID_EVENTS.has(event)) {
    console.error(
      `${badge("ERROR")} Missing or invalid event "${event ?? ""}". Valid events: ${[...VALID_EVENTS].join(", ")}`
    );
    process.exit(2);
  }

  const loaded = loadAllHooks({
    settingsPath: flags.settings,
    includeUser: !flags["no-user"],
  });
  const payload = buildPayload(event, {
    tool: flags.tool,
    cmd: flags.cmd,
    file: flags.file,
    prompt: flags.prompt,
    stopHookActive: Boolean(flags["stop-hook-active"]),
    source: flags.source,
    trigger: flags.trigger,
  });

  const sim = await simulateEvent(loaded.entries, payload);

  if (flags.json) {
    console.log(JSON.stringify({ payload, ...sim }, null, 2));
    process.exit(sim.finalVerdict === "ERROR" || sim.finalVerdict === "TIMEOUT" ? 1 : 0);
  }

  console.log(
    `\n${c.bold("Simulated")} ${c.cyan(event)}${payload.tool_name ? c.dim(` (${payload.tool_name})`) : ""}`
  );
  console.log(
    `${c.bold("Verdict:")}   ${badge(sim.finalVerdict)}  ${c.dim(`${sim.matchedCount} hook(s) matched | ${sim.totalDurationMs}ms | ~${sim.totalTokens} tokens injected`)}\n`
  );

  if (sim.results.length > 0) {
    const rows = sim.results.map((r) => [
      r.entry.matcher || "*",
      badge(r.verdict),
      `exit ${r.exitCode}`,
      `${r.durationMs}ms`,
      `~${r.injectedTokens} tok`,
      r.reason || c.dim(r.entry.command),
    ]);
    console.log(
      formatTable(["Matcher", "Verdict", "Exit", "Latency", "Context", "Reason / Command"], rows)
    );
    console.log();
  }
}

async function cmdTest(flags) {
  const suitePath = flags.suite ?? ".claude/hook-tests.json";
  const loaded = loadAllHooks({
    settingsPath: flags.settings,
    includeUser: !flags["no-user"],
  });
  const report = await runTestSuite(loaded.entries, suitePath);

  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
  }

  console.log(`\n${c.bold("claude-hook-replay test")} ${c.dim(path.basename(report.suitePath))}\n`);
  for (const r of report.results) {
    const tag = r.passed ? badge("PASS") : badge("FAIL");
    console.log(
      `${tag} ${r.name} ${c.dim(`(${r.sim.finalVerdict}, ${r.sim.totalDurationMs}ms, ~${r.sim.totalTokens} tok)`)}`
    );
    for (const f of r.failures) {
      console.log(`       ${c.red("->")} ${f}`);
    }
  }
  console.log(
    `\n${c.bold("Result:")} ${report.passed}/${report.total} passed${report.failed ? c.red(`, ${report.failed} failed`) : ""}\n`
  );
  process.exit(report.ok ? 0 : 1);
}

async function cmdBench(flags) {
  const loaded = loadAllHooks({
    settingsPath: flags.settings,
    includeUser: !flags["no-user"],
  });

  const rows = [];
  const raw = [];
  for (const entry of loaded.entries) {
    if (entry.type !== "command") continue;
    const sampleTool =
      entry.matcher && entry.matcher !== "*"
        ? entry.matcher.split("|")[0].replace(/[^A-Za-z0-9_]/g, "") || "Bash"
        : "Bash";
    const payload = buildPayload(entry.event, { tool: sampleTool });
    const sim = await simulateEvent([entry], payload);
    const r = sim.results[0];
    const budget = HOOK_EVENTS[entry.event]?.recommendedBudgetMs ?? 500;
    const status =
      !r ? "SKIP" : r.durationMs > budget ? "SLOW" : r.verdict;
    raw.push({
      event: entry.event,
      matcher: entry.matcher || "*",
      command: entry.command,
      durationMs: r?.durationMs ?? 0,
      budgetMs: budget,
      injectedTokens: r?.injectedTokens ?? 0,
      verdict: r?.verdict ?? "SKIP",
    });
    rows.push([
      entry.event,
      entry.matcher || "*",
      r ? `${r.durationMs}ms` : "-",
      `${budget}ms`,
      r ? `~${r.injectedTokens}` : "0",
      badge(status),
    ]);
  }

  if (flags.json) {
    console.log(JSON.stringify({ hooks: raw }, null, 2));
    return;
  }

  console.log(`\n${c.bold("claude-hook-replay bench")} ${c.dim(`(${raw.length} command hook(s))`)}\n`);
  if (rows.length === 0) {
    console.log(c.dim("No command hooks found. Pass --settings <path> to benchmark a specific file.\n"));
    return;
  }
  console.log(
    formatTable(["Event", "Matcher", "Latency", "Budget", "Tokens", "Status"], rows)
  );
  console.log();
}

function cmdInit(flags) {
  const target = path.resolve(flags.suite ?? ".claude/hook-tests.json");
  if (fs.existsSync(target) && !flags.force) {
    console.error(`${badge("WARN")} ${target} already exists. Pass --force to overwrite.`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const starter = {
    $schema: "https://github.com/your-org/claude-hook-replay/schema/hook-tests.json",
    tests: [
      {
        name: "Blocks destructive rm -rf command",
        event: "PreToolUse",
        tool: "Bash",
        cmd: "rm -rf /",
        expect: { verdict: "BLOCK", maxMs: 500 },
      },
      {
        name: "Allows safe test command",
        event: "PreToolUse",
        tool: "Bash",
        cmd: "npm test",
        expect: { verdict: "ALLOW", maxMs: 500, maxTokens: 100 },
      },
    ],
  };
  fs.writeFileSync(target, JSON.stringify(starter, null, 2) + "\n", "utf8");
  console.log(`${badge("PASS")} Created starter hook test suite at ${target}`);
}

const parsed = parseArgs(process.argv.slice(2));
const cmd = parsed._[0];

if (parsed.flags.version) {
  console.log(VERSION);
  process.exit(0);
}
if (parsed.flags.help || !cmd) {
  printHelp();
  process.exit(0);
}

try {
  if (cmd === "doctor") await cmdDoctor(parsed.flags);
  else if (cmd === "sim") await cmdSim(parsed._[1], parsed.flags);
  else if (cmd === "test") await cmdTest(parsed.flags);
  else if (cmd === "bench") await cmdBench(parsed.flags);
  else if (cmd === "init") cmdInit(parsed.flags);
  else {
    console.error(`${badge("ERROR")} Unknown command "${cmd}". Run with --help.`);
    process.exit(2);
  }
} catch (err) {
  console.error(`${badge("ERROR")} ${err.message}`);
  process.exit(1);
}
