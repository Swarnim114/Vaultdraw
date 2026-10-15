import { MainMenu } from "@excalidraw/excalidraw";

import { useCommandShortcut } from "./useCommandShortcut";

import type { ComponentProps } from "react";

type Props = ComponentProps<typeof MainMenu.Item> & { commandId: string };

/** MainMenu.Item that shows the command's current key (nothing if unbound). */
export const CommandMenuItem = ({ commandId, ...props }: Props) => (
  <MainMenu.Item
    {...props}
    shortcut={useCommandShortcut(commandId) || undefined}
  />
);
