import { spawn } from "node:child_process";
import path from "node:path";
import { HOOK_EVENTS, estimateTokens } from "./constants.mjs";

/**
 * Determine whether a hook matcher string matches the current payload.
 * Empty matcher or "*" matches everything; otherwise treated as a JS RegExp (matching Claude Code).
 */
export function matcherMatches(matcher, payload) {
  if (!matcher || matcher === "*") return true;
  const target =
    payload.tool_name ??
    payload.notification_type ??
    payload.trigger ??
    payload.source ??
    "";
  try {
    return new RegExp(matcher).test(target);
  } catch {
    return false;
  }
}

/**
 * Interpret Claude Code's hook output contract:
 *  - Exit code 2 => BLOCK (stderr is sent to Claude as blocking reason)
 *  - Exit code 0 with JSON stdout => check decision / hookSpecificOutput.permissionDecision / additionalContext
 *  - Exit code 0 with plain stdout => ALLOW (stdout injected into context on SessionStart/UserPromptSubmit)
 *  - Other non-zero exit code => ERROR (non-blocking error in Claude Code)
 */
export function interpretHookResult(event, exitCode, stdout, stderr, timedOut) {
  if (timedOut) {
    return {
      verdict: "TIMEOUT",
      reason: "Hook exceeded timeout budget",
      injectedContext: "",
      injectedTokens: 0,
      parsedJson: null,
    };
  }

  let parsedJson = null;
  const trimmedOut = stdout.trim();
  if (trimmedOut.startsWith("{")) {
    try {
      parsedJson = JSON.parse(trimmedOut);
    } catch {
      parsedJson = null;
    }
  }

  if (exitCode === 2) {
    const reason = stderr.trim() || trimmedOut || "Blocked by hook (exit 2)";
    return {
      verdict: "BLOCK",
      reason,
      injectedContext: reason,
      injectedTokens: estimateTokens(reason),
      parsedJson,
    };
  }

  if (exitCode !== 0) {
    return {
      verdict: "ERROR",
      reason: stderr.trim() || `Exited with code ${exitCode}`,
      injectedContext: "",
      injectedTokens: 0,
      parsedJson,
    };
  }

  if (parsedJson) {
    const hso = parsedJson.hookSpecificOutput ?? {};
    const perm = hso.permissionDecision ?? parsedJson.decision;
    const reason =
      hso.permissionDecisionReason ??
      parsedJson.reason ??
      parsedJson.stopReason ??
      "";
    const additionalContext =
      hso.additionalContext ?? parsedJson.additionalContext ?? "";

    let verdict = "ALLOW";
    if (perm === "deny" || perm === "block" || parsedJson.continue === false) {
      verdict = "BLOCK";
    } else if (perm === "ask") {
      verdict = "ASK";
    }

    const injectedText = [additionalContext, verdict === "BLOCK" ? reason : ""]
      .filter(Boolean)
      .join("\n");

    return {
      verdict,
      reason,
      injectedContext: additionalContext,
      injectedTokens: estimateTokens(injectedText),
      parsedJson,
    };
  }

  // Plain-text stdout is injected into Claude's context for SessionStart / UserPromptSubmit
  const injectsPlainStdout =
    event === "SessionStart" || event === "UserPromptSubmit";
  const injectedContext = injectsPlainStdout ? trimmedOut : "";
  return {
    verdict: "ALLOW",
    reason: "",
    injectedContext,
    injectedTokens: estimateTokens(injectedContext),
    parsedJson: null,
  };
}

/**
 * Execute a single hook entry with the given JSON payload on stdin.
 */
export function runHook(entry, payload, options = {}) {
  const cwd = path.resolve(options.cwd ?? payload.cwd ?? process.cwd());
  const eventMeta = HOOK_EVENTS[entry.event] ?? {};
  const timeoutMs =
    options.timeoutMs ??
    (entry.timeout ? entry.timeout * 1000 : eventMeta.defaultTimeoutMs ?? 15_000);

  return new Promise((resolve) => {
    const start = performance.now();
    const env = {
      ...process.env,
      CLAUDE_PROJECT_DIR: cwd,
      CLAUDE_HOOK_REPLAY: "1",
      ...(options.env ?? {}),
    };

    const child = spawn(entry.command, {
      cwd,
      env,
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    const finish = (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Math.round((performance.now() - start) * 10) / 10;
      const interpreted = interpretHookResult(
        entry.event,
        exitCode ?? -1,
        stdout,
        stderr,
        timedOut
      );
      resolve({
        entry,
        exitCode: exitCode ?? -1,
        durationMs,
        timedOut,
        stdout,
        stderr,
        ...interpreted,
      });
    };

    child.on("error", (err) => {
      stderr += (stderr ? "\n" : "") + err.message;
      finish(-1);
    });
    child.on("close", (code) => finish(code));

    try {
      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    } catch {
      // process may have exited immediately
    }
  });
}

/**
 * Simulate an event against all loaded hook entries and return aggregated results.
 */
export async function simulateEvent(entries, payload, options = {}) {
  const matching = entries.filter(
    (e) =>
      e.event === payload.hook_event_name &&
      e.type === "command" &&
      matcherMatches(e.matcher, payload)
  );

  const results = [];
  for (const entry of matching) {
    const res = await runHook(entry, payload, options);
    results.push(res);
  }

  let finalVerdict = "ALLOW";
  if (results.some((r) => r.verdict === "BLOCK")) finalVerdict = "BLOCK";
  else if (results.some((r) => r.verdict === "ASK")) finalVerdict = "ASK";
  else if (results.some((r) => r.verdict === "TIMEOUT")) finalVerdict = "TIMEOUT";
  else if (results.some((r) => r.verdict === "ERROR")) finalVerdict = "ERROR";

  const totalDurationMs =
    Math.round(results.reduce((acc, r) => acc + r.durationMs, 0) * 10) / 10;
  const totalTokens = results.reduce((acc, r) => acc + r.injectedTokens, 0);

  return {
    event: payload.hook_event_name,
    matchedCount: matching.length,
    finalVerdict,
    totalDurationMs,
    totalTokens,
    results,
  };
}
