/**
 * The positional bindings the runtime fills in on every reducer application
 * (language.md §1.6.5), and the payload expression codegen seeds each one from.
 *
 * A reducer body reads these without binding them, so a bind that takes one of
 * the names has nowhere to put the field its trigger promised — and the emitted
 * reducer declares the same `const` twice, which throws before the module runs.
 * The checker reserves exactly these keys and codegen emits exactly these
 * seeds, so neither side can grow a name the other does not know about.
 *
 * `$now` is absent on purpose: nothing seeds one, so the name is free.
 */
export const RESERVED_BIND_NAMES: ReadonlyMap<string, string> = new Map([
  ["$el", "_payload.$el || {}"],
  ["$event", "_payload.$event || _payload || {}"],
  ["$route", "_payload.$route || {}"],
]);
