// Pure half of the bundle-size benchmark: byte counting, base-vs-head
// comparison and the Markdown both the terminal and the PR comment show. No
// filesystem and no builds here — `measure.mjs` produces the reports this
// reads, so the comparison is testable on hand-written rows.

import { brotliCompressSync, constants, gzipSync } from "node:zlib";

/** First line of the PR comment; the CI step finds and updates its own comment by it. */
export const MARKER = "<!-- kumiki-bundle-size -->";

/**
 * Raw, gzip and brotli byte counts of one file as a server would send it.
 *
 * Both at their maximum level — gzip 9, brotli 11 — because that is what a
 * precompressed static deploy ships, and it keeps the number a property of the
 * bytes rather than of whichever on-the-fly level a host picks.
 */
export function sizes(buf) {
  return {
    raw: buf.length,
    gzip: gzipSync(buf, { level: 9 }).length,
    brotli: brotliCompressSync(buf, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).length,
  };
}

const fmt = (n) => n.toLocaleString("en-US");

/** `+346 (+1.7%)`, `-120 (-0.6%)`, or `±0`. */
export function formatDelta(base, head) {
  const d = head - base;
  if (d === 0) return "±0";
  const sign = d > 0 ? "+" : "-";
  const pct = base === 0 ? "" : ` (${sign}${((Math.abs(d) / base) * 100).toFixed(1)}%)`;
  return `${sign}${fmt(Math.abs(d))}${pct}`;
}

/** The metrics a comparison reads, as `[label, pick]` — one column each. */
const COLUMNS = [
  ["bundle gzip", (a) => a.bundle.gzip],
  ["bundle brotli", (a) => a.bundle.brotli],
  ["modular gzip", (a) => a.modular.gzip],
  // Uncompressed, because that is the figure the CLI's counter size test
  // budgets — a PR can see how close it brings the counter to that line.
  ["runtime/ raw", (a) => a.runtime],
];

const sameBytes = (a, b) =>
  a.runtime === b.runtime &&
  ["raw", "gzip", "brotli"].every(
    (k) => a.bundle[k] === b.bundle[k] && a.modular[k] === b.modular[k],
  );

/** Sum of every app's metrics, in the same shape as one app. */
function sum(apps) {
  const zero = () => ({ raw: 0, gzip: 0, brotli: 0 });
  const t = { bundle: zero(), modular: { files: 0, ...zero() }, runtime: 0 };
  for (const a of apps) {
    for (const k of ["raw", "gzip", "brotli"]) {
      t.bundle[k] += a.bundle[k];
      t.modular[k] += a.modular[k];
    }
    t.modular.files += a.modular.files;
    t.runtime += a.runtime;
  }
  return t;
}

/**
 * Pair each head app with its base by name.
 *
 * Head order first, then the apps only the base had. The total covers only
 * apps both sides build: a PR that adds an example would otherwise read as a
 * size regression of exactly that example.
 */
export function compareReports(base, head) {
  const byName = new Map(base.apps.map((a) => [a.name, a]));
  const headNames = new Set(head.apps.map((a) => a.name));
  const rows = head.apps.map((h) => {
    const b = byName.get(h.name);
    if (!b) return { name: h.name, status: "added", base: undefined, head: h };
    return { name: h.name, status: sameBytes(b, h) ? "unchanged" : "changed", base: b, head: h };
  });
  for (const b of base.apps) {
    if (!headNames.has(b.name))
      rows.push({ name: b.name, status: "removed", base: b, head: undefined });
  }
  const both = rows.filter((r) => r.base && r.head);
  return {
    rows,
    total: { base: sum(both.map((r) => r.base)), head: sum(both.map((r) => r.head)) },
  };
}

function cell(base, head) {
  if (base === head) return fmt(head);
  return `${fmt(head)}<br><sub>${formatDelta(base, head)}</sub>`;
}

/** A single run as a table — what `measure.mjs` prints. */
export function renderReport(report) {
  const lines = [
    "| App | bundle raw | bundle gzip | bundle brotli | modular files | modular gzip | runtime/ raw |",
    "|---|---:|---:|---:|---:|---:|---:|",
  ];
  for (const a of report.apps) {
    lines.push(
      `| ${a.name} | ${fmt(a.bundle.raw)} | ${fmt(a.bundle.gzip)} | ${fmt(a.bundle.brotli)} | ${a.modular.files} | ${fmt(a.modular.gzip)} | ${fmt(a.runtime)} |`,
    );
  }
  return lines.join("\n");
}

const FOOTNOTE =
  "<sub>bytes · gzip level 9, brotli quality 11 · **bundle** = `kumiki build --bundle` (one file) · **modular** = `kumiki build --minify`, each file compressed on its own · **runtime/ raw** = the modular build minus app.js, uncompressed · head = the PR's merge commit, base = its first parent</sub>";

/**
 * The PR comment: head against base, one row per example app.
 *
 * `base` is undefined when the base could not be measured — a base whose CLI
 * predates `kumiki build --bundle`, as `main` does until the release that
 * ships it. The head's sizes then show on their own.
 */
export function renderComparison(base, head) {
  if (!base) return renderHeadOnly(head);
  const { rows, total } = compareReports(base, head);
  const moved = rows.some((r) => r.status !== "unchanged");
  const headline = moved
    ? `Total over the apps both sides build: bundle gzip ${fmt(total.head.bundle.gzip)}, ${formatDelta(total.base.bundle.gzip, total.head.bundle.gzip)}; bundle brotli ${fmt(total.head.bundle.brotli)}, ${formatDelta(total.base.bundle.brotli, total.head.bundle.brotli)}.`
    : "No change: every example builds to the same bytes as the base.";
  const lines = [
    MARKER,
    "## Bundle size",
    "",
    headline,
    "",
    `| App | ${COLUMNS.map(([label]) => label).join(" | ")} |`,
    `|---|${COLUMNS.map(() => "---:").join("|")}|`,
  ];
  for (const r of rows) {
    if (r.status === "added" || r.status === "removed") {
      const side = r.head ?? r.base;
      const vals = COLUMNS.map(([, pick]) => fmt(pick(side)));
      lines.push(`| ${r.name} (${r.status}) | ${vals.join(" | ")} |`);
      continue;
    }
    const vals = COLUMNS.map(([, pick]) => cell(pick(r.base), pick(r.head)));
    lines.push(`| ${r.name} | ${vals.join(" | ")} |`);
  }
  lines.push("", FOOTNOTE);
  return `${lines.join("\n")}\n`;
}

function renderHeadOnly(head) {
  const lines = [
    MARKER,
    "## Bundle size",
    "",
    "The base could not be measured (its CLI cannot build what this script asks for), so these are the head's sizes alone.",
    "",
    `| App | ${COLUMNS.map(([label]) => label).join(" | ")} |`,
    `|---|${COLUMNS.map(() => "---:").join("|")}|`,
  ];
  for (const a of head.apps) {
    lines.push(`| ${a.name} | ${COLUMNS.map(([, pick]) => fmt(pick(a))).join(" | ")} |`);
  }
  lines.push("", FOOTNOTE);
  return `${lines.join("\n")}\n`;
}
