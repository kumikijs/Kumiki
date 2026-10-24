import type { TilePatchers, TileRenderers } from "./core.ts";
import { buttonPatcher, buttonTile } from "./tiles/input/button.ts";
import { checkPatcher, checkTile } from "./tiles/input/check.ts";
import { editablePatcher, editableTile } from "./tiles/input/editable.ts";
import { fieldsetPatcher, fieldsetTile } from "./tiles/input/fieldset.ts";
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
  fieldset: fieldsetTile,
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
  fieldset: fieldsetPatcher,
  editable: editablePatcher,
};
