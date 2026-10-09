// Regression for issue #61: every tile in the single-source registry
// (`BUILTIN_TILES`) must be handled by codegen. The parser, typechecker, and
// codegen all derive their built-in set from `builtins.ts`, so the only way the
// three can still disagree is a registry entry that codegen's switch doesn't
// implement — which used to surface as `Tile "<name>" not found` (or
// `Unsupported builtin tile`) at build time. This test calls every registered
// tile through codegen and asserts it emits a render expression without
// throwing, locking the layers in agreement.

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_TILES, codegen, lex, parse, VALUE_ARG_BUILTINS } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { contentReading, positionalIsTile, shownInPlaceOfPositional } from "../src/builtins.ts";

/** A minimal call for a tile, with just enough args to be meaningful. */
function callFor(name: string): string {
  switch (name) {
    case "page":
      // `page` is the route root; exercise it as the app body directly.
      return 'page(text("x"))';
    case "route-outlet":
      return "route-outlet()";
    case "error":
      return "error(field=draft)";
    case "link":
      return 'link(to="/")';
    case "image":
      return 'image(src="/x.png")';
    case "icon":
      return 'icon(name="info")';
    case "code":
      return 'code("x", lang="ts")';
    case "video":
      return 'video(src="/x.mp4")';
    default:
      return `${name}()`;
  }
}

function program(call: string): string {
  return [
    'slot draft : Text = ""',
    `tile Probe = column(${call})`,
    "tile App = Probe",
    "app T",
    "    caps = []",
    '    routes = {"/" -> App, "/404" -> App}',
    "    init = []",
  ].join("\n");
}

describe("builtin tile registry (issue #61)", () => {
  for (const name of BUILTIN_TILES) {
    it(`codegen handles "${name}"`, () => {
      const src = program(callFor(name));
      // Bypass typecheck (a11y / required-arg diagnostics are not what we test
      // here) and drive codegen directly — it must not throw for any registered
      // built-in tile.
      const prog = parse(lex(src));
      const { js } = codegen(prog, { runtimeSpecifier: "./runtime.js" });
      expect(js.length).toBeGreaterThan(0);
      expect(js).not.toContain("not found");
    });
  }
});

// Every builtin does one of three things with a positional argument: reads
// the first as its content (a value builtin), renders each one that is a tile
// as a child (a container), or renders none. The checker reads which from
// `positionalIsTile` and `shownInPlaceOfPositional` — a tile in a container is
// accepted and a value is E0128; anything on a builtin that renders none is
// E0129 — so codegen has to lower a positional tile into the node's children
// for exactly the containers, or `check` would accept a tile that renders
// nothing.
describe("what a builtin does with a positional argument", () => {
  it.each([...BUILTIN_TILES])("%s does exactly one thing with it", (name) => {
    const kinds = [
      contentReading(name)?.positional === true && "content",
      positionalIsTile(name) && "children",
      shownInPlaceOfPositional(name) !== undefined && "none",
    ].filter(Boolean);
    expect(kinds).toHaveLength(1);
  });

  const notValueBuiltins = [...BUILTIN_TILES].filter((name) => !VALUE_ARG_BUILTINS.has(name));
  it.each(
    notValueBuiltins,
  )("%s lowers a positional tile exactly when it is a container", (name) => {
    const { js } = codegen(parse(lex(program(`${name}(text("positional-probe"))`))), {
      runtimeSpecifier: "./runtime.js",
    });
    expect(js.includes("positional-probe")).toBe(positionalIsTile(name));
  });

  // §1.7.1 lists the containers by name, in English and in Japanese.
  const here = path.dirname(fileURLToPath(import.meta.url));
  it.each([
    [
      "docs/spec/language.md",
      "- The builtins that render their positional arguments as children are the containers:",
      ".",
    ],
    ["docs/ja/spec/language.md", "- 位置引数を子として描画する builtin はコンテナである：", "。"],
  ])("%s lists the containers", (file, lead, end) => {
    const md = readFileSync(path.join(here, "..", "..", "..", file), "utf8");
    const from = md.indexOf(lead);
    expect(from).toBeGreaterThan(-1);
    const list = md.slice(from + lead.length, md.indexOf(end, from + lead.length));
    const listed = [...list.matchAll(/`([a-z-]+)`/g)].map((m) => m[1]);
    expect(listed.sort()).toEqual([...BUILTIN_TILES].filter(positionalIsTile).sort());
  });
});
