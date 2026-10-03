// Input tile renderers (#71): interactive controls (button, input, textarea,
// check, radio, select, slider, switch, form, editable). `bind=` controls
// write back to their slot through the owning mount's `_setSlot`, resolved
// from the control element via the multi-mount app registry (`resolveApp` in
// core) so several apps on one page never cross-wire.
//
// Every renderer is paired with a patcher (#190) that mutates the mounted
// element in place on a data-prop change, preserving browser-internal state
// (`<select>` open dropdown, `<input>` focus / caret, `contenteditable`
// caret / IME composition). To keep patching correct across `bind` /
// `onChange` closure changes without add/remove-listener churn, native
// listeners are registered ONCE by `create` and dispatch through a
// per-element handler slot held in `INPUT_STATE` — patchers just overwrite
// that slot with the new node's handlers.
//
// Each control is its own module under `tiles/input/`, sharing only
// `tiles/input/_shared.ts`, and that is the unit `kumiki build` ships: a
// counter with one button used to download the select reconciler, the slider,
// and the contenteditable IME guard as well. This file is the family
// aggregate the monolith `mount()` assembles them back into.

import type { TilePatchers, TileRenderers } from "./core.ts";
import { buttonPatcher, buttonTile } from "./tiles/input/button.ts";
import { checkPatcher, checkTile } from "./tiles/input/check.ts";
import { editablePatcher, editableTile } from "./tiles/input/editable.ts";
import { formPatcher, formTile } from "./tiles/input/form.ts";
import { inputPatcher, inputTile } from "./tiles/input/input.ts";
import { radioPatcher, radioTile } from "./tiles/input/radio.ts";
import { selectPatcher, selectTile } from "./tiles/input/select.ts";
import { sliderPatcher, sliderTile } from "./tiles/input/slider.ts";
import { switchPatcher, switchTile } from "./tiles/input/switch.ts";
import { textareaPatcher, textareaTile } from "./tiles/input/textarea.ts";

export const inputTiles: TileRenderers = {
  button: buttonTile,
  input: inputTile,
  textarea: textareaTile,
  check: checkTile,
  radio: radioTile,
  select: selectTile,
  slider: sliderTile,
  switch: switchTile,
  form: formTile,
  editable: editableTile,
};

export const inputPatchers: TilePatchers = {
  button: buttonPatcher,
  input: inputPatcher,
  textarea: textareaPatcher,
  check: checkPatcher,
  radio: radioPatcher,
  select: selectPatcher,
  slider: sliderPatcher,
  switch: switchPatcher,
  form: formPatcher,
  editable: editablePatcher,
};
