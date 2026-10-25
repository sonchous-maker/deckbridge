import type { BaseSlideElement, FillStyle, StrokeStyle } from "../types/slide";

export interface AbsoluteRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ParseContext {
  origin: {
    x: number;
    y: number;
  };
  rasterScale: number;
  warnings: string[];
  // undefined: unrestricted; null: empty visible area.
  clipRect?: AbsoluteRect | null;
}

export function hasVisibleFill(fills: readonly Paint[] | typeof figma.mixed): boolean {
  if (fills === figma.mixed) {
    return false;
  }

  return fills.some(paint => paint.visible !== false && getPaintOpacity(paint) > 0);
}

export function hasVisibleStroke(node: SceneNode): node is SceneNode & MinimalStrokesMixin {
  if (!("strokes" in node)) {
    return false;
  }

  const strokeWeight = "strokeWeight" in node ? node.strokeWeight : 1;

  if (typeof strokeWeight === "number" && strokeWeight <= 0) {
    return false;
  }

  const strokes = node.strokes as readonly Paint[] | typeof figma.mixed;

  if (strokes === figma.mixed) {
    return true;
  }

  return strokes.some(paint => paint.visible !== false && getPaintOpacity(paint) > 0);
}

export function getRelativeRect(node: SceneNode, origin: ParseContext["origin"]) {
  const box = node.absoluteBoundingBox;

  if (!box) {
    return {
      x: 0,
      y: 0,
      w: 0,
      h: 0
    };
  }

  return {
    x: box.x - origin.x,
    y: box.y - origin.y,
    w: box.width,
    h: box.height
  };
}

export function getBaseElement(node: SceneNode, context: ParseContext): Omit<BaseSlideElement, "sourceMode"> {
  const rect = getRelativeRect(node, context.origin);

  return {
    id: node.id,
    name: node.name,
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    rotation: getNodeRotation(node),
    opacity: getNodeOpacity(node)
  };
}

export function getBaseElementForBounds(
  node: SceneNode,
  context: ParseContext,
  bounds: AbsoluteRect,
  rotation = getNodeRotation(node)
): Omit<BaseSlideElement, "sourceMode"> {
  return {
    id: node.id,
    name: node.name,
    x: bounds.x - context.origin.x,
    y: bounds.y - context.origin.y,
    w: bounds.width,
    h: bounds.height,
    rotation,
    opacity: getNodeOpacity(node)
  };
}

export function getGeometryBounds(node: SceneNode): AbsoluteRect | undefined {
  return toAbsoluteRect(node.absoluteBoundingBox);
}

export function getRenderBounds(node: SceneNode): AbsoluteRect | undefined {
  return toAbsoluteRect("absoluteRenderBounds" in node ? node.absoluteRenderBounds : node.absoluteBoundingBox);
}

export function intersectRects(first: AbsoluteRect, second: AbsoluteRect): AbsoluteRect | undefined {
  const x = Math.max(first.x, second.x);
  const y = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const bottom = Math.min(first.y + first.height, second.y + second.height);
  const width = right - x;
  const height = bottom - y;

  if (width <= 0 || height <= 0) {
    return undefined;
  }

  return { x, y, width, height };
}

export function rectContains(outer: AbsoluteRect, inner: AbsoluteRect): boolean {
  return inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height;
}

export function getNodeOpacity(node: SceneNode): number {
  const opacity = (node as { opacity?: unknown }).opacity;
  return typeof opacity === "number" ? opacity : 1;
}

export function getNodeRotation(node: SceneNode): number {
  const rotation = (node as { rotation?: unknown }).rotation;
  return typeof rotation === "number" ? rotation : 0;
}

export function getFillStyle(
  fills: readonly Paint[] | typeof figma.mixed,
  nodeOpacity: number,
  warnings: string[],
  nodeName: string
): FillStyle | undefined {
  if (fills === figma.mixed) {
    warnings.push(`${nodeName}: mixed fills are not supported; exported with no fill.`);
    return { kind: "none" };
  }

  const fill = fills.find(paint => paint.visible !== false);

  if (!fill) {
    return { kind: "none" };
  }

  if (fill.type === "SOLID") {
    return {
      kind: "solid",
      color: rgbToHex(fill.color),
      transparency: opacityToTransparency((fill.opacity ?? 1) * nodeOpacity)
    };
  }

  if (isGradientPaint(fill)) {
    const firstStop = fill.gradientStops[0];

    if (!firstStop) {
      warnings.push(`${nodeName}: empty gradient fill was exported with no fill.`);
      return { kind: "none" };
    }

    warnings.push(`${nodeName}: ${fill.type.toLowerCase()} fill was approximated with its first color stop.`);
    return {
      kind: "gradient",
      fallbackColor: rgbToHex(firstStop.color),
      transparency: opacityToTransparency((firstStop.color.a ?? 1) * nodeOpacity),
      gradientType: fill.type
    };
  }

  warnings.push(`${nodeName}: ${fill.type.toLowerCase()} fill is unsupported for native shape export.`);
  return { kind: "none" };
}

export function getStrokeStyle(
  node: SceneNode & MinimalStrokesMixin,
  nodeOpacity: number,
  warnings: string[]
): StrokeStyle | undefined {
  const strokes = node.strokes as readonly Paint[] | typeof figma.mixed;

  if (strokes === figma.mixed) {
    warnings.push(`${node.name}: mixed strokes are not supported.`);
    return undefined;
  }

  const stroke = strokes.find(paint => paint.visible !== false);

  if (!stroke) {
    return undefined;
  }

  if (stroke.type !== "SOLID") {
    warnings.push(`${node.name}: ${stroke.type.toLowerCase()} stroke was approximated or skipped.`);
  }

  const color = stroke.type === "SOLID" ? rgbToHex(stroke.color) : "000000";
  const strokeOpacity = stroke.type === "SOLID" ? stroke.opacity ?? 1 : 1;

  return {
    color,
    transparency: opacityToTransparency(strokeOpacity * nodeOpacity),
    width: typeof node.strokeWeight === "number" ? node.strokeWeight : 1,
    dash: getDashStyle(node),
    beginArrowType: getBeginArrow(node),
    endArrowType: getEndArrow(node)
  };
}

export function rgbToHex(color: RGB): string {
  return [color.r, color.g, color.b]
    .map(channel => {
      const value = Math.max(0, Math.min(255, Math.round(channel * 255)));
      return value.toString(16).padStart(2, "0");
    })
    .join("")
    .toUpperCase();
}

export function rgbaToHex(color: RGBA): string {
  return rgbToHex({ r: color.r, g: color.g, b: color.b });
}

export function opacityToTransparency(opacity: number): number {
  return Math.max(0, Math.min(100, Math.round((1 - opacity) * 100)));
}

function toAbsoluteRect(rect: Rect | null): AbsoluteRect | undefined {
  if (!rect) {
    return undefined;
  }

  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height
  };
}

function getDashStyle(node: MinimalStrokesMixin): StrokeStyle["dash"] {
  const dashPattern = "dashPattern" in node ? node.dashPattern : [];

  if (!Array.isArray(dashPattern) || dashPattern.length === 0) {
    return "solid";
  }

  return dashPattern.length > 2 ? "dashDot" : "dash";
}

function isGradientPaint(paint: Paint): paint is GradientPaint {
  return paint.type === "GRADIENT_LINEAR" ||
    paint.type === "GRADIENT_RADIAL" ||
    paint.type === "GRADIENT_ANGULAR" ||
    paint.type === "GRADIENT_DIAMOND";
}

function getPaintOpacity(paint: Paint): number {
  return "opacity" in paint && typeof paint.opacity === "number" ? paint.opacity : 1;
}

function getBeginArrow(node: MinimalStrokesMixin): StrokeStyle["beginArrowType"] {
  const strokeCap = "strokeCap" in node ? String(node.strokeCap) : "";
  return strokeCap.includes("ARROW") && strokeCap.includes("START") ? "triangle" : "none";
}

function getEndArrow(node: MinimalStrokesMixin): StrokeStyle["endArrowType"] {
  const strokeCap = "strokeCap" in node ? String(node.strokeCap) : "";

  if (strokeCap.includes("ARROW") || strokeCap.includes("TRIANGLE")) {
    return "triangle";
  }

  return "none";
}
