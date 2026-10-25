import type { ExportMode } from "./exportMode";

export type TextAlign = "left" | "center" | "right" | "justify";
export type TextVAlign = "top" | "middle" | "bottom";
export type TextAutoResize = "NONE" | "WIDTH_AND_HEIGHT" | "HEIGHT" | "TRUNCATE";

export interface BinaryPayload {
  mimeType: "image/png" | "image/jpeg";
  bytes: Uint8Array;
}

export interface ColorFill {
  kind: "solid";
  color: string;
  transparency: number;
}

export interface NoFill {
  kind: "none";
}

export interface GradientFill {
  kind: "gradient";
  fallbackColor: string;
  transparency: number;
  gradientType: string;
}

export type FillStyle = ColorFill | GradientFill | NoFill;

export interface StrokeStyle {
  color: string;
  transparency: number;
  width: number;
  dash?: "solid" | "dash" | "dashDot";
  beginArrowType?: "none" | "arrow" | "diamond" | "oval" | "stealth" | "triangle";
  endArrowType?: "none" | "arrow" | "diamond" | "oval" | "stealth" | "triangle";
}

export interface TextStyle {
  fontFamily?: string;
  fontFace?: string;
  fontStyleName?: string;
  fontSize?: number;
  fontWeight?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  transparency?: number;
  align?: TextAlign;
  valign?: TextVAlign;
  lineHeight?: number;
  letterSpacing?: number;
}

export interface TextRun {
  text: string;
  style: TextStyle;
  softBreakBefore?: boolean;
}

export interface ShapeStyle {
  fill?: FillStyle;
  stroke?: StrokeStyle;
  opacity?: number;
  cornerRadius?: number;
}

export interface BaseSlideElement {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  opacity: number;
  sourceMode: ExportMode;
}

export interface TextSlideElement extends BaseSlideElement {
  type: "text";
  text: string;
  autoResize?: TextAutoResize;
  style: TextStyle;
  runs?: TextRun[];
}

export interface ShapeSlideElement extends BaseSlideElement {
  type: "shape";
  shape: "rect" | "roundRect" | "ellipse" | "triangle" | "diamond" | "pentagon" | "hexagon" | "heptagon" | "octagon" | "star4" | "star5" | "star6" | "star7" | "star8" | "star10" | "star12" | "star16" | "star24" | "star32";
  style: ShapeStyle;
}

export interface LineSlideElement extends BaseSlideElement {
  type: "line";
  style: {
    stroke?: StrokeStyle;
  };
}

export interface ImageSlideElement extends BaseSlideElement {
  type: "image";
  data: BinaryPayload;
}

export interface SvgSlideElement extends BaseSlideElement {
  type: "svg";
  svg: string;
}

export type SlideElement =
  | TextSlideElement
  | ShapeSlideElement
  | LineSlideElement
  | ImageSlideElement
  | SvgSlideElement;

export interface ExportLogEntry {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  mode: ExportMode;
  reason: string;
}

export interface SlideModel {
  id: string;
  name: string;
  width: number;
  height: number;
  background?: FillStyle;
  elements: SlideElement[];
}

export interface PresentationModel {
  source: "figma" | "pptx";
  createdAt: string;
  rasterScale: number;
  slides: SlideModel[];
  logs: ExportLogEntry[];
  warnings: string[];
}
