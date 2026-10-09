import type { TilePatcher, TileRenderer } from "../../core.ts";
import { patchToggle, toggleTile } from "./_shared.ts";

export const checkTile: TileRenderer<"check"> = toggleTile("check");

export const checkPatcher: TilePatcher<"check"> = patchToggle;
