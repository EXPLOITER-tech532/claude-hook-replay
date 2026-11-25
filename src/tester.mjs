import fs from "node:fs";
import path from "node:path";
import { buildPayload } from "./payloads.mjs";
import { simulateEvent } from "./runner.mjs";

/**
 * Load a declarative hook test suite (.claude/hook-tests.json) and execute every case.
 */
export async function runTestSuite(entries, suitePath, options = {}) {
  const absSuite = path.resolve(options.cwd ?? process.cwd(), suitePath);
  if (!fs.existsSync(absSuite)) {
    throw new Error(`Test suite not found: ${absSuite}`);
  }

  const suite = JSON.parse(fs.readFileSync(absSuite, "utf8"));
  const cases = Array.isArray(suite.tests) ? suite.tests : [];
  const results = [];

  for (const tc of cases) {
    const payload =
      tc.payload ??
      buildPayload(tc.event, {
        cwd: options.cwd ?? process.cwd(),
        tool: tc.tool,
        cmd: tc.cmd,
        file: tc.file,
        prompt: tc.prompt,
        toolInput: tc.toolInput,
        stopHookActive: tc.stopHookActive,
        source: tc.source,
        trigger: tc.trigger,
      });

    const sim = await simulateEvent(entries, payload, {
      cwd: options.cwd ?? process.cwd(),
      timeoutMs: tc.timeoutMs,
    });

    const failures = [];
    const expected = tc.expect ?? {};

    if (expected.verdict && sim.finalVerdict !== expected.verdict) {
      failures.push(
        `expected verdict ${expected.verdict}, got ${sim.finalVerdict}`
      );
    }

    if (
      typeof expected.matched === "number" &&
      sim.matchedCount !== expected.matched
    ) {
      failures.push(
        `expected ${expected.matched} matched hook(s), got ${sim.matchedCount}`
      );
    }

    if (expected.reasonContains) {
      const combinedReasons = sim.results
        .map((r) => `${r.reason}\n${r.stderr}\n${r.stdout}`)
        .join("\n");
      if (!combinedReasons.includes(expected.reasonContains)) {
        failures.push(
          `expected output/reason to include "${expected.reasonContains}"`
        );
      }
    }

    if (expected.contextContains) {
      const combinedCtx = sim.results.map((r) => r.injectedContext).join("\n");
      if (!combinedCtx.includes(expected.contextContains)) {
        failures.push(
          `expected injected context to include "${expected.contextContains}"`
        );
      }
    }

    if (typeof expected.maxMs === "number" && sim.totalDurationMs > expected.maxMs) {
      failures.push(
        `latency ${sim.totalDurationMs}ms exceeded budget ${expected.maxMs}ms`
      );
    }

    if (
      typeof expected.maxTokens === "number" &&
      sim.totalTokens > expected.maxTokens
    ) {
      failures.push(
        `injected tokens (~${sim.totalTokens}) exceeded budget (${expected.maxTokens})`
      );
    }

    results.push({
      name: tc.name ?? `${tc.event} (${tc.tool ?? "default"})`,
      passed: failures.length === 0,
      failures,
      sim,
    });
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  return {
    suitePath: absSuite,
    total: results.length,
    passed,
    failed,
    ok: failed === 0,
    results,
  };
}
