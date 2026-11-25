# Contributing to `claude-hook-replay`

Contributions are welcome! This project intentionally has **zero runtime dependencies** so it installs instantaneously via `npx` and runs cleanly in any CI pipeline.

## Local Development

```bash
git clone https://github.com/<your-username>/claude-hook-replay.git
cd claude-hook-replay
npm test
npm run demo:doctor
npm run demo:test
npm run demo:bench
```

## Guidelines
- Keep runtime dependencies at **zero** (use Node.js built-ins `node:fs`, `node:path`, `node:child_process`, `node:test`).
- Ensure every new hook event or assertion works identically on macOS, Linux, and Windows.
- Add unit tests in `test/` for any new diagnostic rule or payload builder.
