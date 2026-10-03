// Create the GitHub Release for each published package tag, with its CHANGELOG
// section as the body.
//
//   node .github/scripts/github-release.mjs [<tag> ...]
//
// Without tags, reads changesets/action's `publishedPackages` output from
// PUBLISHED_PACKAGES. Needs GITHUB_TOKEN (contents: write) and GITHUB_REPOSITORY.
//
// changesets/action creates these releases itself, but sends the whole section,
// and GitHub refuses a body over 125,000 characters: the v0.14 batch of 119
// changesets gave @kumikijs/compiler a 167,000-character section, so its release
// was never made. Here a section over the limit is cut at an entry boundary and
// links the full changelog. A tag that already has a release is left as it is,
// so a re-run only fills in what is missing.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** GitHub's limit on a release body, in characters. */
export const GITHUB_BODY_LIMIT = 125_000;

/** `@scope/name@1.2.3` → `{name: "@scope/name", version: "1.2.3"}`. */
export function parseTag(tag) {
  const at = tag.lastIndexOf("@");
  return { name: tag.slice(0, at), version: tag.slice(at + 1) };
}

/** The `## <version>` section of a changesets CHANGELOG, without its heading. */
export function changelogSection(changelog, version) {
  const lines = changelog.split("\n");
  const start = lines.indexOf(`## ${version}`);
  if (start === -1) return undefined;
  let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  if (end === -1) end = lines.length;
  return lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
}

/**
 * The release body for `section`: the section itself when it fits `limit`,
 * otherwise the entries that fit, whole, followed by a link to the full
 * changelog at `changelogUrl`.
 */
export function releaseBody(section, changelogUrl, limit = GITHUB_BODY_LIMIT) {
  if (section.length <= limit) return section;
  const footer = `\n\n---\n\nThese notes are cut short: the full list for this release is longer than a GitHub release allows. See [CHANGELOG.md](${changelogUrl}).`;
  const room = limit - footer.length;
  // Each changesets entry starts a line with `- `; cut before the first one
  // that does not fit, so no entry is split.
  let cut = 0;
  for (const m of section.matchAll(/^- /gm)) {
    if (m.index > room) break;
    cut = m.index;
  }
  const lines = section.slice(0, cut).trimEnd().split("\n");
  // Drop a `### Patch Changes` heading whose entries were all cut.
  while (lines.length > 0 && (lines.at(-1) === "" || lines.at(-1).startsWith("#"))) lines.pop();
  return `${lines.join("\n")}${footer}`.trimStart();
}

/** Package name → directory, for every package under `packages/`. */
function packageDirs(root) {
  const dirs = new Map();
  for (const d of readdirSync(join(root, "packages"), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    try {
      const pkg = JSON.parse(readFileSync(join(root, "packages", d.name, "package.json"), "utf8"));
      dirs.set(pkg.name, `packages/${d.name}`);
    } catch {
      // Not a package.
    }
  }
  return dirs;
}

async function github(path, init = {}) {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "x-github-api-version": "2022-11-28",
      ...init.headers,
    },
  });
}

async function createRelease(repo, tag, dir) {
  const existing = await github(`/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`);
  if (existing.ok) {
    console.log(`${tag}: release exists`);
    return;
  }
  const path = `${dir}/CHANGELOG.md`;
  // The changelog as of the tag, which may not be the commit checked out here.
  const res = await github(`/repos/${repo}/contents/${path}?ref=${encodeURIComponent(tag)}`, {
    headers: { accept: "application/vnd.github.raw+json" },
  });
  if (!res.ok) throw new Error(`${tag}: reading ${path} failed: ${res.status}`);
  const { version } = parseTag(tag);
  const section = changelogSection(await res.text(), version);
  if (section === undefined) throw new Error(`${tag}: ${path} has no "## ${version}" section`);
  const url = `https://github.com/${repo}/blob/${encodeURIComponent(tag)}/${path}`;
  const body = releaseBody(section, url);
  const created = await github(`/repos/${repo}/releases`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tag_name: tag, name: tag, body, prerelease: version.includes("-") }),
  });
  if (!created.ok) throw new Error(`${tag}: ${created.status} ${await created.text()}`);
  console.log(
    `${tag}: created (${body.length} characters${body.length < section.length ? ", cut" : ""})`,
  );
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo || !process.env.GITHUB_TOKEN) {
    console.error("GITHUB_REPOSITORY and GITHUB_TOKEN are required");
    process.exit(2);
  }
  const tags = process.argv.slice(2);
  if (tags.length === 0) {
    for (const p of JSON.parse(process.env.PUBLISHED_PACKAGES ?? "[]")) {
      tags.push(`${p.name}@${p.version}`);
    }
  }
  const dirs = packageDirs(process.cwd());
  let failed = false;
  for (const tag of tags) {
    const dir = dirs.get(parseTag(tag).name);
    try {
      if (!dir) throw new Error(`${tag}: no package named ${parseTag(tag).name} under packages/`);
      await createRelease(repo, tag, dir);
    } catch (e) {
      // Keep going: one package's release failing should not leave the rest without one.
      console.error(e instanceof Error ? e.message : e);
      failed = true;
    }
  }
  if (failed) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
