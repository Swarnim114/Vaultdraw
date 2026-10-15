/**
 * "Pick a drawing" through the palette: `pickDrawing()` opens the file palette
 * and resolves with the chosen path (null when dismissed). One pick at a time;
 * a new one cancels the previous.
 */
import { useCallback, useRef, useState } from "react";

export type PalettePick = {
  label: string;
  resolve(path: string | null): void;
};

export function usePalettePick() {
  const [pick, setPick] = useState<PalettePick | null>(null);
  const current = useRef<PalettePick | null>(null);

  const finish = useCallback((path: string | null) => {
    const active = current.current;
    current.current = null;
    setPick(null);
    active?.resolve(path);
  }, []);

  const pickDrawing = useCallback(
    (label = "Pick a drawing"): Promise<string | null> =>
      new Promise((resolve) => {
        current.current?.resolve(null);
        const next = { label, resolve };
        current.current = next;
        setPick(next);
      }),
    [],
  );

  return { pick, pickDrawing, finish };
}
