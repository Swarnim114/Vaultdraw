import { useAppProps } from "./App";

import "./StyleDefaultMarker.scss";

import type { AppState } from "../types";

/**
 * Shown on a style property's heading when the host (`styleOverrides` prop)
 * says it is overridden, e.g. picked in this drawing. Renders nothing otherwise.
 */
export const StyleDefaultMarker = ({
  fields,
  name,
  label,
}: {
  fields: readonly (keyof AppState)[];
  /** short id for the test id, e.g. "fontFamily" */
  name: string;
  /** the property's visible label */
  label: string;
}) => {
  const { styleOverrides } = useAppProps();
  if (!styleOverrides?.isOverridden(fields)) {
    return null;
  }
  return (
    <span className="style-default-marker">
      <span className="style-default-marker__dot" aria-hidden="true" />
      <button
        type="button"
        className="style-default-marker__button"
        data-testid={`style-use-default-${name}`}
        aria-label={`Use default ${label}`}
        title="Picked in this drawing. Use the default style instead."
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          styleOverrides.useDefault(fields);
        }}
      >
        Use default
      </button>
    </span>
  );
};

/** Heading row for headings that are not a <legend> (aria-hidden colour h3s). */
export const StyleHeadingRow = ({
  children,
}: {
  children: React.ReactNode;
}) => <div className="style-default-heading-row">{children}</div>;
