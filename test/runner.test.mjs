import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAllHooks } from "../src/loader.mjs";
import { runDoctor } from "../src/doctor.mjs";
import { buildPayload } from "../src/payloads.mjs";
import { interpretHookResult, matcherMatches, simulateEvent } from "../src/runner.mjs";
import { runTestSuite } from "../src/tester.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

test("matcherMatches handles wildcard, empty, and regex patterns", () => {
  const payload = buildPayload("PreToolUse", { tool: "Edit", file: ".env" });
  assert.equal(matcherMatches("", payload), true);
  assert.equal(matcherMatches("*", payload), true);
  assert.equal(matcherMatches("Edit|Write", payload), true);
  assert.equal(matcherMatches("^Bash$", payload), false);
});

test("interpretHookResult handles exit 2 block and structured JSON deny", () => {
  const exitBlock = interpretHookResult("PreToolUse", 2, "", "Denied by guard", false);
  assert.equal(exitBlock.verdict, "BLOCK");
  assert.equal(exitBlock.reason, "Denied by guard");
  assert.ok(exitBlock.injectedTokens > 0);

  const jsonDeny = interpretHookResult(
    "PreToolUse",
    0,
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "No secrets",
      },
    }),
    "",
    false
  );
  assert.equal(jsonDeny.verdict, "BLOCK");
  assert.equal(jsonDeny.reason, "No secrets");
});

test("runDoctor passes on examples/settings.json", () => {
  const loaded = loadAllHooks({
    cwd: ROOT,
    settingsPath: "examples/settings.json",
  });
  const report = runDoctor(loaded, ROOT);
  assert.equal(report.ok, true);
  assert.equal(report.errors, 0);
  assert.equal(report.totalHooks, 2);
});

test("runDoctor catches unknown events and invalid regexes", () => {
  const fakeLoad = {
    files: ["fake.json"],
    parseErrors: [],
    entries: [
      { source: "fake.json", event: "NotARealEvent", matcher: "", type: "command", command: "echo hi" },
      { source: "fake.json", event: "PreToolUse", matcher: "[unclosed", type: "command", command: "echo hi" },
    ],
  };
  const report = runDoctor(fakeLoad, ROOT);
  assert.equal(report.ok, false);
  assert.equal(report.errors, 2);
  assert.deepEqual(
    report.issues.map((i) => i.code),
    ["UNKNOWN_EVENT", "INVALID_REGEX"]
  );
});

test("simulateEvent executes example hooks end-to-end", async () => {
  const loaded = loadAllHooks({
    cwd: ROOT,
    settingsPath: "examples/settings.json",
  });

  const dangerous = await simulateEvent(
    loaded.entries,
    buildPayload("PreToolUse", { cwd: ROOT, tool: "Bash", cmd: "rm -rf /" }),
    { cwd: ROOT }
  );
  assert.equal(dangerous.finalVerdict, "BLOCK");
  assert.equal(dangerous.matchedCount, 1);

  const safe = await simulateEvent(
    loaded.entries,
    buildPayload("PreToolUse", { cwd: ROOT, tool: "Bash", cmd: "npm test" }),
    { cwd: ROOT }
  );
  assert.equal(safe.finalVerdict, "ALLOW");
});

test("runTestSuite passes all declarative cases in examples/hook-tests.json", async () => {
  const loaded = loadAllHooks({
    cwd: ROOT,
    settingsPath: "examples/settings.json",
  });
  const report = await runTestSuite(loaded.entries, "examples/hook-tests.json", {
    cwd: ROOT,
  });
  assert.equal(report.ok, true);
  assert.equal(report.total, 4);
  assert.equal(report.passed, 4);
  assert.equal(report.failed, 0);
});
