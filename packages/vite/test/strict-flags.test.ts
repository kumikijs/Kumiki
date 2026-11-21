import { describe, expect, it } from "vitest";
import type { KumikiPluginOptions } from "../src/index.ts";
import { transformCode, writeKumiki } from "./helpers/plugin.ts";
import { scratchRoot } from "./helpers/scratch.ts";

const TMP = scratchRoot(import.meta.url);

const route = (root: string) =>
  `app Strict caps=[] routes={"/" -> ${root}, "/404" -> ${root}} init=[]`;

const VIOLATIONS: readonly {
  flag: keyof KumikiPluginOptions;
  code: string;
  src: string;
  marker: string;
}[] = [
  {
    flag: "strictA11y",
    code: "E0701",
    src: `tile App = button()\n${route("App")}\n`,
    marker: "export default App;",
  },
  {
    flag: "strictIcons",
    code: "E0704",
    src: `slot _ : Text = ""\ntile Bad = icon(name="cheque")\ntile Root = column(Bad)\n${route("Root")}\n`,
    marker: "cheque",
  },
  {
    flag: "strictSelectorId",
    code: "E0212",
    src: `slot x : Int = 0
reducer add on=ui.submit(NewForm#nw) do= x := x + 1
tile NewForm = form(text="a") {id: "new"}
tile Root = column(NewForm)
${route("Root")}
`,
    marker: "NewForm",
  },
];

describe("strict compile options", () => {
  it.each(VIOLATIONS)("$flag off compiles a source it would reject", async ({ src, marker }) => {
    expect(await transformCode(src, writeKumiki(TMP, "strict-off", src))).toContain(marker);
  });

  it.each(VIOLATIONS)("$flag on fails the transform with $code", async ({ flag, code, src }) => {
    await expect(
      transformCode(src, writeKumiki(TMP, "strict-on", src), { [flag]: true }),
    ).rejects.toThrow(new RegExp(code));
  });

  it.each([
    {
      name: "a built-in name from @kumikijs/icons under strictIcons",
      opts: { strictIcons: true },
      src: `slot _ : Text = ""\ntile Good = icon(name="check")\ntile Root = column(Good)\n${route("Root")}\n`,
      expected: /"check":\s*"[mM][^"]+"/,
    },
    {
      name: "a custom name declared in theme.icons under strictIcons",
      opts: { strictIcons: true },
      src: `slot _ : Text = ""
tile Good = icon(name="logo")
tile Root = column(Good)
theme Light = { icons: { logo: "M3 3h18v18H3z" } }
${route("Root")}
`,
      expected: /logo/,
    },
    {
      name: "a matching literal id under strictSelectorId",
      opts: { strictSelectorId: true },
      src: `slot x : Int = 0
reducer add on=ui.submit(NewForm#new) do= x := x + 1
tile NewForm = form(text="a") {id: "new"}
tile Root = column(NewForm)
${route("Root")}
`,
      expected: /NewForm/,
    },
  ] satisfies {
    name: string;
    opts: KumikiPluginOptions;
    src: string;
    expected: RegExp;
  }[])("accepts $name", async ({ opts, src, expected }) => {
    expect(await transformCode(src, writeKumiki(TMP, "strict-ok", src), opts)).toMatch(expected);
  });
});
