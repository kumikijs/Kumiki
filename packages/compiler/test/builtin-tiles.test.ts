import { BUILTIN_TILES, codegen, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

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

describe("builtin tile registry", () => {
  for (const name of BUILTIN_TILES) {
    it(`codegen handles "${name}"`, () => {
      const src = program(callFor(name));
      const prog = parse(lex(src));
      const { js } = codegen(prog, { runtimeSpecifier: "./runtime.js" });
      expect(js.length).toBeGreaterThan(0);
      expect(js).not.toContain("not found");
    });
  }
});
