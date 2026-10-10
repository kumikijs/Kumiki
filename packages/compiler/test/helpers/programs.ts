type AppOptions = { caps?: string | undefined; init?: string | undefined };

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
