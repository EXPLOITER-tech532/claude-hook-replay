#!/usr/bin/env node
/**
 * Example PreToolUse (Bash) hook: blocks destructive shell commands with exit code 2.
 */
let raw = "";
for await (const chunk of process.stdin) raw += chunk;

const payload = JSON.parse(raw || "{}");
const cmd = String(payload?.tool_input?.command ?? "");

const BLOCKED_PATTERNS = [
  /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+(\/|~|\$HOME)(?:\s|$)/,
  /\bgit\s+push\s+--force\s+(origin\s+)?(main|master)(?:\s|$)/,
  /\bDROP\s+DATABASE\b/i,
];

for (const re of BLOCKED_PATTERNS) {
  if (re.test(cmd)) {
    console.error(`Blocked destructive Bash command matching ${re}: "${cmd}"`);
    process.exit(2);
  }
}

process.exit(0);
