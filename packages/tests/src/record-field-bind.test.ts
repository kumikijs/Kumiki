import { feature } from "@kumikijs/examples";
import { type AppShape, mount } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadApp } from "./helpers/load.ts";

const example = feature("134-record-field-bind");

type Explain = (v: unknown, at?: unknown[]) => { kind: string; path: unknown[] } | undefined;

function fill(root: HTMLElement, id: string, value: string): void {
  const inp = root.querySelector<HTMLInputElement>(`#${id}`);
  if (!inp) throw new Error(`#${id} not found`);
  inp.value = value;
  inp.dispatchEvent(new Event("input", { bubbles: true }));
}

function mountInto(app: AppShape): HTMLElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  mount(app, root);
  return root;
}

function errorText(root: HTMLElement): string {
  return root.querySelector('[data-kumiki-tile="error"]')?.textContent ?? "";
}

describe("a record slot's gate, asked about one path", () => {
  it("answers a failure on the path and passes over a sibling's", async () => {
    const app = await loadApp(example);
    const explain = (app.slots.signup as { refineFailure?: Explain }).refineFailure;
    if (!explain) throw new Error("signup carries no nested gate");
    const value = { email: "", name: "Ada", nick: { _tag: "Some", _0: "ada" } };
    // Whole value: the sibling is the first failure.
    expect(explain(value)?.path).toEqual(["email"]);
    // At `name`: nothing on that path fails.
    expect(explain(value, ["name"])).toBeUndefined();
    // At `nick.get`: through the Option's payload, and its own predicate counts.
    expect(explain(value, ["nick", { get: true }])).toBeUndefined();
    const long = { ...value, nick: { _tag: "Some", _0: "lovelace" } };
    expect(explain(long, ["nick", { get: true }])?.kind).toBe("len-lt");
    // At `email`: the bound field's own failure still refuses.
    expect(explain(value, ["email"])?.kind).toBe("email");
  });
});

describe("binding into one field of a record slot", () => {
  it("fills a pristine form in any order", async () => {
    const app = await loadApp(example);
    const root = mountInto(app);
    fill(root, "nick", "ada");
    fill(root, "name", "Ada");
    expect(app.live?.signup).toEqual({
      email: "",
      name: "Ada",
      nick: { _tag: "Some", _0: "ada" },
    });
    fill(root, "email", "ada@example.com");
    expect(app.live?.signup).toEqual({
      email: "ada@example.com",
      name: "Ada",
      nick: { _tag: "Some", _0: "ada" },
    });
  });

  it("still refuses a value the bound field's own refinement fails", async () => {
    const app = await loadApp(example);
    const root = mountInto(app);
    fill(root, "email", "ada@examplecom");
    expect((app.live?.signup as { email: string }).email).toBe("");
  });

  it("judges the message by what every field shows, after a sibling lands", async () => {
    const app = await loadApp(example);
    const root = mountInto(app);
    fill(root, "nick", "lovelace"); // refused; the field keeps showing it
    fill(root, "email", "ada@example.com");
    fill(root, "name", "Ada");
    // The record as it now is, with the refused nick laid over it: the email
    // is fine, so the nick is what the message is about.
    expect(errorText(root)).toBe("Must be less than 6 characters");
    fill(root, "nick", "lovel");
    expect(errorText(root)).toBe("");
  });

  it("lays every refused field over the record, the nick refused first", async () => {
    const app = await loadApp(example);
    const root = mountInto(app);
    fill(root, "name", "Ada");
    fill(root, "email", "a@b.co");
    fill(root, "nick", "lovelace"); // refused
    fill(root, "email", "nope"); // refused
    expect((app.live?.signup as { email: string }).email).toBe("a@b.co");
    expect(errorText(root)).toBe("Invalid email format");
  });

  it("lays every refused field over the record, the email refused first", async () => {
    const app = await loadApp(example);
    const root = mountInto(app);
    fill(root, "name", "Ada");
    fill(root, "email", "a@b.co");
    fill(root, "email", "nope"); // refused
    fill(root, "nick", "lovelace"); // refused
    expect((app.live?.signup as { email: string }).email).toBe("a@b.co");
    expect(errorText(root)).toBe("Invalid email format");
  });

  it("settles a field's refusal at compositionend, at the field", async () => {
    const app = await loadApp(example);
    const root = mountInto(app);
    fill(root, "name", "Ada");
    const nick = root.querySelector<HTMLInputElement>("#nick");
    if (!nick) throw new Error("#nick not found");
    nick.dispatchEvent(new Event("compositionstart"));
    fill(root, "nick", "lovelace"); // refused, not settled yet
    expect(errorText(root)).toBe("Invalid email format"); // the pristine email's
    nick.dispatchEvent(new Event("compositionend"));
    fill(root, "email", "a@b.co");
    expect(errorText(root)).toBe("Must be less than 6 characters");
  });
});
