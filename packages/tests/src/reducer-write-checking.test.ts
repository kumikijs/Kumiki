import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { click, mountApp } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { withApp } from "./helpers/source.ts";

const SOURCE = withApp(`
type Small = nominal Int where between(0, 3)

slot count  : Small = 0
slot mirror : Int   = 0

# Ends at 0 — in range — after reaching 4 on the way. \`mirror\` accumulates the
# value \`count\` holds at each step, so a leaked intermediate is permanent.
reducer drift on=ui.click(DriftBtn)
    do= for d in [1, 1, 1, 1, -1, -1, -1, -1] { count  := count + d
                                                mirror := mirror + count }

reducer walk on=ui.click(WalkBtn)
    do= for d in [1, 1, -1, -1] { count  := count + d
                                  mirror := mirror + count }

tile DriftBtn = button(text="drift", onClick=drift)
tile WalkBtn  = button(text="walk", onClick=walk)
tile App = column(DriftBtn, WalkBtn)
`);

let errors: string[];

beforeEach(() => {
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("every write in a reducer body is checked, not just the batch's last", () => {
  it("rejects a loop that leaves the slot's range even though it ends inside it", async () => {
    const app = await loadSource(SOURCE);
    const { root } = mountApp(app);

    click(root, "drift");

    expect(app.live?.count).toBe(0);
    expect(app.live?.mirror).toBe(0);
    expect(errors).toHaveLength(1);
    // The value the loop passed through, not the one it ended on: the latter is legal and would explain nothing.
    expect(errors[0]).toContain('slot "count" cannot hold 4 (between(0, 3))');
  });

  it("still commits a loop whose every write stays in range", async () => {
    const app = await loadSource(SOURCE);
    const { root } = mountApp(app);

    click(root, "walk");

    expect(app.live?.count).toBe(0);
    expect(app.live?.mirror).toBe(1 + 2 + 1 + 0);
    expect(errors).toEqual([]);
  });
});

describe("a write into a generic applied inside itself", () => {
  const nested = (write: string) =>
    withApp(`
type NonEmpty(T) = T where nonempty
type Short       = Text where len-lt(7)
slot a : NonEmpty(NonEmpty(Short)) = "ku"

reducer set on=ui.click(SetBtn) do= a := ${write}

tile SetBtn = button(text="set", onClick=set)
tile App = column(SetBtn, text(a))
`);

  it("does not compile when the value is an Int", async () => {
    await expect(loadSource(nested("5"))).rejects.toThrow(
      /E0201 .*: Expected NonEmpty\(NonEmpty\(Short\)\) but got Int/,
    );
  });

  it("commits a Text that fits", async () => {
    const app = await loadSource(nested(`"ok"`));
    const { root } = mountApp(app);

    click(root, "set");

    expect(app.live?.a).toBe("ok");
    expect(errors).toEqual([]);
  });
});
