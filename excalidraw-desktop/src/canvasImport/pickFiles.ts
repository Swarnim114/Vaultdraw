/**
 * Opens the system file picker through a detached <input type="file">: the
 * WebView shows the native open panel, and the same code runs in the browser
 * harness (Playwright's file chooser). Resolves [] on cancel.
 */
export const pickFiles = (
  doc: Document,
  accept: string,
  multiple = true,
): Promise<File[]> =>
  new Promise((resolve) => {
    const input = doc.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.addEventListener(
      "change",
      () => resolve(Array.from(input.files ?? [])),
      { once: true },
    );
    input.addEventListener("cancel", () => resolve([]), { once: true });
    input.click();
  });
