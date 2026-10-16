/**
 * Tag actions bound by the navigator, callable from anywhere without props:
 * the palette's "Tag: #x" entries and the Links dock chips apply a tag filter;
 * a command can focus the Tags pane. Same idea as commands/handlerRegistry:
 * a module-level slot, nothing runs until something calls it.
 */
export interface TagActions {
  /** Put `tag:#key` in the navigator search (expanding the navigator). */
  filter(key: string): void;
  /** Open the Tags section if needed and focus its list. */
  focusPane(): void;
}

let bound: TagActions | null = null;

/** Bind the actions until the returned function is called. */
export function registerTagActions(actions: TagActions): () => void {
  bound = actions;
  return () => {
    if (bound === actions) {
      bound = null;
    }
  };
}

export const applyTagFilter = (key: string) => bound?.filter(key);

/**
 * Focus the Tags pane (a no-op while no navigator is mounted or the vault has
 * no tags). For the lead to bind to a command, e.g. `tags.focus`.
 */
export const focusTagsPane = () => bound?.focusPane();
