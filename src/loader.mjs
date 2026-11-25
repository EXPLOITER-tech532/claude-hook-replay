import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Discover default Claude Code settings files in precedence order.
 * @param {string} cwd
 * @returns {string[]}
 */
export function discoverSettingsFiles(cwd = process.cwd()) {
  const candidates = [
    path.join(os.homedir(), ".claude", "settings.json"),
    path.join(cwd, ".claude", "settings.json"),
    path.join(cwd, ".claude", "settings.local.json"),
  ];
  return candidates.filter((p) => fs.existsSync(p));
}

/**
 * Parse a single Claude Code settings JSON file and flatten its hooks array.
 * @param {string} filePath
 */
export function loadHooksFromFile(filePath) {
  const abs = path.resolve(filePath);
  const raw = fs.readFileSync(abs, "utf8");
  const json = JSON.parse(raw);
  const hooksObj = json?.hooks ?? {};
  const entries = [];

  for (const [event, matchers] of Object.entries(hooksObj)) {
    if (!Array.isArray(matchers)) continue;
    matchers.forEach((group, groupIndex) => {
      const matcher = typeof group?.matcher === "string" ? group.matcher : "";
      const list = Array.isArray(group?.hooks) ? group.hooks : [];
      list.forEach((hook, hookIndex) => {
        entries.push({
          source: abs,
          event,
          matcher,
          groupIndex,
          hookIndex,
          type: hook?.type ?? "command",
          command: hook?.command ?? "",
          timeout: typeof hook?.timeout === "number" ? hook.timeout : undefined,
          raw: hook,
        });
      });
    });
  }

  return { filePath: abs, settings: json, entries };
}

/**
 * Load hooks from explicit --settings path(s) or auto-discovered project/user files.
 * @param {{ settingsPath?: string, cwd?: string, includeUser?: boolean }} opts
 */
export function loadAllHooks(opts = {}) {
  const cwd = opts.cwd ?? process.cwd();
  let files;
  if (opts.settingsPath) {
    files = [path.resolve(cwd, opts.settingsPath)];
  } else {
    files = discoverSettingsFiles(cwd);
    if (opts.includeUser === false) {
      const userSettings = path.join(os.homedir(), ".claude", "settings.json");
      files = files.filter((f) => path.resolve(f) !== path.resolve(userSettings));
    }
  }

  const loaded = [];
  const entries = [];
  const parseErrors = [];

  for (const file of files) {
    if (!fs.existsSync(file)) {
      parseErrors.push({ file, error: `Settings file not found: ${file}` });
      continue;
    }
    try {
      const res = loadHooksFromFile(file);
      loaded.push(res);
      entries.push(...res.entries);
    } catch (err) {
      parseErrors.push({ file, error: err.message });
    }
  }

  return { files, loaded, entries, parseErrors };
}
