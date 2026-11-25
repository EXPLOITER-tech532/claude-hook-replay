#!/usr/bin/env node
/**
 * Example PreToolUse (Edit|Write) hook: denies edits to .env secret files via structured JSON output.
 */
let raw = "";
for await (const chunk of process.stdin) raw += chunk;

const payload = JSON.parse(raw || "{}");
const filePath = String(payload?.tool_input?.file_path ?? "");

if (/(^|[\\/])\.env(\..+)?$/i.test(filePath) && !filePath.endsWith(".env.example")) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `Editing secret file "${filePath}" is blocked by project policy.`,
      },
    })
  );
  process.exit(0);
}

process.exit(0);
