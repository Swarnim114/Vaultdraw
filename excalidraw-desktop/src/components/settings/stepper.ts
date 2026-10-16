export interface StepRange {
  min: number;
  max: number;
  step: number;
}

/**
 * One stepper move: the next grid value above (dir 1) or below (dir -1),
 * clamped to the range. A value off the grid (hand-edited config) first lands
 * on the grid.
 */
export const stepValue = (
  value: number,
  dir: 1 | -1,
  { min, max, step }: StepRange,
): number => {
  const cell = (value - min) / step;
  const next = dir === 1 ? Math.floor(cell) + 1 : Math.ceil(cell) - 1;
  return Math.min(max, Math.max(min, min + next * step));
};
