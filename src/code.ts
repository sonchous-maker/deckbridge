import { createFigmaPresentation } from "./figma/createFigmaPresentation";
import { parseDocument } from "./parser/parseDocument";
import type { UiToPluginMessage } from "./shared/messages";

figma.showUI(__html__, {
  width: 360,
  height: 360,
  themeColors: true
});

const DEFAULT_RASTER_SCALE = 1;

figma.ui.onmessage = async (message: UiToPluginMessage) => {
  try {
    if (message.type === "IMPORT_REQUEST") {
      const result = await createFigmaPresentation(message.presentation);

      figma.ui.postMessage({
        type: "IMPORT_READY",
        ...result
      });
      return;
    }

    if (message.type !== "EXPORT_REQUEST") {
      return;
    }

    const presentation = await parseDocument(figma.currentPage.selection, {
      rasterScale: DEFAULT_RASTER_SCALE
    });

    figma.ui.postMessage({
      type: "EXPORT_READY",
      presentation
    });
  } catch (error) {
    figma.ui.postMessage({
      type: message.type === "IMPORT_REQUEST" ? "IMPORT_ERROR" : "EXPORT_ERROR",
      message: error instanceof Error ? error.message : String(error)
    });
  }
};
