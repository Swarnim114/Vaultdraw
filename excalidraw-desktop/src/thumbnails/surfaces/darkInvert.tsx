import { createContext, useContext } from "react";

const DarkInvertContext = createContext(false);

export const DarkInvertProvider = DarkInvertContext.Provider;

/** Class for a surface container: one CSS filter scope for all its images. */
export const useThumbDarkClass = (): string =>
  useContext(DarkInvertContext) ? "vault-thumb-dark-invert" : "";
