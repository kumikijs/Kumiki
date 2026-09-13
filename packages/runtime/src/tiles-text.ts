// Text tile renderers (#71): static content tiles (heading, text, label,
// link, markdown, code, icon).
//
// Each tile is its own module under `tiles/text/`, and that is the unit
// `kumiki build` ships: `link` carries a URL-disposition check and a
// once-per-target diagnostic, `icon` a theme-override lookup and a size scale,
// and an app that renders neither used to download both anyway. This file is
// the family aggregate the monolith `mount()` (and anything that wants the
// whole registry) assembles them back into.

import type { TilePatchers, TileRenderers } from "./core.ts";
import { codePatcher, codeTile } from "./tiles/text/code.ts";
import { headingPatcher, headingTile } from "./tiles/text/heading.ts";
import { iconPatcher, iconTile } from "./tiles/text/icon.ts";
import { labelPatcher, labelTile } from "./tiles/text/label.ts";
import { linkPatcher, linkTile } from "./tiles/text/link.ts";
import { markdownPatcher, markdownTile } from "./tiles/text/markdown.ts";
import { textPatcher, textTile } from "./tiles/text/text.ts";

export const textTiles: TileRenderers = {
  heading: headingTile,
  text: textTile,
  label: labelTile,
  link: linkTile,
  markdown: markdownTile,
  code: codeTile,
  icon: iconTile,
};

export const textPatchers: TilePatchers = {
  heading: headingPatcher,
  text: textPatcher,
  label: labelPatcher,
  link: linkPatcher,
  markdown: markdownPatcher,
  code: codePatcher,
  icon: iconPatcher,
};
