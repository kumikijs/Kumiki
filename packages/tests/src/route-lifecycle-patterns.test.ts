import { describe, expect, it, onTestFinished } from "vitest";
import { answer, dialogs } from "./helpers/confirm.ts";
import { mountSource, navigate, tick } from "./helpers/dom.ts";
import { answerConfirm, logAfter, navigateTo as nav, stepsAfter } from "./helpers/scenario.ts";

const SRC = `
slot log : Text = ""
reducer enterS on=route.enter("/s/*") do= log := log + "+S;"
reducer leaveS on=route.leave("/s/*") do= log := log + "-S;"
reducer enterA on=route.enter("/s/a") do= log := log + "+a;"
reducer leaveA on=route.leave("/s/a") do= log := log + "-a;"
reducer enterB on=route.enter("/s/b") do= log := log + "+b;"
reducer leaveB on=route.leave("/s/b") do= log := log + "-b;"
reducer enterD on=route.enter("/s")   do= log := log + "+d;"
reducer leaveD on=route.leave("/s")   do= log := log + "-d;"
reducer enterH on=route.enter("/")    do= log := log + "+h;"
reducer leaveH on=route.leave("/")    do= log := log + "-h;"
tile A        = page(heading("Child A"))
tile B        = page(heading("Child B"))
tile D        = page(heading("S home"))
tile S sub-routes = {"/s/a" -> A, "/s/b" -> B, "/s" -> D} = page(route-outlet())
tile Home     = page(heading("Home"))
tile NotFound = page(heading("404"))
app Chain
    caps   = [nav.push]
    routes = {"/" -> Home, "/s/*" -> S, "/404" -> NotFound}
    init   = []
`;

const CONFIRM_CAPS = SRC.replace("caps   = [nav.push]", "caps   = [nav.push, notification.show]");
const answers = `
reducer goOn on=ui.click(_) do= ()
reducer stay on=ui.click(_) do= ()
`;

/** The same app with a guard that holds every move off `/s/a` behind confirm. */
const GUARDED = CONFIRM_CAPS.concat(
  answers,
  `
reducer guardA on=route.leave("/s/a")
    do= emit confirm({title: "Leave A?", message: "", onYes: goOn, onNo: stay})
`,
);

describe("route.enter / route.leave follow the matched chain", () => {
  it("enters the parent, then the sub-route it matched", async () => {
    expect(await logAfter(SRC, nav("/s/a"))).toBe("+h;-h;+S;+a;");
  });

  it("enters the whole chain the app mounts on", async () => {
    expect(await logAfter(SRC, [{ wait: 0 }], "/s/b")).toBe("+S;+b;");
  });

  it("leaves the sub-route, then the parent, when the path changes", async () => {
    expect(await logAfter(SRC, nav("/s/a", "/"))).toBe("+h;-h;+S;+a;-a;-S;+h;");
  });

  it("leaves and re-enters the parent on a switch between its children", async () => {
    expect(await logAfter(SRC, nav("/s/a", "/s/b"))).toBe("+h;-h;+S;+a;-a;-S;+S;+b;");
  });

  it("enters the parent's default sub-route on its bare path and on a path no child takes", async () => {
    expect(await logAfter(SRC, nav("/s", "/s/zzz"))).toBe("+h;-h;+S;+d;-d;-S;+S;+d;");
  });

  it("re-enters the chain and leaves nothing on a move that changes only the query", async () => {
    expect(await logAfter(SRC, nav("/s/a", "/s/a?tab=1"))).toBe("+h;-h;+S;+a;+S;+a;");
  });

  // Defined child first, with the parent's reducers on either side of it, so the order comes from
  // the chain rather than from the definitions.
  it("runs a pattern's reducers in definition order, the parent's before the child's on enter", async () => {
    const src = SRC.replace(
      'slot log : Text = ""',
      `slot log : Text = ""
reducer enterS1 on=route.enter("/u/*") do= log := log + "+S1;"
reducer leaveS1 on=route.leave("/u/*") do= log := log + "-S1;"
reducer enterU  on=route.enter("/u/a") do= log := log + "+a;"
reducer leaveU  on=route.leave("/u/a") do= log := log + "-a;"
reducer enterS2 on=route.enter("/u/*") do= log := log + "+S2;"
reducer leaveS2 on=route.leave("/u/*") do= log := log + "-S2;"
tile U sub-routes = {"/u/a" -> A} = page(route-outlet())`,
    ).replace('"/s/*" -> S,', '"/s/*" -> S, "/u/*" -> U,');
    expect(await logAfter(src, nav("/u/a", "/"))).toBe("+h;-h;+S1;+S2;+a;-a;-S1;-S2;+h;");
  });

  it("runs a sub-route keyed like its parent once, as the parent's own pattern", async () => {
    const src = `
slot log : Text = ""
reducer enterD on=route.enter("/docs/*") do= log := log + "+docs;"
reducer leaveD on=route.leave("/docs/*") do= log := log + "-docs;"
reducer enterI on=route.enter("/docs/intro") do= log := log + "+intro;"
tile Intro    = page(heading("Intro"))
tile DocPage  = page(heading("Doc"))
tile Docs sub-routes = {"/docs/intro" -> Intro, "/docs/*" -> DocPage} = page(route-outlet())
tile Home     = page(heading("Home"))
tile NotFound = page(heading("404"))
app Docs
    caps   = [nav.push]
    routes = {"/" -> Home, "/docs/*" -> Docs, "/404" -> NotFound}
    init   = []
`;
    expect(await logAfter(src, nav("/docs/x", "/", "/docs/intro"))).toBe(
      "+docs;-docs;+docs;+intro;",
    );
  });

  it("hands a sub-route's reducer the top-level pattern and the params its child matched", async () => {
    const src = SRC.replace(
      'slot log : Text = ""',
      `slot log : Text = ""
reducer enterU on=route.enter("/u/:id")
    do= log := log + $route.pattern + " " + $route.params.get-or("id", "?") + ";"
tile U sub-routes = {"/u/:id" -> A} = page(route-outlet())`,
    ).replace('"/s/*" -> S,', '"/s/*" -> S, "/u/*" -> U,');
    expect(await logAfter(src, nav("/u/7"))).toBe("+h;-h;/u/* 7;");
  });
});

describe("a navigation a route reducer emits stops the rest of its chain", () => {
  const ADMIN = `
slot log : Text = ""
slot redirected : Bool = false
reducer enterL on=route.enter("/login")       do= log := log + "+login;"
reducer leaveA on=route.leave("/admin/*")     do= log := log + "-admin;"
reducer leaveU on=route.leave("/admin/users") do= log := log + "-users;"
tile Users    = page(heading("Users"))
tile Other    = page(heading("Other"))
tile Login    = page(heading("Login"))
tile Admin sub-routes = {"/admin/users" -> Users, "/admin/other" -> Other} = page(route-outlet())
tile Home     = page(heading("Home"))
tile NotFound = page(heading("404"))
app Admin
    caps   = [nav.push, nav.replace]
    routes = {"/" -> Home, "/admin/*" -> Admin, "/login" -> Login, "/404" -> NotFound}
    init   = []
`;
  const withReducers = (defs: string): string =>
    ADMIN.replace("slot redirected", `${defs}\nslot redirected`);
  const redirect = (effect: string): string => `do= log := log + "+admin;"
    emit ${effect}({path: "/login"})`;

  it("runs no child loader once the parent's enter guard has redirected", async () => {
    const src =
      withReducers(`reducer requireAuth on=route.enter("/admin/*") ${redirect("navigate-replace")}
reducer load on=route.enter("/admin/users") do= log := log + "+users;"`);
    expect(await logAfter(src, nav("/admin/users"))).toBe("+admin;-users;-admin;+login;");
  });

  it("runs no later reducer on the same pattern once one has redirected", async () => {
    const src = withReducers(`reducer requireAuth on=route.enter("/admin/*") ${redirect("navigate")}
reducer load on=route.enter("/admin/*") do= log := log + "+load;"`);
    expect(await logAfter(src, nav("/admin/users"))).toBe("+admin;-users;-admin;+login;");
  });

  // The guard's own navigation leaves the route still shown and lands; the move it overtook does
  // not go on to run the parent's leave a second time.
  it("runs no parent leave once the child's leave has navigated", async () => {
    const src = withReducers(`reducer away on=route.leave("/admin/users")
    do= if !redirected then emit navigate({path: "/login"})
        redirected := true`);
    expect(await logAfter(src, nav("/admin/users", "/admin/other"))).toBe("-users;-admin;+login;");
  });
});

describe("route.leave on a sub-route pattern guards the move", () => {
  it("holds a switch to a sibling behind confirm, and Yes enters the new chain", async () => {
    expect(await logAfter(GUARDED, [...nav("/s/a", "/s/b"), answerConfirm("yes")])).toBe(
      "+h;-h;+S;+a;-a;-S;+S;+b;",
    );
  });

  it("No stays on the child it guards and enters nothing", async () => {
    const last = (await stepsAfter(GUARDED, [...nav("/s/a", "/s/b"), answerConfirm("no")])).at(-1);
    expect(last?.state?.log).toBe("+h;-h;+S;+a;-a;-S;");
    expect(last?.domText).toContain("Child A");
    expect(last?.domText).not.toContain("Child B");
  });

  it("asks once for each guard of the chain, and one answer settles the move", async () => {
    const src = CONFIRM_CAPS.concat(
      answers,
      `
reducer guardA on=route.leave("/s/a")
    do= emit confirm({title: "Leave A?", message: "", onYes: goOn, onNo: stay})
reducer guardS on=route.leave("/s/*")
    do= emit confirm({title: "Leave S?", message: "", onYes: goOn, onNo: stay})
`,
    );
    const { app } = await mountSource(src, "/", ["nav.push", "notification.show"]);
    onTestFinished(() => {
      for (const el of dialogs()) el.remove();
    });
    await navigate(app, "/s/a");
    await navigate(app, "/s/b");
    expect(dialogs().map((d) => d.textContent)).toEqual([
      expect.stringContaining("Leave A?"),
      expect.stringContaining("Leave S?"),
    ]);
    answer(dialogs()[0], "yes");
    await tick(0);
    expect(dialogs()).toEqual([]);
    expect(app.live?.log).toBe("+h;-h;+S;+a;-a;-S;+S;+b;");
  });
});

describe("route.error follows the chain of the route being shown", () => {
  const ERR = `slot xs : List(Int) = []
slot seen : Text = ""
reducer errS on=route.error("/s/*") do= seen := seen + "S " + $event.pattern + ";"
reducer errA on=route.error("/s/a") do= seen := seen + "a " + $event.pattern + ";"
reducer errB on=route.error("/s/b") do= seen := seen + "b " + $event.pattern + ";"
tile NotFound = column(text("nf"))
tile Boom = column(text("head " + xs.head.get.show))
tile Fine = column(text("fine"))
tile S sub-routes={"/s/a" -> Boom, "/s/b" -> Fine} = column(route-outlet())
app M caps=[] routes={"/s/*" -> S, "/404" -> NotFound} init=[]
`;

  it("fires for the parent and the sub-route, each with the pattern it named", async () => {
    const { app } = await mountSource(ERR, "/s/a");
    expect(app.live?.seen).toBe("S /s/*;a /s/a;");
  });

  it("lets a handler on the sub-route alone recover the page in place of the panic display", async () => {
    const src = ERR.replace(/^reducer err[SB] .*\n/gm, "").replace(
      'seen := seen + "a " + $event.pattern + ";"',
      `seen := seen + "a " + $event.pattern + ";"
        xs := [1]`,
    );
    const { app, root } = await mountSource(src, "/s/a");
    expect(app.live?.seen).toBe("a /s/a;");
    expect(root.querySelector("[data-kumiki-panic]")).toBeNull();
    expect(root.textContent).toContain("head 1");
  });
});
