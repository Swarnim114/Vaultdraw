import { useRef, type KeyboardEvent } from "react";

import { useSettings } from "./SettingsContext";

import type { SettingsScope } from "./settingsScope";

const OPTIONS: readonly { scope: SettingsScope; label: string }[] = [
  { scope: "global", label: "Global" },
  { scope: "vault", label: "This vault" },
];

/**
 * "Global | This vault": which layer Settings edits. Hidden without a vault;
 * "This vault" is unavailable for a read-only vault.
 */
export const ScopeSwitch = () => {
  const { vault, scope, setScope } = useSettings();
  const listRef = useRef<HTMLDivElement>(null);
  if (!vault) {
    return null;
  }
  const vaultDisabled = vault.readOnly;
  const enabled = OPTIONS.filter((o) => o.scope === "global" || !vaultDisabled);

  const handleKeyDown = (e: KeyboardEvent) => {
    const i = enabled.findIndex((o) => o.scope === scope);
    const last = enabled.length - 1;
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? (i + 1) % enabled.length
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
        ? (i + last) % enabled.length
        : e.key === "Home"
        ? 0
        : e.key === "End"
        ? last
        : null;
    if (next === null) {
      return;
    }
    e.preventDefault();
    const target = enabled[next].scope;
    setScope(target);
    listRef.current
      ?.querySelector<HTMLButtonElement>(`[data-scope="${target}"]`)
      ?.focus();
  };

  return (
    <div
      ref={listRef}
      className="vault-scope-switch"
      role="radiogroup"
      aria-label="Settings scope"
      data-testid="settings-scope"
      onKeyDown={handleKeyDown}
    >
      {OPTIONS.map((o) => {
        const checked = o.scope === scope;
        const disabled = o.scope === "vault" && vaultDisabled;
        return (
          <button
            key={o.scope}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-disabled={disabled || undefined}
            tabIndex={checked ? 0 : -1}
            data-scope={o.scope}
            title={disabled ? "This vault is read-only" : undefined}
            className={`vault-scope-switch__option ${
              checked ? "vault-scope-switch__option--active" : ""
            }`}
            onClick={() => {
              if (!disabled) {
                setScope(o.scope);
              }
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
};
