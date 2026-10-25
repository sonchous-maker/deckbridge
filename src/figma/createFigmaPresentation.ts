import type {
  FillStyle,
  ImageSlideElement,
  LineSlideElement,
  PresentationModel,
  ShapeSlideElement,
  SlideElement,
  StrokeStyle,
  SvgSlideElement,
  TextSlideElement,
  TextStyle
} from "../types/slide";

export interface FigmaImportResult {
  slideCount: number;
  elementCount: number;
  warnings: string[];
}

const SLIDE_GAP = 80;
// Presentation text sizes are in points; Figma expects pixels.
const PT_TO_PX = 96 / 72;
const DEFAULT_FONT: FontName = {
  family: "Inter",
  style: "Regular"
};
const DEFAULT_DECK_FONT: FontName = {
  family: "Inter",
  style: "Regular"
};

export async function createFigmaPresentation(model: PresentationModel): Promise<FigmaImportResult> {
  const warnings = [...model.warnings];
  const frames: FrameNode[] = [];
  const totalWidth = model.slides.reduce((sum, slide, index) => sum + slide.width + (index > 0 ? SLIDE_GAP : 0), 0);
  let x = figma.viewport.center.x - totalWidth / 2;
  const y = figma.viewport.center.y - model.slides[0].height / 2;
  let elementCount = 0;

  for (const slide of model.slides) {
    const frame = figma.createFrame();
    frame.name = slide.name;
    frame.resizeWithoutConstraints(slide.width, slide.height);
    frame.x = x;
    frame.y = y;
    frame.clipsContent = true;
    frame.fills = toFigmaFills(slide.background) ?? [solidPaint("FFFFFF")];

    figma.currentPage.appendChild(frame);
    frames.push(frame);

    for (const element of slide.elements) {
      try {
        await appendElement(frame, element, warnings);
        elementCount += 1;
      } catch (error) {
        warnings.push(`${element.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    x += slide.width + SLIDE_GAP;
  }

  figma.currentPage.selection = frames;
  figma.viewport.scrollAndZoomIntoView(frames);

  return {
    slideCount: frames.length,
    elementCount,
    warnings
  };
}

async function appendElement(frame: FrameNode, element: SlideElement, warnings: string[]) {
  switch (element.type) {
    case "shape":
      appendShape(frame, element);
      break;

    case "line":
      appendLine(frame, element);
      break;

    case "image":
      appendImage(frame, element);
      break;

    case "svg":
      appendSvg(frame, element);
      break;

    case "text":
      await appendText(frame, element, warnings);
      break;
  }
}

function appendShape(frame: FrameNode, element: ShapeSlideElement) {
  const node = createShapeNode(element);

  frame.appendChild(node);
  placeNode(node, element);
  applyGeometryStyle(node, element.style.fill, element.style.stroke);

  if (node.type === "RECTANGLE" && element.shape === "roundRect" && element.style.cornerRadius) {
    node.cornerRadius = Math.min(element.style.cornerRadius, Math.min(element.w, element.h) / 2);
  }
}

function createShapeNode(element: ShapeSlideElement): RectangleNode | EllipseNode | PolygonNode | StarNode {
  if (element.shape === "ellipse") {
    return figma.createEllipse();
  }

  if (element.shape.startsWith("star")) {
    const node = figma.createStar();
    node.pointCount = getPointCount(element.shape, 5);
    return node;
  }

  if (element.shape !== "rect" && element.shape !== "roundRect") {
    const node = figma.createPolygon();
    node.pointCount = getPointCount(element.shape, 4);
    return node;
  }

  return figma.createRectangle();
}

function appendLine(frame: FrameNode, element: LineSlideElement) {
  const node = figma.createLine();
  const length = Math.max(Math.hypot(element.w, element.h), 1);
  const angle = Math.atan2(element.h, element.w) * 180 / Math.PI;

  frame.appendChild(node);
  node.name = element.name;
  node.x = element.x;
  node.y = element.y;
  node.resizeWithoutConstraints(length, 0);
  node.rotation = element.rotation + angle;
  node.opacity = element.opacity;
  applyStroke(node, element.style.stroke);
}

function appendImage(frame: FrameNode, element: ImageSlideElement) {
  const node = figma.createRectangle();
  const image = figma.createImage(new Uint8Array(element.data.bytes));

  frame.appendChild(node);
  placeNode(node, element);
  node.fills = [{
    type: "IMAGE",
    imageHash: image.hash,
    scaleMode: "FILL"
  }];
  node.strokes = [];
}

function appendSvg(frame: FrameNode, element: SvgSlideElement) {
  const node = figma.createNodeFromSvg(element.svg);

  frame.appendChild(node);
  placeNode(node, element);
}

async function appendText(frame: FrameNode, element: TextSlideElement, warnings: string[]) {
  const node = figma.createText();
  const runs = element.runs?.length ? element.runs : [{ text: element.text || " ", style: element.style }];
  const characters = runs.map(run => run.text).join("") || " ";
  const baseFont = await loadFont(element.style, warnings);

  frame.appendChild(node);
  node.name = element.name;
  node.fontName = baseFont;
  node.characters = characters;
  node.textAutoResize = "NONE";
  node.resizeWithoutConstraints(element.w, element.h);
  node.x = element.x;
  node.y = element.y;
  node.rotation = element.rotation;
  node.opacity = element.opacity;
  applyTextNodeStyle(node, element.style);

  let start = 0;

  for (const run of runs) {
    const end = start + run.text.length;

    if (end > start) {
      const font = await loadFont(run.style, warnings);
      applyTextRangeStyle(node, run.style, font, start, end);
    }

    start = end;
  }
}

function placeNode(node: SceneNode & LayoutMixin & MinimalBlendMixin, element: SlideElement) {
  node.name = element.name;
  node.resizeWithoutConstraints(Math.max(element.w, 1), Math.max(element.h, 1));
  node.x = element.x;
  node.y = element.y;
  node.rotation = element.rotation;
  node.opacity = element.opacity;
}

function applyGeometryStyle(node: GeometryMixin & MinimalStrokesMixin, fill?: FillStyle, stroke?: StrokeStyle) {
  const fills = toFigmaFills(fill);
  node.fills = fills ?? [];
  applyStroke(node, stroke);
}

function applyStroke(node: MinimalStrokesMixin, stroke?: StrokeStyle) {
  if (!stroke || stroke.transparency >= 100 || stroke.width <= 0) {
    node.strokes = [];
    return;
  }

  node.strokes = [solidPaint(stroke.color, stroke.transparency)];
  node.strokeWeight = stroke.width;

  if (stroke.dash === "dash") {
    node.dashPattern = [8, 4];
  }

  if (stroke.dash === "dashDot") {
    node.dashPattern = [8, 4, 2, 4];
  }
}

function applyTextNodeStyle(node: TextNode, style: TextStyle) {
  node.textAlignHorizontal = mapHorizontalAlign(style.align);
  node.textAlignVertical = mapVerticalAlign(style.valign);

  if (style.fontSize) {
    node.fontSize = style.fontSize * PT_TO_PX;
  }

  const fills = toTextFills(style);
  if (fills) {
    node.fills = fills;
  }
}

function applyTextRangeStyle(node: TextNode, style: TextStyle, font: FontName, start: number, end: number) {
  node.setRangeFontName(start, end, font);

  if (style.fontSize) {
    node.setRangeFontSize(start, end, style.fontSize * PT_TO_PX);
  }

  const fills = toTextFills(style);
  if (fills) {
    node.setRangeFills(start, end, fills);
  }

  if (style.underline) {
    node.setRangeTextDecoration(start, end, "UNDERLINE");
  }

  if (style.strike) {
    node.setRangeTextDecoration(start, end, "STRIKETHROUGH");
  }
}

async function loadFont(style: TextStyle, warnings: string[]): Promise<FontName> {
  const requested = getFontName(style);

  try {
    await figma.loadFontAsync(requested);
    return requested;
  } catch {
    const fallback = {
      family: requested.family,
      style: "Regular"
    };

    try {
      await figma.loadFontAsync(fallback);
      return fallback;
    } catch {
      await figma.loadFontAsync(DEFAULT_FONT);
      warnings.push(`Font ${requested.family} ${requested.style} is unavailable. Using ${DEFAULT_FONT.family} instead.`);
      return DEFAULT_FONT;
    }
  }
}

function getFontName(style: TextStyle): FontName {
  const sourceFace = style.fontFace ?? style.fontFamily;
  const mappedFont = sourceFace ? mapPptxFontFace(sourceFace, style) : undefined;

  if (mappedFont) {
    return mappedFont;
  }

  return {
    family: sanitizeFontFamily(sourceFace ?? DEFAULT_DECK_FONT.family),
    style: style.fontStyleName ?? getFontStyle(style)
  };
}

function sanitizeFontFamily(family: string): string {
  if (family.startsWith("+") || family.includes("mn-") || family.includes("mj-")) {
    return DEFAULT_DECK_FONT.family;
  }

  return family;
}

function mapPptxFontFace(face: string, style: TextStyle): FontName | undefined {
  const normalizedFace = face.trim().replace(/\s+/g, " ");

  if (normalizedFace.startsWith("+") || normalizedFace.includes("mn-") || normalizedFace.includes("mj-")) {
    return applyFontEmphasis(DEFAULT_DECK_FONT, style);
  }

  const match = normalizedFace.match(/^(.+?)\s+(Regular|Light|Medium|DemiBold|DemiBd|SemiBold|Bold)(?:\s+(Italic))?$/i);

  if (!match) {
    return undefined;
  }

  const family = match[1];
  const baseStyle = mapWeightToken(match[2]) ?? getFontStyle(style);

  return applyFontEmphasis({
    family,
    style: match[3] ? `${baseStyle} Italic` : baseStyle
  }, style);
}

function mapWeightToken(token: string | undefined): string | undefined {
  const weights: Record<string, string> = {
    regular: "Regular",
    light: "Light",
    medium: "Medium",
    demibold: "DemiBold",
    demibd: "DemiBold",
    semibold: "SemiBold",
    bold: "Bold"
  };

  return token ? weights[token.toLowerCase()] : undefined;
}

function applyFontEmphasis(font: FontName, style: TextStyle): FontName {
  let fontStyle = font.style;

  if (style.bold && fontStyle === "Regular") {
    fontStyle = "Bold";
  }

  if (style.italic && !fontStyle.includes("Italic")) {
    fontStyle = `${fontStyle} Italic`;
  }

  return {
    family: font.family,
    style: fontStyle
  };
}

function getFontStyle(style: TextStyle): string {
  if (style.bold && style.italic) return "Bold Italic";
  if (style.bold) return "Bold";
  if (style.italic) return "Italic";
  return "Regular";
}

function toFigmaFills(fill?: FillStyle): Paint[] | undefined {
  if (!fill || fill.kind === "none") {
    return undefined;
  }

  if (fill.kind === "gradient") {
    return [solidPaint(fill.fallbackColor, fill.transparency)];
  }

  return [solidPaint(fill.color, fill.transparency)];
}

function toTextFills(style: TextStyle): Paint[] | undefined {
  if (!style.color) {
    return undefined;
  }

  return [solidPaint(style.color, style.transparency ?? 0)];
}

function solidPaint(hex: string, transparency = 0): SolidPaint {
  return {
    type: "SOLID",
    color: hexToRgb(hex),
    opacity: 1 - clamp(transparency, 0, 100) / 100
  };
}

function hexToRgb(hex: string): RGB {
  const clean = hex.replace("#", "").padEnd(6, "0").slice(0, 6);
  const value = Number.parseInt(clean, 16);

  return {
    r: ((value >> 16) & 255) / 255,
    g: ((value >> 8) & 255) / 255,
    b: (value & 255) / 255
  };
}

function getPointCount(shape: ShapeSlideElement["shape"], fallback: number): number {
  const namedCounts: Partial<Record<ShapeSlideElement["shape"], number>> = {
    triangle: 3,
    diamond: 4,
    pentagon: 5,
    hexagon: 6,
    heptagon: 7,
    octagon: 8
  };

  return namedCounts[shape] ?? Number(shape.match(/\d+$/)?.[0] ?? fallback);
}

function mapHorizontalAlign(align: TextStyle["align"]): "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED" {
  if (align === "center") return "CENTER";
  if (align === "right") return "RIGHT";
  if (align === "justify") return "JUSTIFIED";
  return "LEFT";
}

function mapVerticalAlign(align: TextStyle["valign"]): "TOP" | "CENTER" | "BOTTOM" {
  if (align === "middle") return "CENTER";
  if (align === "bottom") return "BOTTOM";
  return "TOP";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
