import path from "node:path";

/**
 * Build a realistic Claude Code hook stdin JSON payload for any lifecycle event.
 * Matches the documented Claude Code hook input schema so hooks behave identically offline.
 */
export function buildPayload(event, options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const sessionId = options.sessionId ?? "replay-session-0001";
  const transcriptPath =
    options.transcriptPath ?? path.join(cwd, ".claude", "transcript.jsonl");

  const base = {
    session_id: sessionId,
    transcript_path: transcriptPath,
    cwd,
    permission_mode: options.permissionMode ?? "default",
    hook_event_name: event,
  };

  if (
    event === "PreToolUse" ||
    event === "PostToolUse" ||
    event === "PostToolUseFailure"
  ) {
    const toolName = options.tool ?? "Bash";
    const toolInput = buildToolInput(toolName, options);
    const payload = {
      ...base,
      tool_name: toolName,
      tool_input: toolInput,
      tool_use_id: options.toolUseId ?? "toolu_replay_01",
    };
    if (event === "PostToolUse") {
      payload.tool_response = options.toolResponse ?? {
        stdout: "ok",
        stderr: "",
        exit_code: 0,
      };
    }
    if (event === "PostToolUseFailure") {
      payload.error = options.error ?? "Command exited with code 1";
      payload.is_interrupt = false;
    }
    return payload;
  }

  if (event === "UserPromptSubmit") {
    return {
      ...base,
      prompt: options.prompt ?? "Refactor the auth middleware and run tests",
    };
  }

  if (event === "Stop" || event === "SubagentStop") {
    return {
      ...base,
      stop_hook_active: Boolean(options.stopHookActive ?? false),
    };
  }

  if (event === "Notification") {
    return {
      ...base,
      notification_type: options.notificationType ?? "permission_prompt",
      message: options.message ?? "Claude needs permission to run Bash",
    };
  }

  if (event === "PreCompact") {
    return {
      ...base,
      trigger: options.trigger ?? "auto",
      custom_instructions: options.customInstructions ?? "",
    };
  }

  if (event === "SessionStart") {
    return {
      ...base,
      source: options.source ?? "startup",
    };
  }

  if (event === "SessionEnd") {
    return {
      ...base,
      reason: options.reason ?? "other",
    };
  }

  return base;
}

function buildToolInput(toolName, options) {
  if (options.toolInput && typeof options.toolInput === "object") {
    return options.toolInput;
  }
  switch (toolName) {
    case "Bash":
      return {
        command: options.cmd ?? "npm test",
        description: options.description ?? "Run project tests",
      };
    case "Edit":
      return {
        file_path: options.file ?? "src/index.ts",
        old_string: options.oldString ?? "const a = 1;",
        new_string: options.newString ?? "const a = 2;",
      };
    case "Write":
      return {
        file_path: options.file ?? "src/new-file.ts",
        content: options.content ?? "export const ok = true;\n",
      };
    case "Read":
      return {
        file_path: options.file ?? "README.md",
      };
    case "Grep":
      return {
        pattern: options.pattern ?? "TODO",
        path: options.file ?? "src",
      };
    default:
      return options.file ? { file_path: options.file } : {};
  }
}
