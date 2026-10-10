import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runCli, SPAWN, TWO_SPAWNS } from "./helpers/cli.ts";
import { seed } from "./helpers/files.ts";

const APP = `app FixDemo
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

/** A tile-test whose rendered text comes from a single typo'd source literal. */
const BEHAVIORAL = `tile Title = heading("Helo")
tile App = column(Title)
${APP}test title-text =
    tile-test Title
        given  = {slots: {}}
        expect = heading("Hello")
`;

describe("kumiki fix --auto-patch", () => {
  it("dry-run proposes the literal patch and does not modify the file", SPAWN, () => {
    const file = seed(BEHAVIORAL);
    const { out, code } = runCli(["fix", file, "--auto-patch", "title-text"]);
    expect(code).toBe(1);
    expect(out).toContain('replace "Helo" with "Hello"');
    expect(readFileSync(file, "utf8")).toBe(BEHAVIORAL);
  });

  it("--apply patches the literal and the test then passes", TWO_SPAWNS, () => {
    const file = seed(BEHAVIORAL);
    const { out, code } = runCli(["fix", file, "--auto-patch", "title-text", "--apply"]);
    expect(code).toBe(0);
    expect(out).toContain("PASSES");
    const after = readFileSync(file, "utf8");
    expect(after).toContain('heading("Hello")');
    expect(after).not.toContain('"Helo"');
    const verify = runCli(["test", file]);
    expect(verify.out).toContain("PASS  title-text");
    expect(verify.out).toContain("1/1 passed");
  });

  it("repairs a compile error blocking the test, then runs it", TWO_SPAWNS, () => {
    const file = seed(`slot count : Int = 0
reducer inc on=ui.click(IncBtn) do= conut := count + 1
tile IncBtn = button(text="+1", onClick=inc)
tile App = column(heading("Count: " + count.show), IncBtn)
${APP}test inc-works =
    reducer-test inc
        given  = {slots: {count: 0}, event: {type: ui.click, target: IncBtn}}
        expect = {slots: {count: 1}, effects: []}
`);
    const { out, code } = runCli(["fix", file, "--auto-patch", "inc-works", "--apply"]);
    expect(code).toBe(0);
    expect(out).toContain("compile fix");
    const after = readFileSync(file, "utf8");
    expect(after).toContain("count := count + 1");
    expect(after).not.toContain("conut");
    expect(runCli(["test", file]).out).toContain("PASS  inc-works");
  });

  it("patches a numeric slot mismatch by flipping the reducer operator", SPAWN, () => {
    const file = seed(`slot count : Int = 0
reducer dec on=ui.click(DecBtn) do= count := count - 1
tile DecBtn = button(text="-1", onClick=dec)
tile App = column(heading("Count: " + count.show), DecBtn)
${APP}test dec-should-add =
    reducer-test dec
        given  = {slots: {count: 0}, event: {type: ui.click, target: DecBtn}}
        expect = {slots: {count: 1}, effects: []}
`);
    expect(runCli(["fix", file, "--auto-patch", "dec-should-add", "--apply"]).code).toBe(0);
    const after = readFileSync(file, "utf8");
    expect(after).toContain("count := count + 1");
    expect(after).not.toContain("count := count - 1");
  });

  it("does not patch a literal that lives only in a test fixture", SPAWN, () => {
    const source = `slot msg : Text = "x"
tile Msg = heading(msg.show)
tile App = column(Msg)
${APP}test msg-text =
    tile-test Msg
        given  = {slots: {msg: "Helo"}}
        expect = heading("Hello")
`;
    const file = seed(source);
    const { out, code } = runCli(["fix", file, "--auto-patch", "msg-text", "--apply"]);
    expect(code).toBe(1);
    expect(out).toContain("no auto-patch available");
    expect(readFileSync(file, "utf8")).toBe(source);
  });
});
