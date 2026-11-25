# claude-hook-replay

**Offline simulator, static doctor, regression test runner, and latency/token profiler for [Claude Code](https://docs.anthropic.com/en/docs/claude-code/hooks) hooks.**

Zero dependencies. Zero tokens burned. Works on macOS, Linux, and Windows.

---

## Why This Exists

Claude Code hooks (`PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SessionStart`, `SessionEnd`, etc.) are powerful — **and painful to debug**:

- Did your matcher regex actually match `Edit|Write`?
- Did your hook exit `2` or emit valid `hookSpecificOutput.permissionDecision: "deny"` JSON?
- Did you forget `stop_hook_active` on a `Stop` hook (causing an infinite loop)?
- Is your `SessionEnd` hook silently getting killed at the 1.5s cutoff?
- How many **extra tokens** is your hook injecting into Claude's context window every turn?

`claude-hook-replay` lets you **lint, simulate, unit-test, and benchmark** all of your `.claude/settings.json` hooks locally and in GitHub Actions CI — **without burning a single Claude API token**.

---

## Quick Start

```bash
# 1. Static check your project & user hooks for bugs, bad regexes, missing scripts & Stop loops
npx claude-hook-replay doctor

# 2. Simulate any Claude Code tool call or lifecycle event offline
npx claude-hook-replay sim PreToolUse --tool Bash --cmd "rm -rf /"
npx claude-hook-replay sim PreToolUse --tool Edit --file .env.production

# 3. Scaffold & run a declarative hook regression suite (.claude/hook-tests.json)
npx claude-hook-replay init
npx claude-hook-replay test

# 4. Benchmark latency (ms) and context token overhead per hook
npx claude-hook-replay bench
```

---

## Example Output

```text
$ npx claude-hook-replay sim PreToolUse --tool Bash --cmd "rm -rf /"

Simulated PreToolUse (Bash)
Verdict:   [BLOCK]  1 hook(s) matched | 42.3ms | ~18 tokens injected

Matcher  Verdict  Exit    Latency  Context  Reason / Command
───────  ───────  ──────  ───────  ───────  ────────────────────────────────────────────────
Bash     [BLOCK]  exit 2  42.3ms   ~18 tok  Blocked destructive Bash command: "rm -rf /"
```

```text
$ npx claude-hook-replay test --settings examples/settings.json --suite examples/hook-tests.json

claude-hook-replay test hook-tests.json

[PASS] Blocks destructive rm -rf command (BLOCK, 39.1ms, ~18 tok)
[PASS] Allows safe npm test command (ALLOW, 36.4ms, ~0 tok)
[PASS] Blocks editing .env.production secrets (BLOCK, 38.7ms, ~16 tok)
[PASS] Allows editing normal TypeScript source file (ALLOW, 35.9ms, ~0 tok)

Result: 4/4 passed
```

---

## Features

| Command | What It Does |
| :--- | :--- |
| `doctor` | Catches unknown hook events, invalid matcher regexes, missing scripts, unquoted `$CLAUDE_PROJECT_DIR`, `SessionEnd` timeout cutoffs, and `Stop` hooks missing `stop_hook_active` loop guards. |
| `sim <Event>` | Feeds realistic Claude Code stdin JSON payloads to your hooks, parses exit codes (`0`, `2`, errors) and structured JSON (`permissionDecision`, `decision`, `additionalContext`), and reports verdict + latency + estimated token cost. |
| `test` | Runs declarative test suites (`.claude/hook-tests.json`) asserting `verdict`, `matched`, `reasonContains`, `contextContains`, `maxMs`, and `maxTokens`. Supports `--json` for CI. |
| `bench` | Profiles every command hook against recommended latency budgets (`PreToolUse <= 250ms`, `SessionEnd <= 1000ms`) and tracks context token bloat. |
| `init` | Generates a ready-to-edit `.claude/hook-tests.json` starter suite. |

---

## Declarative Hook Tests (`.claude/hook-tests.json`)

```json
{
  "tests": [
    {
      "name": "Blocks destructive rm -rf command",
      "event": "PreToolUse",
      "tool": "Bash",
      "cmd": "rm -rf /",
      "expect": {
        "verdict": "BLOCK",
        "matched": 1,
        "reasonContains": "destructive",
        "maxMs": 500
      }
    },
    {
      "name": "Blocks editing .env.production secrets",
      "event": "PreToolUse",
      "tool": "Edit",
      "file": ".env.production",
      "expect": {
        "verdict": "BLOCK",
        "reasonContains": "secret file",
        "maxMs": 500
      }
    }
  ]
}
```

---

## Built-In Claude Code Skill

This repository ships with `.claude/skills/hook-replay/SKILL.md`. Copy `.claude/skills/hook-replay` into your repo (or `~/.claude/skills/`) so Claude Code automatically runs `doctor`, `sim`, `test`, and `bench` whenever it writes or updates a hook.

---

## GitHub Actions CI

Add hook regression testing to your PR checks:

```yaml
- name: Verify Claude Code hooks
  run: |
    npx claude-hook-replay doctor --no-user
    npx claude-hook-replay test --no-user
```

---

## Programmatic API

```js
import { loadAllHooks } from "claude-hook-replay/src/loader.mjs";
import { buildPayload } from "claude-hook-replay/payloads";
import { simulateEvent } from "claude-hook-replay";

const { entries } = loadAllHooks({ settingsPath: ".claude/settings.json" });
const result = await simulateEvent(
  entries,
  buildPayload("PreToolUse", { tool: "Bash", cmd: "rm -rf /" })
);
console.log(result.finalVerdict, result.totalDurationMs, result.totalTokens);
```

---

## License

[MIT](LICENSE)
