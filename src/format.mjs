const isColorEnabled =
  process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb";

const wrap = (code) => (str) =>
  isColorEnabled ? `\x1b[${code}m${str}\x1b[0m` : String(str);

export const c = {
  bold: wrap("1"),
  dim: wrap("2"),
  red: wrap("31"),
  green: wrap("32"),
  yellow: wrap("33"),
  blue: wrap("34"),
  magenta: wrap("35"),
  cyan: wrap("36"),
  gray: wrap("90"),
};

/**
 * Render an aligned plain-text/ANSI table without external dependencies.
 * @param {string[]} headers
 * @param {Array<Array<string|number>>} rows
 */
export function formatTable(headers, rows) {
  const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, "");
  const widths = headers.map((h, i) => {
    let max = stripAnsi(h).length;
    for (const row of rows) {
      const len = stripAnsi(row[i] ?? "").length;
      if (len > max) max = len;
    }
    return max;
  });

  const padCell = (val, width) => {
    const str = String(val ?? "");
    const visible = stripAnsi(str).length;
    return str + " ".repeat(Math.max(0, width - visible));
  };

  const lines = [];
  lines.push(
    headers.map((h, i) => c.bold(padCell(h, widths[i]))).join("  ")
  );
  lines.push(widths.map((w) => c.dim("─".repeat(w))).join("  "));
  for (const row of rows) {
    lines.push(row.map((cell, i) => padCell(cell, widths[i])).join("  "));
  }
  return lines.join("\n");
}

export function badge(verdict) {
  switch (verdict) {
    case "ALLOW":
    case "PASS":
      return c.green(`[${verdict}]`);
    case "BLOCK":
    case "DENY":
    case "FAIL":
    case "ERROR":
      return c.red(`[${verdict}]`);
    case "ASK":
    case "WARN":
    case "TIMEOUT":
      return c.yellow(`[${verdict}]`);
    default:
      return c.cyan(`[${verdict}]`);
  }
}
