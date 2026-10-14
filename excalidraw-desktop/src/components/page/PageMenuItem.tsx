import { MainMenu } from "@excalidraw/excalidraw";

import { usePageSetup } from "../../page/usePageSetup";

import { describePageSetup } from "./pageOptions";

type Props = { onOpenSetup: () => void };

/** Main-menu row: "Page: Off" / "Page: A4 · Separate"; opens the page setup dialog. */
export const PageMenuItem = ({ onOpenSetup }: Props) => {
  const { pageSetup, readOnly } = usePageSetup();
  return (
    <MainMenu.Item onSelect={onOpenSetup} disabled={readOnly}>
      Page: {describePageSetup(pageSetup)}
    </MainMenu.Item>
  );
};
