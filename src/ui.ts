import { createPresentation } from "./pptx/createPresentation";
import { parsePptx } from "./pptx/parsePptx";
import type { PluginToUiMessage, UiToPluginMessage } from "./shared/messages";
import type { PresentationModel } from "./types/slide";

const exportButton = getElement<HTMLButtonElement>("export-button");
const importButton = getElement<HTMLButtonElement>("import-button");
const importFileInput = getElement<HTMLInputElement>("import-file");
const statusElement = getElement<HTMLDivElement>("status");
const logElement = getElement<HTMLPreElement>("log");

exportButton.addEventListener("click", () => {
  const message: UiToPluginMessage = {
    type: "EXPORT_REQUEST"
  };

  setWorking(true);
  setStatus("Preparing export...");
  setLog("");
  parent.postMessage({ pluginMessage: message }, "*");
});

importButton.addEventListener("click", () => {
  importFileInput.click();
});

importFileInput.addEventListener("change", async () => {
  const file = importFileInput.files?.[0];
  importFileInput.value = "";

  if (!file) {
    return;
  }

  try {
    setWorking(true);
    setStatus("Reading PPTX...");
    setLog("");

    const presentation = await parsePptx(file);
    const message: UiToPluginMessage = {
      type: "IMPORT_REQUEST",
      presentation
    };

    setStatus("Creating layers in Figma...");
    parent.postMessage({ pluginMessage: message }, "*");
  } catch (error) {
    setWorking(false);
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
});

window.onmessage = async event => {
  const message = event.data.pluginMessage as PluginToUiMessage | undefined;

  if (!message) {
    return;
  }

  if (message.type === "EXPORT_ERROR") {
    setWorking(false);
    setStatus(message.message, true);
    return;
  }

  if (message.type === "IMPORT_ERROR") {
    setWorking(false);
    setStatus(message.message, true);
    return;
  }

  if (message.type === "IMPORT_READY") {
    setWorking(false);
    setStatus(`Imported ${message.slideCount} slide(s), ${message.elementCount} layers. Warnings: ${message.warnings.length}.`);
    setLog(message.warnings.map(warning => `[warning] ${warning}`).join("\n"));
    return;
  }

  try {
    setStatus("Creating PPTX...");
    const pptx = createPresentation(message.presentation);
    const blob = await pptx.write({
      outputType: "blob",
      compression: true
    }) as Blob;

    downloadBlob(blob, getFileName(message.presentation.slides[0]?.name));
    setStatus(`Exported ${message.presentation.slides.length} slide(s). Warnings: ${message.presentation.warnings.length}.`);
    setLog(formatLog(message.presentation));
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    setWorking(false);
  }
};

function formatLog(presentation: PresentationModel) {
  const decisions = presentation.logs.map(log => `[${log.nodeType}] ${log.nodeName} -> ${log.mode}`);
  const warnings = presentation.warnings.map(warning => `[warning] ${warning}`);

  return [...decisions, ...warnings].join("\n");
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function getFileName(slideName?: string): string {
  const baseName = (slideName || "figma-export")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80);

  return `${baseName || "figma-export"}.pptx`;
}

function setWorking(isWorking: boolean) {
  exportButton.disabled = isWorking;
  importButton.disabled = isWorking;
  importFileInput.disabled = isWorking;
}

function setStatus(text: string, isError = false) {
  statusElement.textContent = text;
  statusElement.classList.toggle("error", isError);
}

function setLog(text: string) {
  logElement.textContent = text;
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(`Missing UI element: ${id}`);
  }

  return element as T;
}
