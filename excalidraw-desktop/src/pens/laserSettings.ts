/** Laser pointer look. Stored in config.toml under `[laser]`. */
export interface LaserSettings {
  color: string;
  /** Trail thickness in screen pixels. */
  size: number;
  /** Time in ms until a trail point has faded out. */
  decayMs: number;
  /** Number of trail points over which the tail tapers off. */
  length: number;
}

/** Same look as the built-in laser (laserTrails.ts). */
export const DEFAULT_LASER: LaserSettings = {
  color: "red",
  size: 2,
  decayMs: 1000,
  length: 50,
};

export const LASER_LIMITS = {
  size: { min: 1, max: 24 },
  decayMs: { min: 200, max: 5000 },
  length: { min: 5, max: 200 },
} as const;

export const inRange = (
  v: unknown,
  { min, max }: { min: number; max: number },
) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
