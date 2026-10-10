export const RESERVED_BIND_NAMES: ReadonlyMap<string, string> = new Map([
  ["$el", "_payload.$el || {}"],
  ["$event", "_payload.$event || _payload || {}"],
  ["$route", "_payload.$route || {}"],
]);
