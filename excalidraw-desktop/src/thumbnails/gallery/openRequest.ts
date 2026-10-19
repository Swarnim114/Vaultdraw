/**
 * Tiny emitter so a UI (the navigator's folder menu) can ask the gallery to
 * open a folder without prop plumbing through the app shell.
 */
type Listener = (folder: string) => void;

let listener: Listener | null = null;

export const requestGallery = (folder: string): void => listener?.(folder);

/** The host binds while mounted; returns the unbind function. */
export const onGalleryRequest = (fn: Listener): (() => void) => {
  listener = fn;
  return () => {
    if (listener === fn) {
      listener = null;
    }
  };
};
