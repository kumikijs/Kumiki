type AppOptions = { caps?: string | undefined; init?: string | undefined };

/** An effect `load` on `storage.read` that takes a key and answers its `Text`. */
export const LOAD_EFFECT =
  "effect load cap=storage.read in=Text out=Result(Text, Text) map-request={key: $1, decode: Decoder.Json(Text)}";

/** `defs` completed into a program by an app that routes every path to the tile `App` it declares. */
export const withApp = (defs: string, { caps = "", init = "" }: AppOptions = {}): string =>
  `${defs}
app A
    caps   = [${caps}]
    routes = {"/" -> App, "/404" -> App}
    init   = [${init}]`;

/** As {@link withApp}, supplying `App` too: a column holding one button `B`. */
export const withButtonApp = (defs: string, opts: AppOptions = {}): string =>
  withApp(`${defs}\ntile B = button(text="x")\ntile App = column(B)`, opts);

/** As {@link withButtonApp}, plus a reducer `r` that runs `body` when `B` is clicked. */
export const withReducer = (defs: string, body: string, opts: AppOptions = {}): string =>
  withButtonApp(`${defs}\nreducer r on=ui.click(B) do= ${body}`, opts);

/** `defs` plus an `App` that is a column of `child`, routed for every path. */
export const withRoot = (child: string, defs: string): string =>
  withApp(`${defs}\ntile App = column(${child})`);

/** A type definition's name as a program writes it as a type: applied to `Int` for each parameter. */
export const appliedName = (t: { name: string; params: readonly string[] }): string =>
  t.params.length === 0 ? t.name : `${t.name}(${t.params.map(() => "Int").join(", ")})`;

/** The nesting bound in language.md, which E0237 holds a tile tree to once its tiles are inlined. */
export const NESTING_LIMIT = 256;

/**
 * `n` tiles from `<name><from>` on, each a column around a call to the next and the last a text:
 * two levels a link, and three for the text, which the parser counts with its string.
 */
export function tileChain(n: number, { from = 0, name = "T" } = {}): string[] {
  return Array.from({ length: n }, (_, i) => {
    const at = from + i;
    return i === n - 1
      ? `tile ${name}${at} = text("leaf")`
      : `tile ${name}${at} = column(${name}${at + 1})`;
  });
}

/** `lines`, after `head`, completed into a program by an app that routes every path to `T0`. */
export const routedToT0 = (lines: readonly string[], head = ""): string =>
  `${head}${lines.join("\n")}\napp M caps=[] routes={"/" -> T0, "/404" -> T0} init=[]\n`;
