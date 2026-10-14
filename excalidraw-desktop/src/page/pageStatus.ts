/**
 * The open drawing's page setup as a module-level fact, so the palette (which
 * lives outside the editor tree) can show the current choice of a family
 * ("Page size: A4" with a check mark).
 */
import type { PageSetup } from "@excalidraw/excalidraw/data/pageSetup";

let current: PageSetup | null = null;

export const setPageStatus = (setup: PageSetup | null): void => {
  current = setup;
};

/** True when `id` is a page command that describes the current setup. */
export const isPageCommandChecked = (id: string): boolean => {
  const setup = current;
  if (!id.startsWith("page.")) {
    return false;
  }
  if (id === "page.on") {
    return !!setup?.enabled;
  }
  if (id === "page.off") {
    return !setup?.enabled;
  }
  if (!setup) {
    return false;
  }
  const [, family, value] = id.split(".");
  switch (family) {
    case "layout":
      return setup.layout === value;
    case "size":
      return setup.size === value;
    case "orientation":
      return setup.orientation === value;
    case "paper":
      return setup.paperTheme === value;
    default:
      return false;
  }
};
