/** User-facing text for a native PDF error (NativeError.code). */
export const pdfErrorMessage = (err: unknown): string => {
  const code = (err as { code?: unknown } | null)?.code;
  switch (code) {
    case "PDF_ENCRYPTED":
      return "This PDF is password-protected.";
    case "PDF_BAD_PASSWORD":
      return "Wrong password. Try again.";
    case "PDF_INVALID":
      return "Not a readable PDF.";
    case "PDF_TOO_LARGE":
      return "This PDF is too large to import.";
    default:
      return "Couldn't import the PDF.";
  }
};
