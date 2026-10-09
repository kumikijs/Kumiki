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
// tile's body rendered. A body that renders a list (a for) gets them on every
// node in it, as _named does; merging into the array itself made an object of
// its indices with no kind. No props leaves the node exactly as it was.
function _attachProps(node, props) {
  if (node === null || node === undefined || !props) return node;
  if (Array.isArray(node)) return node.map((n) => _attachProps(n, props));
  if (typeof node !== "object" || typeof node.kind !== "string") return node;
  if (Object.keys(props).length === 0) return node;
  return { ...node, props: { ...(node.props || {}), ...props } };
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
// encoded as a JSON array. A node's own key that is itself such an array (see
// _keySegments) contributes its elements rather than itself, so a key holds
// one element per level of nesting and its length grows linearly with the
// depth. No two pairs spell the same string: an array extended this way has
// three or more elements, and a pair that is not has two.
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
      _wk(n, JSON.stringify([key, ...(typeof n.key === "string" ? _keySegments(n.key) : [i])])),
    );
  }
  return { ...node, key: key };
}
// _keySegments — what a node's own key adds after the call site's key when
// _wk keys a list: the elements of the key when it is the JSON text of an
// array of two or more elements, spelled exactly as JSON.stringify writes it
// (the form _wk gives a node of a list); otherwise the key itself, as one
// element. Anything else stays whole so that no two keys add the same
// elements: an array spelled another way would add what its JSON.stringify
// spelling adds, and a one-element array what its element adds. A key that
// does not start with "[" is returned unparsed; every implicit key starts
// with its loop's name.
function _keySegments(k) {
  if (k.charAt(0) !== "[") return [k];
  let segments;
  try {
    segments = JSON.parse(k);
  } catch {
    return [k];
  }
  return Array.isArray(segments) && segments.length > 1 && JSON.stringify(segments) === k
    ? segments
    : [k];
}
`;
