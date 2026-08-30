/**
 * The positional bindings codegen declares in every reducer body
 * (language.md §1.6.5), and the payload expression each declaration is seeded
 * from. Only the trigger's own payload actually carries any of them — an
 * effect-event payload is `{$1, $2}` and carries none — so the declaration is
 * what exists everywhere, not the value.
 *
 * That is what makes the names uninhabitable by an `effect-event` bind: a bind
 * lowers to a `const` in the same scope, and two declarations of one name make
 * a module that does not load (E0121).
 *
 * The E0121 gate and the seeds read the same keys, so neither can grow a name
 * the other does not know about. That is the whole of what this table covers:
 * `checkReducer` seeds `localBinds` from its own two-name list, because
 * `$route` must stay out of it for the E0119 gate to work.
 *
 * `$now` is absent on purpose: nothing seeds one, so the name is free.
 */
export const RESERVED_BIND_NAMES: ReadonlyMap<string, string> = new Map([
  ["$el", "_payload.$el || {}"],
  ["$event", "_payload.$event || _payload || {}"],
  ["$route", "_payload.$route || {}"],
]);
