export const RUNTIME_HELPERS = `
// _children — the child list a container renders, flattened to its nodes. A
// for yields one entry per iteration, and an entry is itself a list when the
// iteration calls a tile whose body is a for, so the flattening goes all the
// way down.
function _children(...xs) {
  const out = [];
  const add = (x) => {
    if (x === null || x === undefined) return;
    if (Array.isArray(x)) for (const y of x) add(y);
    else out.push(x);
  };
  for (const x of xs) add(x);
  return out;
}
// _attachProps — merges a user-tile call site's data props onto what the
// tile's body rendered (language.md §1.7.3). A body that renders a list (a for)
// gets them on every node in it, as _named does; merging into the array itself
// would make an object of its indices with no kind. No props leaves the node
// exactly as it was.
function _attachProps(node, props) {
  if (node === null || node === undefined || !props) return node;
  if (Array.isArray(node)) return node.map((n) => _attachProps(n, props));
  if (typeof node !== "object" || typeof node.kind !== "string") return node;
  if (Object.keys(props).length === 0) return node;
  return { ...node, props: _mergeProps(node.props || {}, props) };
}
// _mergeProps — a prop the call site writes replaces the tile's prop of that
// name; every other prop stays as the tile wrote it. el (the $el payload, where
// the Tile#id filter reads the id) and aria (one entry per aria-* attribute,
// carried in el too) each gather several props, so they merge a field at a time.
function _mergeProps(own, call, inEl) {
  const out = { ...own, ...call };
  if (own.aria && call.aria) out.aria = { ...own.aria, ...call.aria };
  if (!inEl && own.el && call.el) out.el = _mergeProps(own.el, call.el, true);
  return out;
}
function _named(node, name) {
  if (node === null || node === undefined) return node;
  if (Array.isArray(node)) return node.map((n) => _named(n, name));
  if (typeof node !== "object" || typeof node.kind !== "string") return node;
  return { ...node, props: { ...(node.props || {}), _tile: name } };
}
// _wk (with-key) — stamps stable tile identity onto the emitted TileNode.
// Used by codegen at every tile call site that either declared its own
// {key: expr} or sits inside a for iteration, whose _s.loopKeys entry
// supplies the implicit key. The reconciler in runtime/core.ts reads node.key
// on both sides of a diff to do keyed child matching (survives
// reorder/insert/remove).
// Rejects null / undefined / empty-string keys — those collapse different
// tiles onto one identity and mask real bugs (e.g. show() on nil coerces
// to the empty string, making every "no-key" item collide). Throws so
// the outer render bailout catches the panic and falls back to a full
// rebuild rather than silently reusing the wrong DOM element. Only an
// explicit {key: expr} can reach it: an implicit key always starts with the
// loop's name, so a nil element is keyed apart by its occurrence instead
// (runtime.md §10.3.10).
// A user tile whose body renders a list (a for) is keyed per node: one key on
// every node would collapse them onto one identity, the thing this refuses.
// The list is flattened first — an entry is itself a list when the body's for
// calls another for-bodied tile, or is a for of its own — so each node keeps
// the key its own for gave it. Each takes the pair of the call site's key and
// its own key — or its position in the flattened list, when it has none —
// encoded as JSON, so no two pairs can spell the same string.
function _wk(node, key) {
  if (node === null || node === undefined) return node;
  if (key === undefined || key === null || key === "") {
    throw new Error(
      "TileNode.key must be a non-empty string; got " +
        (key === "" ? '""' : String(key)) +
        ". A {key: expr} value evaluated to null / undefined / empty string, which would collapse distinct tiles onto a single identity in the keyed reconciler."
    );
  }
  if (Array.isArray(node)) {
    return _children(node).map((n, i) =>
      _wk(n, JSON.stringify([key, typeof n.key === "string" ? n.key : i])),
    );
  }
  return { ...node, key: key };
}
`;
