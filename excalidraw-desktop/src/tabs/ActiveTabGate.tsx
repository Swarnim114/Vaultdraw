/**
 * Tabs: renders the "moved or deleted outside" placeholder while the active
 * tab is marked missing, else its children (the home screen). Subscribes to
 * the tab store itself, so VaultApp does not re-render for it.
 */
import { MissingTabPlaceholder } from "./MissingTabPlaceholder";
import { useActiveTab } from "./tabStore";

import type { ReactNode } from "react";
import type { TabStore } from "./tabStore";

export interface ActiveTabGateProps {
  /** Absent when tabs are disabled: the children are always shown. */
  store?: TabStore;
  onClose?: () => void;
  onSearch?: (path: string) => void;
  children: ReactNode;
}

const Gate = ({
  store,
  onClose,
  onSearch,
  children,
}: ActiveTabGateProps & { store: TabStore }) => {
  const tab = useActiveTab(store);
  if (tab.missing && tab.path) {
    const { path } = tab;
    return (
      <MissingTabPlaceholder
        path={path}
        onClose={() => onClose?.()}
        onSearch={() => onSearch?.(path)}
      />
    );
  }
  return <>{children}</>;
};

export const ActiveTabGate = (props: ActiveTabGateProps) =>
  props.store ? <Gate {...props} store={props.store} /> : <>{props.children}</>;
