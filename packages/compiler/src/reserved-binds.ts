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
 * The gate and the seeds read the same keys, so neither can grow a name the
 * other does not know about. Two other places still spell a list of these
 * names for their own reasons — `checkReducer`'s `localBinds` seed, which
 * omits `$route` so the E0119 gate keeps working, and `references.ts`, which
 * adds the unseeded `$now`.
 *
 * `$now` is absent here on purpose: nothing seeds one, so the name is free.
 */
export const RESERVED_BIND_NAMES: ReadonlyMap<string, string> = new Map([
  ["$el", "_payload.$el || {}"],
  ["$event", "_payload.$event || _payload || {}"],
  ["$route", "_payload.$route || {}"],
]);
