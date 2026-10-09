import type { TilePatcher, TileRenderer } from "../../core.ts";
import { patchToggle, toggleTile } from "./_shared.ts";

export const switchTile: TileRenderer<"switch"> = toggleTile("switch", "switch");

export const switchPatcher: TilePatcher<"switch"> = patchToggle;
