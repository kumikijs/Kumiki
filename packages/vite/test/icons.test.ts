import { describe, expect, it } from "vitest";
import { transformCode, writeKumiki } from "./helpers/plugin.ts";

const FIXTURE = `
slot _ : Text = ""
tile A = icon(name="check")
tile B = icon(name="alert-triangle") {color: "warning"}
tile Root = column(A, B)
app IconApp
    caps   = []
    routes = {"/" -> Root, "/404" -> Root}
    init   = []
`;

describe("vite-plugin-kumiki icon registry", () => {
  it("bakes referenced @kumikijs/icons paths into the emitted App.icons", async () => {
    const code = await transformCode(FIXTURE, writeKumiki("icons", FIXTURE));
    expect(code).toContain("App.icons = {");
    expect(code).toMatch(/"check":\s*"[mM][^"]+"/);
    expect(code).toMatch(/"alert-triangle":\s*"[mM][^"]+"/);
    expect(code).not.toContain("x-circle");
    expect(code).not.toContain("paperclip");
  });
});
