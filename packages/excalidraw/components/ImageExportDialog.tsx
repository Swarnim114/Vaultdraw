import { exportToCanvas } from "@excalidraw/utils/export";
import React, { useEffect, useMemo, useRef, useState } from "react";

import {
  DEFAULT_EXPORT_PADDING,
  EXPORT_IMAGE_TYPES,
  isFirefox,
  EXPORT_SCALES,
  cloneJSON,
} from "@excalidraw/common";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import {
  actionExportWithDarkMode,
  actionChangeExportBackground,
  actionChangeExportBackgroundPattern,
  actionChangeExportPageShaped,
  actionChangeExportEmbedScene,
  actionChangeExportScale,
  actionChangeProjectName,
} from "../actions/actionExport";
import { probablySupportsClipboardBlob } from "../clipboard";
import { prepareElementsForExport } from "../data";

import {
  createPageAreaExportFrame,
  detachFromFrames,
} from "../data/pageExportFrame";
import { isPageModeOn } from "../data/pageSetup";
import { canvasToBlob } from "../data/blob";
import { nativeFileSystemSupported } from "../data/filesystem";
import { useCopyStatus } from "../hooks/useCopiedIndicator";

import { t } from "../i18n";
import { isSomeElementSelected } from "../scene";

import { copyIcon, downloadIcon, helpIcon } from "./icons";
import { Dialog } from "./Dialog";
import { RadioGroup } from "./RadioGroup";
import { Switch } from "./Switch";
import { Tooltip } from "./Tooltip";
import { FilledButton } from "./FilledButton";

import "./ImageExportDialog.scss";

import type { ExportedElements } from "../data";

import type { ActionManager } from "../actions/manager";

import type { AppClassProperties, BinaryFiles, UIAppState } from "../types";

export const ErrorCanvasPreview = () => {
  return (
    <div>
      <h3>{t("canvasError.cannotShowPreview")}</h3>
      <p>
        <span>{t("canvasError.canvasTooBig")}</span>
      </p>
      <em>({t("canvasError.canvasTooBigTip")})</em>
    </div>
  );
};

type ImageExportModalProps = {
  appStateSnapshot: Readonly<UIAppState>;
  elementsSnapshot: readonly NonDeletedExcalidrawElement[];
  files: BinaryFiles;
  actionManager: ActionManager;
  onExportImage: AppClassProperties["onExportImage"];
  hostHandlesExport: boolean;
  name: string;
  exportWithDarkMode: boolean;
};

const ImageExportModal = ({
  appStateSnapshot,
  elementsSnapshot,
  files,
  actionManager,
  onExportImage,
  hostHandlesExport,
  name,
  exportWithDarkMode,
}: ImageExportModalProps) => {
  const hasSelection = isSomeElementSelected(
    elementsSnapshot,
    appStateSnapshot,
  );

  const [projectName, setProjectName] = useState(name);
  const [exportSelectionOnly, setExportSelectionOnly] = useState(hasSelection);
  const [exportWithBackground, setExportWithBackground] = useState(
    appStateSnapshot.exportBackground,
  );
  const [exportWithPattern, setExportWithPattern] = useState(
    appStateSnapshot.exportBackgroundPattern,
  );
  const [exportPageShaped, setExportPageShaped] = useState(
    appStateSnapshot.exportPageShaped,
  );
  const [embedScene, setEmbedScene] = useState(
    appStateSnapshot.exportEmbedScene,
  );
  const [exportScale, setExportScale] = useState(appStateSnapshot.exportScale);

  const previewRef = useRef<HTMLDivElement>(null);
  const previewRenderRequestIdRef = useRef(0);
  const [renderError, setRenderError] = useState<Error | null>(null);

  const { onCopy, copyStatus, resetCopyStatus } = useCopyStatus();
  const {
    onCopy: onCopySvg,
    copyStatus: copySvgStatus,
    resetCopyStatus: resetCopySvgStatus,
  } = useCopyStatus();

  useEffect(() => {
    // if user changes setting right after export to clipboard, reset the status
    // so they don't have to wait for the timeout to click the button again
    resetCopyStatus();
    resetCopySvgStatus();
  }, [
    projectName,
    exportWithBackground,
    exportWithDarkMode,
    exportScale,
    embedScene,
    resetCopyStatus,
    resetCopySvgStatus,
  ]);

  const prepared = prepareElementsForExport(
    elementsSnapshot,
    appStateSnapshot,
    exportSelectionOnly,
  );
  // Page shape: the export area is the whole page column (not for a
  // selection export, which keeps its own bounds).
  const pageSetup = appStateSnapshot.pageSetup;
  const isPageShaped =
    exportPageShaped &&
    isPageModeOn(pageSetup) &&
    !prepared.exportingFrame &&
    !(exportSelectionOnly && hasSelection);
  const pageFrame = useMemo(
    () =>
      isPageShaped && pageSetup ? createPageAreaExportFrame(pageSetup) : null,
    [isPageShaped, pageSetup],
  );
  const exportingFrame = pageFrame ?? prepared.exportingFrame;
  const exportedElements = useMemo(
    () =>
      pageFrame
        ? (detachFromFrames(prepared.exportedElements) as ExportedElements)
        : prepared.exportedElements,
    [pageFrame, prepared.exportedElements],
  );

  useEffect(() => {
    const previewNode = previewRef.current;
    if (!previewNode) {
      return;
    }
    const maxWidth = previewNode.offsetWidth;
    const maxHeight = previewNode.offsetHeight;
    if (!maxWidth) {
      return;
    }

    const requestId = ++previewRenderRequestIdRef.current;
    const isStaleRequest = () => {
      return requestId !== previewRenderRequestIdRef.current;
    };

    exportToCanvas({
      elements: exportedElements,
      appState: {
        ...appStateSnapshot,
        name: projectName,
        exportBackground: exportWithBackground,
        exportBackgroundPattern: exportWithPattern,
        exportWithDarkMode,
        exportScale,
        exportEmbedScene: embedScene,
      },
      files,
      exportPadding: DEFAULT_EXPORT_PADDING,
      maxWidthOrHeight: Math.max(maxWidth, maxHeight),
      exportingFrame,
    })
      .then(async (canvas) => {
        if (isStaleRequest()) {
          return;
        }

        // If converting to blob fails, there's some problem that will likely
        // prevent preview and export (e.g. canvas too big).
        try {
          await canvasToBlob(canvas);
        } catch (error: any) {
          if (error.name === "CANVAS_POSSIBLY_TOO_BIG") {
            throw new Error(t("canvasError.canvasTooBig"));
          }
          throw error;
        }

        if (isStaleRequest()) {
          return;
        }

        setRenderError(null);
        previewNode.replaceChildren(canvas);
      })
      .catch((error) => {
        if (isStaleRequest()) {
          return;
        }

        console.error(error);
        setRenderError(error);
      });

    return () => {
      previewRenderRequestIdRef.current += 1;
    };
  }, [
    appStateSnapshot,
    files,
    exportedElements,
    exportingFrame,
    projectName,
    exportWithBackground,
    exportWithPattern,
    exportWithDarkMode,
    exportScale,
    embedScene,
  ]);

  return (
    <div className="ImageExportModal">
      <h3>{t("imageExportDialog.header")}</h3>
      <div className="ImageExportModal__preview">
        <div className="ImageExportModal__preview__canvas" ref={previewRef}>
          {renderError && <ErrorCanvasPreview />}
        </div>
        <div className="ImageExportModal__preview__filename">
          {!nativeFileSystemSupported && !hostHandlesExport && (
            <input
              type="text"
              className="TextInput"
              value={projectName}
              style={{ width: "30ch" }}
              onChange={(event) => {
                setProjectName(event.target.value);
                actionManager.executeAction(
                  actionChangeProjectName,
                  "ui",
                  event.target.value,
                );
              }}
            />
          )}
        </div>
      </div>
      <div className="ImageExportModal__settings">
        <h3>{t("imageExportDialog.header")}</h3>
        {hasSelection && (
          <ExportSetting
            label={t("imageExportDialog.label.onlySelected")}
            name="exportOnlySelected"
          >
            <Switch
              name="exportOnlySelected"
              checked={exportSelectionOnly}
              onChange={(checked) => {
                setExportSelectionOnly(checked);
              }}
            />
          </ExportSetting>
        )}
        <ExportSetting
          label={t("imageExportDialog.label.withBackground")}
          name="exportBackgroundSwitch"
        >
          <Switch
            name="exportBackgroundSwitch"
            checked={exportWithBackground}
            onChange={(checked) => {
              setExportWithBackground(checked);
              actionManager.executeAction(
                actionChangeExportBackground,
                "ui",
                checked,
              );
            }}
          />
        </ExportSetting>
        {appStateSnapshot.viewBackgroundPattern && (
          <ExportSetting
            label={t("imageExportDialog.label.withBackgroundPattern")}
            name="exportBackgroundPatternSwitch"
          >
            <Switch
              name="exportBackgroundPatternSwitch"
              checked={exportWithPattern}
              disabled={!exportWithBackground}
              onChange={(checked) => {
                setExportWithPattern(checked);
                actionManager.executeAction(
                  actionChangeExportBackgroundPattern,
                  "ui",
                  checked,
                );
              }}
            />
          </ExportSetting>
        )}
        {isPageModeOn(pageSetup) && (
          <ExportSetting
            label={t("imageExportDialog.label.pageShaped")}
            name="exportPageShapedSwitch"
          >
            <Switch
              name="exportPageShapedSwitch"
              checked={exportPageShaped}
              onChange={(checked) => {
                setExportPageShaped(checked);
                actionManager.executeAction(
                  actionChangeExportPageShaped,
                  "ui",
                  checked,
                );
              }}
            />
          </ExportSetting>
        )}
        <ExportSetting
          label={t("imageExportDialog.label.darkMode")}
          name="exportDarkModeSwitch"
        >
          <Switch
            name="exportDarkModeSwitch"
            checked={exportWithDarkMode}
            onChange={(checked) => {
              actionManager.executeAction(
                actionExportWithDarkMode,
                "ui",
                checked,
              );
            }}
          />
        </ExportSetting>
        <ExportSetting
          label={t("imageExportDialog.label.embedScene")}
          tooltip={t("imageExportDialog.tooltip.embedScene")}
          name="exportEmbedSwitch"
        >
          <Switch
            name="exportEmbedSwitch"
            checked={embedScene}
            onChange={(checked) => {
              setEmbedScene(checked);
              actionManager.executeAction(
                actionChangeExportEmbedScene,
                "ui",
                checked,
              );
            }}
          />
        </ExportSetting>
        <ExportSetting
          label={t("imageExportDialog.label.scale")}
          name="exportScale"
        >
          <RadioGroup
            name="exportScale"
            value={exportScale}
            onChange={(scale) => {
              setExportScale(scale);
              actionManager.executeAction(actionChangeExportScale, "ui", scale);
            }}
            choices={EXPORT_SCALES.map((scale) => ({
              value: scale,
              label: `${scale}\u00d7`,
            }))}
          />
        </ExportSetting>

        <div className="ImageExportModal__settings__buttons">
          <FilledButton
            className="ImageExportModal__settings__buttons__button"
            label={t("imageExportDialog.title.exportToPng")}
            onClick={() =>
              onExportImage(EXPORT_IMAGE_TYPES.png, exportedElements, {
                exportingFrame,
              })
            }
            icon={downloadIcon}
          >
            {t("imageExportDialog.button.exportToPng")}
          </FilledButton>
          <FilledButton
            className="ImageExportModal__settings__buttons__button"
            label={t("imageExportDialog.title.exportToSvg")}
            onClick={() =>
              onExportImage(EXPORT_IMAGE_TYPES.svg, exportedElements, {
                exportingFrame,
              })
            }
            icon={downloadIcon}
          >
            {t("imageExportDialog.button.exportToSvg")}
          </FilledButton>
          {(probablySupportsClipboardBlob ||
            isFirefox ||
            hostHandlesExport) && (
            <FilledButton
              className="ImageExportModal__settings__buttons__button"
              label={t("imageExportDialog.title.copyPngToClipboard")}
              status={copyStatus}
              onClick={async () => {
                await onExportImage(
                  EXPORT_IMAGE_TYPES.clipboard,
                  exportedElements,
                  {
                    exportingFrame,
                  },
                );
                onCopy();
              }}
              icon={copyIcon}
            >
              {t("imageExportDialog.button.copyPng")}
            </FilledButton>
          )}
          {(probablySupportsClipboardBlob ||
            isFirefox ||
            hostHandlesExport) && (
            <FilledButton
              className="ImageExportModal__settings__buttons__button"
              label={t("imageExportDialog.title.copySvgToClipboard")}
              status={copySvgStatus}
              onClick={async () => {
                await onExportImage("clipboard-svg", exportedElements, {
                  exportingFrame,
                });
                onCopySvg();
              }}
              icon={copyIcon}
            >
              {t("imageExportDialog.button.copySvgToClipboard")}
            </FilledButton>
          )}
        </div>
      </div>
    </div>
  );
};

type ExportSettingProps = {
  label: string;
  children: React.ReactNode;
  tooltip?: string;
  name?: string;
};

const ExportSetting = ({
  label,
  children,
  tooltip,
  name,
}: ExportSettingProps) => {
  return (
    <div className="ImageExportModal__settings__setting" title={label}>
      <label
        htmlFor={name}
        className="ImageExportModal__settings__setting__label"
      >
        {label}
        {tooltip && (
          <Tooltip label={tooltip} long={true}>
            {helpIcon}
          </Tooltip>
        )}
      </label>
      <div className="ImageExportModal__settings__setting__content">
        {children}
      </div>
    </div>
  );
};

export const ImageExportDialog = ({
  elements,
  appState,
  files,
  actionManager,
  onExportImage,
  hostHandlesExport = false,
  onCloseRequest,
  name,
}: {
  appState: UIAppState;
  elements: readonly NonDeletedExcalidrawElement[];
  files: BinaryFiles;
  actionManager: ActionManager;
  onExportImage: AppClassProperties["onExportImage"];
  hostHandlesExport?: boolean;
  onCloseRequest: () => void;
  name: string;
}) => {
  // we need to take a snapshot so that the exported state can't be modified
  // while the dialog is open
  const [{ appStateSnapshot, elementsSnapshot }] = useState(() => {
    return {
      appStateSnapshot: cloneJSON(appState),
      elementsSnapshot: cloneJSON(elements),
    };
  });

  return (
    <Dialog onCloseRequest={onCloseRequest} size="wide" title={false}>
      <ImageExportModal
        elementsSnapshot={elementsSnapshot}
        appStateSnapshot={appStateSnapshot}
        files={files}
        actionManager={actionManager}
        onExportImage={onExportImage}
        hostHandlesExport={hostHandlesExport}
        name={name}
        exportWithDarkMode={appState.exportWithDarkMode}
      />
    </Dialog>
  );
};
