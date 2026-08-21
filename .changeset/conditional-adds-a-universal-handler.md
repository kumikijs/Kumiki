---
"@kumikijs/runtime": minor
---

fix(runtime): a conditional branch that *adds* `onFocus` / `onBlur` /
`onKeyDown` / `onMouseEnter` now reaches the DOM.

Those four are lifted onto every tile kind by the runtime rather than by a
per-kind renderer, and they dispatch through one shared per-element slot. The
native listeners that read the slot were registered only when the tile carried
a handler at create time — so a branch introducing one on a later render had
nowhere to land: the element is reused, the slot is refreshed with the new
handler, and no listener was ever registered to read it. Nothing threw, and no
diagnostic fired; the handler simply never ran.

Registration now happens on the render that first fills the slot, at create
time or on a patch. A tile that never carries one of the four still registers
nothing, so the saving on the tiles that will never need them is kept.

`onClick` was unaffected throughout — its listener is registered
unconditionally by the button renderer.
