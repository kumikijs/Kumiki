import { check, lex, parse, parseCapabilityManifest } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const checkSrc = (src: string, capabilities?: string[]) => check(parse(lex(src)), { capabilities });

const appWith = (caps: string): string => `
  slot x : Int = 0
  reducer r on=ui.click(B) do= x := x + 1
  tile B = button(text="b")
  tile App = column(B, text(x.show))
  app A caps=${caps} routes={"/" -> App, "/404" -> App} init=[]
`;

describe("capability manifest parsing", () => {
  it("accepts a list of string capability names", () => {
    const r = parseCapabilityManifest({ capabilities: ["telemetry.track", "telemetry.identify"] });
    expect(r).toEqual({
      ok: true,
      manifest: { capabilities: ["telemetry.track", "telemetry.identify"] },
    });
  });

  it("accepts object entries with a name", () => {
    const r = parseCapabilityManifest({
      capabilities: [{ name: "telemetry.track", description: "x" }],
    });
    expect(r.ok && r.manifest.capabilities).toEqual(["telemetry.track"]);
  });

  it("rejects a non-object manifest", () => {
    expect(parseCapabilityManifest([]).ok).toBe(false);
    expect(parseCapabilityManifest(null).ok).toBe(false);
  });

  it("rejects a missing or non-array capabilities field", () => {
    expect(parseCapabilityManifest({}).ok).toBe(false);
    expect(parseCapabilityManifest({ capabilities: "x" }).ok).toBe(false);
  });

  it("rejects a malformed capability name", () => {
    const r = parseCapabilityManifest({ capabilities: ["NotValid"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("group.action");
  });

  it("rejects re-declaring a standard capability", () => {
    expect(parseCapabilityManifest({ capabilities: ["storage.write"] }).ok).toBe(false);
  });
});

// The effects the runtime registers itself, with the argument shape
// `docs/spec/stdlib.md §2.6` gives each and the capability it is gated on.
// `scroll-to` is the one that needs none.
const BUILTIN: [effect: string, cap: string | null, emit: string][] = [
  ["navigate", "nav.push", `emit navigate({path: "/x", params: {}})`],
  ["navigate-replace", "nav.replace", `emit navigate-replace({path: "/x", params: {}})`],
  ["navigate-back", "nav.back", `emit navigate-back()`],
  ["toast", "notification.show", `emit toast({kind: "info", text: "hi"})`],
  ["confirm", "notification.show", `emit confirm({title: "t", onYes: r, onNo: r})`],
  ["log", "log.write", `emit log({level: "info", message: "m", data: {}})`],
  ["scroll-to", null, `emit scroll-to({x: 0, y: 0})`],
];

const emitting = (caps: string, body: string): string => `
  slot x : Int = 0
  reducer r on=ui.click(B) do= ${body}
  tile B = button(text="b", onClick=r)
  tile App = column(B, text(x.show))
  app A caps=${caps} routes={"/" -> App, "/404" -> App} init=[]
`;

describe("built-in effect capabilities (E0301)", () => {
  for (const [effect, cap, emit] of BUILTIN) {
    if (cap === null) {
      it(`asks for no capability for ${effect}`, () => {
        expect(checkSrc(emitting("[]", emit)).map((e) => e.code)).not.toContain("E0301");
      });
      continue;
    }
    it(`requires ${cap} for ${effect}`, () => {
      const err = checkSrc(emitting("[]", emit)).find((e) => e.code === "E0301");
      expect(err, `no E0301 for ${effect}`).toBeDefined();
      expect(err?.message).toContain(cap);
      expect(err?.message).toContain(effect);
    });

    it(`accepts ${effect} once ${cap} is declared`, () => {
      expect(checkSrc(emitting(`[${cap}]`, emit)).map((e) => e.code)).not.toContain("E0301");
    });
  }

  // All three ways to reach an effect share one validation path; a check
  // wired into only the statement form would leave the other two open.
  it("checks an effect emitted for its handle", () => {
    const src = emitting("[]", `let h = emit navigate({path: "/x", params: {}})\n x := 1`);
    expect(checkSrc(src).map((e) => e.code)).toContain("E0301");
  });

  it("checks an effect run from app.init", () => {
    const src = `
      tile App = column(text("hi"))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[toast({kind: "info", text: "hi"})]
    `;
    expect(checkSrc(src).map((e) => e.code)).toContain("E0301");
  });

  it("still reports an unknown effect as undefined rather than uncapable", () => {
    const codes = checkSrc(emitting("[]", 'emit navigat({path: "/x", params: {}})')).map(
      (e) => e.code,
    );
    expect(codes).toContain("E0104");
    expect(codes).not.toContain("E0301");
  });
});

describe("capability checking (E0302)", () => {
  it("accepts standard capabilities", () => {
    expect(checkSrc(appWith("[storage.write, nav.push]")).some((e) => e.code === "E0302")).toBe(
      false,
    );
  });

  it("rejects an unknown capability", () => {
    const errs = checkSrc(appWith("[bogus.thing]"));
    expect(errs.some((e) => e.code === "E0302" && e.message.includes("bogus.thing"))).toBe(true);
  });

  it("accepts a registered (manifest) capability passed via opts", () => {
    expect(
      checkSrc(appWith("[telemetry.track]"), ["telemetry.track"]).some((e) => e.code === "E0302"),
    ).toBe(false);
  });

  it("still rejects a capability that is neither standard nor registered", () => {
    expect(
      checkSrc(appWith("[telemetry.track]"), ["telemetry.identify"]).some(
        (e) => e.code === "E0302",
      ),
    ).toBe(true);
  });
});
