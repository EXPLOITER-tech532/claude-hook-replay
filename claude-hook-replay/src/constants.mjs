/**
 * Official Claude Code hook lifecycle events and metadata.
 */
export const HOOK_EVENTS = {
  PreToolUse: {
    hasMatcher: true,
    canBlock: true,
    defaultTimeoutMs: 60_000,
    recommendedBudgetMs: 250,
    description: "Runs before Claude executes a tool call; exit 2 or permissionDecision:'deny' blocks it.",
  },
  PostToolUse: {
    hasMatcher: true,
    canBlock: false,
    defaultTimeoutMs: 60_000,
    recommendedBudgetMs: 400,
    description: "Runs immediately after a tool succeeds; stdout/additionalContext is fed back to Claude.",
  },
  PostToolUseFailure: {
    hasMatcher: true,
    canBlock: false,
    defaultTimeoutMs: 60_000,
    recommendedBudgetMs: 400,
    description: "Runs when a tool call fails.",
  },
  UserPromptSubmit: {
    hasMatcher: false,
    canBlock: true,
    defaultTimeoutMs: 60_000,
    recommendedBudgetMs: 300,
    description: "Runs when the user submits a prompt; can block or inject additional context.",
  },
  Notification: {
    hasMatcher: true,
    canBlock: false,
    defaultTimeoutMs: 60_000,
    recommendedBudgetMs: 500,
    description: "Runs when Claude Code sends a notification (permission_prompt, idle_prompt, etc.).",
  },
  Stop: {
    hasMatcher: false,
    canBlock: true,
    defaultTimeoutMs: 60_000,
    recommendedBudgetMs: 1_000,
    description: "Runs when Claude finishes responding; must guard stop_hook_active to avoid infinite loops.",
  },
  SubagentStop: {
    hasMatcher: false,
    canBlock: true,
    defaultTimeoutMs: 60_000,
    recommendedBudgetMs: 1_000,
    description: "Runs when a Claude Code subagent finishes.",
  },
  PreCompact: {
    hasMatcher: true,
    canBlock: false,
    defaultTimeoutMs: 60_000,
    recommendedBudgetMs: 1_000,
    description: "Runs right before context compaction (manual or auto).",
  },
  SessionStart: {
    hasMatcher: true,
    canBlock: false,
    defaultTimeoutMs: 60_000,
    recommendedBudgetMs: 1_500,
    description: "Runs when a session starts, resumes, or clears.",
  },
  SessionEnd: {
    hasMatcher: false,
    canBlock: false,
    defaultTimeoutMs: 1_500,
    recommendedBudgetMs: 1_000,
    description: "Runs when a session terminates (tight timeout budget).",
  },
};

export const VALID_EVENTS = new Set(Object.keys(HOOK_EVENTS));

export const COMMON_TOOLS = [
  "Bash",
  "Edit",
  "Write",
  "MultiEdit",
  "Read",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "Task",
  "NotebookEdit",
];

/**
 * Rough token estimator (~4 chars/token for English/code, matching BPE averages).
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  if (!text) return 0;
  const trimmed = String(text).trim();
  if (!trimmed) return 0;
  return Math.ceil(trimmed.length / 4);
}
