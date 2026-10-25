import type { PresentationModel } from "../types/slide";

export interface ExportRequestMessage {
  type: "EXPORT_REQUEST";
}

export interface ImportRequestMessage {
  type: "IMPORT_REQUEST";
  presentation: PresentationModel;
}

export interface ExportReadyMessage {
  type: "EXPORT_READY";
  presentation: PresentationModel;
}

export interface ImportReadyMessage {
  type: "IMPORT_READY";
  slideCount: number;
  elementCount: number;
  warnings: string[];
}

export interface ExportErrorMessage {
  type: "EXPORT_ERROR";
  message: string;
}

export interface ImportErrorMessage {
  type: "IMPORT_ERROR";
  message: string;
}

export type UiToPluginMessage = ExportRequestMessage | ImportRequestMessage;
export type PluginToUiMessage = ExportReadyMessage | ExportErrorMessage | ImportReadyMessage | ImportErrorMessage;
