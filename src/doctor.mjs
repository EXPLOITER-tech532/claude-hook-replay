import fs from "node:fs";
import path from "node:path";
import { HOOK_EVENTS, VALID_EVENTS } from "./constants.mjs";

/**
 * Extract a local script file path from a shell command if present (e.g. `node ./hooks/foo.mjs`).
 */
function extractScriptPath(command, cwd) {
  const expanded = command
    .replace(/\$CLAUDE_PROJECT_DIR|\$\{CLAUDE_PROJECT_DIR\}/g, cwd)
    .trim();
  const tokens = expanded.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  for (const rawTok of tokens) {
    const tok = rawTok.replace(/^['"]|['"]$/g, "");
    if (
      /\.(mjs|cjs|js|ts|py|sh|ps1|rb|bash)$/i.test(tok) &&
      !tok.startsWith("http")
    ) {
      return path.isAbsolute(tok) ? tok : path.resolve(cwd, tok);
    }
  }
  return null;
}

/**
 * Run static diagnostics across all loaded Claude Code hooks.
 * Catches broken matchers, unknown events, missing scripts, infinite Stop-hook loops, and timeout risks.
 */
export function runDoctor(loadResult, cwd = process.cwd()) {
  const issues = [];

  for (const pe of loadResult.parseErrors ?? []) {
    issues.push({
      severity: "error",
      code: "PARSE_ERROR",
      source: pe.file,
      message: pe.error,
    });
  }

  for (const entry of loadResult.entries ?? []) {
    const loc = `${path.basename(entry.source)} -> ${entry.event}${entry.matcher ? `[${entry.matcher}]` : ""}`;

    // 1. Validate lifecycle event name
    if (!VALID_EVENTS.has(entry.event)) {
      issues.push({
        severity: "error",
        code: "UNKNOWN_EVENT",
        source: loc,
        message: `Unknown hook event "${entry.event}". Valid events: ${[...VALID_EVENTS].join(", ")}.`,
      });
      continue;
    }

    const meta = HOOK_EVENTS[entry.event];

    // 2. Warn if a matcher is configured on an event that doesn't support matchers
    if (!meta.hasMatcher && entry.matcher && entry.matcher !== "*") {
      issues.push({
        severity: "warn",
        code: "UNUSED_MATCHER",
        source: loc,
        message: `Event "${entry.event}" does not use tool matchers; matcher "${entry.matcher}" may be ignored.`,
      });
    }

    // 3. Validate matcher regex syntax
    if (entry.matcher && entry.matcher !== "*") {
      try {
        new RegExp(entry.matcher);
      } catch (err) {
        issues.push({
          severity: "error",
          code: "INVALID_REGEX",
          source: loc,
          message: `Invalid matcher regex "${entry.matcher}": ${err.message}`,
        });
      }
    }

    // 4. Validate command string
    if (entry.type === "command" && !entry.command.trim()) {
      issues.push({
        severity: "error",
        code: "EMPTY_COMMAND",
        source: loc,
        message: "Hook has type 'command' but an empty command string.",
      });
      continue;
    }

    // 5. Check referenced local script exists & inspect for common pitfalls
    const scriptPath = extractScriptPath(entry.command, cwd);
    if (scriptPath) {
      if (!fs.existsSync(scriptPath)) {
        issues.push({
          severity: "error",
          code: "MISSING_SCRIPT",
          source: loc,
          message: `Referenced hook script does not exist: ${scriptPath}`,
        });
      } else {
        const content = fs.readFileSync(scriptPath, "utf8");

        // 5a. Infinite Stop-hook loop check
        if (
          (entry.event === "Stop" || entry.event === "SubagentStop") &&
          !content.includes("stop_hook_active")
        ) {
          issues.push({
            severity: "warn",
            code: "STOP_LOOP_RISK",
            source: loc,
            message: `${entry.event} script "${path.basename(scriptPath)}" never checks "stop_hook_active". If it blocks, Claude can enter an infinite loop.`,
          });
        }

        // 5b. Unquoted $CLAUDE_PROJECT_DIR check
        if (
          entry.command.includes("$CLAUDE_PROJECT_DIR") &&
          !entry.command.includes('"$CLAUDE_PROJECT_DIR"') &&
          !entry.command.includes('"${CLAUDE_PROJECT_DIR}"')
        ) {
          issues.push({
            severity: "warn",
            code: "UNQUOTED_PROJECT_DIR",
            source: loc,
            message:
              'Unquoted $CLAUDE_PROJECT_DIR in command will break in directories with spaces. Wrap in quotes: "$CLAUDE_PROJECT_DIR/...".',
          });
        }
      }
    }

    // 6. SessionEnd tight timeout warning
    if (entry.event === "SessionEnd" && entry.timeout && entry.timeout > 1.5) {
      issues.push({
        severity: "warn",
        code: "SESSION_END_TIMEOUT",
        source: loc,
        message: `SessionEnd hooks have a ~1.5s default cutoff in Claude Code; configured timeout (${entry.timeout}s) may be terminated early.`,
      });
    }
  }

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warn").length;
  return {
    ok: errors === 0,
    totalHooks: loadResult.entries?.length ?? 0,
    errors,
    warnings,
    issues,
  };
}
