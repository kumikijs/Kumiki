import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

// An `effect-event` trigger binds the effect's result — `load.ok($v, $key)` /
// `load.err($e, $key)` (language.md §1.6.5) — and the effect's `out=` says what
// that result is. Nothing carried the type to the bind, so every read of one
// was undecidable and every assignment out of one was accepted: the shape the
// `.get-or` defect (#294) actually shipped in, `session := $s.get-or(None)`,
// passed `check` although the same call on a slot receiver is a pair of E0201s.
//
// `$1` now has the type `out=` declares: a `Result(T, E)` gives `T` on `.ok`
// and `E` on `.err`; any other `out=` is the whole value on `.ok`. The request
// key (`$2`) and a result no declaration types stay undecided.
//
// Each case that pins something staying *quiet* shares its program with one
// that must report, and the expectation is the whole list — so the quiet half
// cannot pass merely because payload binds are untyped altogether.

const app = (defs: string): string =>
  `type Session = {email: Text}
${defs}
tile B = button(text="x")
tile App = column(B)
app A
    caps   = [storage.read]
    routes = {"/" -> App, "/404" -> App}
    init   = []`;

const effect = (name: string, out: string): string =>
  `effect ${name} cap=storage.read in=Unit out=${out}
    map-request={key: "session", decode: Decoder.Json(Session)}
reducer boot-${name} on=app.start do= emit ${name}()`;

const LOAD = effect("loadSession", "Result(Option(Session), Text)");

const diagnostics = (src: string) =>
  check(parse(lex(src))).map((e) => `${e.code} ${e.pos.line} ${e.message}`);

describe("the Ok payload of a Result out=", () => {
  it("is the Ok type: a slot of another type is a mismatch, a slot of that type is not", () => {
    expect(
      diagnostics(
        app(`slot label : Text = ""
slot session : Option(Session) = None
${LOAD}
reducer raw  on=loadSession.ok($s, _) do= label := $s
reducer keep on=loadSession.ok($s, _) do= session := $s`),
      ),
    ).toEqual(["E0201 7 Expected Text but got Option(Session)"]);
  });

  it("a method call on it resolves from that type — the #294 pair a slot receiver gets", () => {
    expect(
      diagnostics(
        app(`slot session : Option(Session) = None
${LOAD}
reducer sessIn on=loadSession.ok($s, _) do= session := $s.get-or(None)`),
      ),
    ).toEqual([
      'E0201 6 Expected Session but got variant "None"',
      "E0201 6 Expected Option(Session) but got Session",
    ]);
  });

  it("an out= named through an alias still splits into its payloads", () => {
    expect(
      diagnostics(
        app(`type Loaded = Result(Option(Session), Text)
slot label : Text = ""
${effect("loadSession", "Loaded")}
reducer raw on=loadSession.ok($s, _) do= label := $s`),
      ),
    ).toEqual(["E0201 7 Expected Text but got Option(Session)"]);
  });
});

describe("the Err payload of a Result out=", () => {
  it("is the Err type, not the Ok type", () => {
    expect(
      diagnostics(
        app(`slot problem : Text = ""
slot session : Option(Session) = None
${LOAD}
reducer failed on=loadSession.err($e, _) do= problem := $e
reducer wrong  on=loadSession.err($e, _) do= session := $e`),
      ),
    ).toEqual(["E0201 8 Expected Option(Session) but got Text"]);
  });
});

describe("an out= that is not a Result", () => {
  it("is the whole value on .ok, and undecided on .err", () => {
    // What `.err` carries for such an effect is the runtime's failure, which
    // no declaration names — so `n := $e` is not claimed to be wrong.
    expect(
      diagnostics(
        app(`slot label : Text = ""
slot n : Int = 0
${effect("loadSession", "Option(Session)")}
reducer raw    on=loadSession.ok($s, _)  do= label := $s
reducer failed on=loadSession.err($e, _) do= n := $e`),
      ),
    ).toEqual(["E0201 7 Expected Text but got Option(Session)"]);
  });
});

describe("what stays undecided", () => {
  it("the second bind, the request key", () => {
    expect(
      diagnostics(
        app(`slot label : Text = ""
slot n : Int = 0
${LOAD}
reducer keyed on=loadSession.ok($s, $k)
    do= label := $s
        n := $k`),
      ),
    ).toEqual(["E0201 8 Expected Text but got Option(Session)"]);
  });

  it("an out= whose type is undecidable leaves its bind undecided", () => {
    // `Missing` is reported where it is written; the bind adds no second
    // report by guessing a type for it.
    const errs = diagnostics(
      app(`slot label : Text = ""
${effect("loadMissing", "Missing")}
${LOAD}
reducer a on=loadMissing.ok($m, _) do= label := $m
reducer b on=loadSession.ok($s, _) do= label := $s`),
    ).filter((d) => d.startsWith("E0201"));
    expect(errs).toEqual(["E0201 10 Expected Text but got Option(Session)"]);
  });
});
