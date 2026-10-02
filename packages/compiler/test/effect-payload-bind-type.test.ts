import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

// An `effect-event` trigger binds the effect's result — `load.ok($v, $key)` /
// `load.err($e, $key)` (language.md §1.6.5) — and the effect's `out=` says what
// a success is. Nothing carried the type to the bind, so every read of one was
// undecidable and every assignment out of one was accepted: the shape the
// `.get-or` defect actually shipped in, `session := $s.get-or(None)`, passed
// `check` although the same call on a slot receiver is a pair of E0201s.
//
// `$1` on `.ok` now has the type `out=` declares: the Ok payload of a
// `Result(T, E)`, or the whole value of any other `out=`. `$1` on `.err` is the
// `E` for a storage / session / indexed effect, whose handlers deliver the
// declared `Text`. `.err` on any other capability, the request key (`$2`) and
// a result no declaration types stay undecided.
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

  it("a method call on it resolves from that type — the same pair a slot receiver gets", () => {
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
  it("an out= named through a generic alias splits into the substituted payloads", () => {
    expect(
      diagnostics(
        app(`type Loaded(T) = Result(T, Text)
slot label : Text = ""
slot session : Option(Session) = None
${effect("loadSession", "Loaded(Option(Session))")}
reducer raw  on=loadSession.ok($s, _) do= label := $s
reducer keep on=loadSession.ok($s, _) do= session := $s`),
      ),
    ).toEqual(["E0201 8 Expected Text but got Option(Session)"]);
  });
});

describe("the Err payload of a storage-family effect", () => {
  // The storage / session / indexed handlers deliver the `Text` their effects
  // declare as `E` (http.md §6.7), so `$e` on `.err` is that `E`.
  it("is the declared E: reading it as Text passes, reading a member Text lacks does not", () => {
    expect(
      diagnostics(
        app(`slot problem : Text = ""
slot detail : Text = ""
${LOAD}
reducer failed on=loadSession.err($e, _) do= problem := $e
reducer member on=loadSession.err($e, _) do= detail := $e.message`),
      ),
    ).toEqual(['E0108 8 Type "Text" has no member ".message"']);
  });

  it("a slot of another type is a mismatch", () => {
    expect(
      diagnostics(
        app(`slot n : Int = 0
${LOAD}
reducer failed on=loadSession.err($e, _) do= n := $e`),
      ),
    ).toEqual(["E0201 6 Expected Int but got Text"]);
  });

  it.each([
    ["session.read", `map-request={key: "k", decode: Decoder.Json(Session)}`],
    ["indexed.read", `map-request={store: "s", key: "k", decode: Decoder.Json(Session)}`],
    ["indexed.write", `map-request={store: "s", key: "k", value: $1}`],
    ["indexed.delete", `map-request={store: "s", key: "k"}`],
    ["storage.write", `map-request={key: "k", value: $1}`],
    ["session.write", `map-request={key: "k", value: $1}`],
  ])("holds for cap=%s", (cap, mapRequest) => {
    const src = `type Session = {email: Text}
slot n : Int = 0
effect run cap=${cap} in=Unit out=Result(Unit, Text)
    ${mapRequest}
reducer boot   on=app.start        do= emit run()
reducer failed on=run.err($e, _)   do= n := $e
tile App = column(text("x"))
app A
    caps   = [${cap}]
    routes = {"/" -> App, "/404" -> App}
    init   = []`;
    expect(diagnostics(src)).toEqual(["E0201 6 Expected Int but got Text"]);
  });
});

describe("the Err payload of an effect whose failure value the runtime does not fix", () => {
  it("an HTTP effect's $e reads as the HttpError record it is", () => {
    // `effects-http.ts` delivers `{status, message, body}`; the read of
    // `.message` is the one that matches it.
    const src = `slot problem : Text = ""
effect load cap=http.get in=Unit out=Result(Text, HttpError)
    map-request={url: "/x", decode: Decoder.Text}
reducer boot   on=app.start       do= emit load()
reducer failed on=load.err($e, _) do= problem := $e.message
tile App = column(text("x"))
app A
    caps   = [http.get]
    routes = {"/" -> App, "/404" -> App}
    init   = []`;
    expect(diagnostics(src)).toEqual([]);
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

  it("a Result out= of the wrong arity is reported once, and its bind stays undecided", () => {
    // E0210 already says the `Result` is malformed; the bind must not then be
    // typed as that malformed `Result` and add an E0201 of its own.
    expect(
      diagnostics(
        app(`slot session : Option(Session) = None
${effect("loadSession", "Result(Option(Session))")}
reducer keep on=loadSession.ok($s, _) do= session := $s`),
      ),
    ).toEqual(['E0210 3 Type "Result" expects 2 type argument(s) but got 1']);
  });
});
