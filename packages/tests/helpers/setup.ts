import { clearStorage, installTestDoubles } from "@kumikijs/cli";
import { beforeEach } from "vitest";

installTestDoubles();

beforeEach(() => {
  clearStorage();
});
