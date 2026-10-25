import { getNamingRule } from "../classifier/getNamingRule";
import { getNodeExportMode } from "../classifier/getNodeExportMode";
import { hasVisibleEffects } from "../classifier/hasVisibleEffects";
import { isVectorLikeNode } from "../classifier/isVectorLikeNode";
import { exportContainerBackground } from "../exporters/exportContainerBackground";
import { exportEllipse } from "../exporters/exportEllipse";
import { exportImage } from "../exporters/exportImage";
import { exportLine } from "../exporters/exportLine";
import { exportRaster } from "../exporters/exportRaster";
import { exportRectangle } from "../exporters/exportRectangle";
import { exportShape } from "../exporters/exportShape";
import { exportSvg } from "../exporters/exportSvg";
import { exportText } from "../exporters/exportText";
import { getGeometryBounds, hasVisibleFill, hasVisibleStroke, intersectRects, type ParseContext } from "../exporters/common";
import type { ExportMode } from "../types/exportMode";
import type { ExportLogEntry, SlideElement } from "../types/slide";

export async function parseNode(
  node: SceneNode,
  context: ParseContext,
  logs: ExportLogEntry[]
): Promise<SlideElement[]> {
  if (context.clipRect === null) {
    return [];
  }

  if (!node.visible) {
    pushLog(logs, node, "IGNORE", "node is hidden");
    return [];
  }

  const namingRule = getNamingRule(node.name);

  if (namingRule === "img") {
    pushLog(logs, node, "RASTER_IMAGE", "explicit naming rule");
    return toElementList(await exportRaster(node, context));
  }

  if (namingRule === "svg") {
    pushLog(logs, node, "SVG", "explicit naming rule");
    return toElementList(await exportSvgWithFallback(node, context, logs));
  }

  if (isMaskNode(node)) {
    context.warnings.push(`${node.name}: mask helper node was skipped. Name the parent group "img" to preserve the masked result as one image.`);
    pushLog(logs, node, "IGNORE", "mask helper node");
    return [];
  }

  if (isRecursiveContainer(node)) {
    return parseContainer(node, context, logs);
  }

  const mode = getNodeExportMode(node);
  pushLog(logs, node, mode, "automatic classification");

  switch (mode) {
    case "PPT_TEXT":
      return [exportText(node as TextNode, context)];

    case "PPT_RECTANGLE":
      return [exportRectangle(node as RectangleNode, context)];

    case "PPT_ELLIPSE":
      return [exportEllipse(node as EllipseNode, context)];

    case "PPT_LINE":
      return [exportLine(node as LineNode, context)];

    case "PPT_SHAPE":
      return [exportShape(node as PolygonNode | StarNode, context)];

    case "PPT_IMAGE":
      return toElementList(await exportImage(node, context));

    case "SVG":
      return toElementList(await exportSvgWithFallback(node, context, logs));

    case "RASTER_IMAGE":
      return toElementList(await exportRaster(node, context));

    case "IGNORE":
      return [];
  }
}

async function parseContainer(
  node: SceneNode & ChildrenMixin,
  context: ParseContext,
  logs: ExportLogEntry[]
): Promise<SlideElement[]> {
  const childContext = getChildContext(node, context);

  if (childContext.clipRect === null) {
    return [];
  }

  const elements: SlideElement[] = [];
  const hasContainerVisualLayer = hasOwnContainerVisualLayer(node);

  if (hasContainerVisualLayer) {
    const background = await exportContainerBackground(node, context, {
      includeNonTextChildren: true,
      excludeImgDescendants: true,
      excludeVectorDescendants: true
    });

    if (background) {
      elements.push(background);
      pushLog(logs, node, "RASTER_IMAGE", "container flattened background fill");
    }
  }

  if (hasContainerVisualLayer) {
    elements.push(...(await parseTextImgAndVectorDescendants(node, childContext, logs)));
    return elements;
  }

  for (const child of node.children) {
    elements.push(...(await parseNode(child, childContext, logs)));
  }

  return elements;
}

async function exportSvgWithFallback(
  node: SceneNode,
  context: ParseContext,
  logs: ExportLogEntry[]
): Promise<SlideElement | undefined> {
  try {
    return await exportSvg(node, context);
  } catch (error) {
    context.warnings.push(`${node.name}: SVG export failed, using PNG fallback. ${getErrorMessage(error)}`);
    pushLog(logs, node, "RASTER_IMAGE", "SVG fallback failed");
    return exportRaster(node, context);
  }
}

function isRecursiveContainer(node: SceneNode): node is SceneNode & ChildrenMixin {
  return "children" in node && (
    node.type === "GROUP" ||
    node.type === "FRAME" ||
    node.type === "COMPONENT" ||
    node.type === "INSTANCE" ||
    node.type === "SECTION" ||
    String(node.type) === "SLIDE"
  );
}

function isMaskNode(node: SceneNode): boolean {
  return "isMask" in node && Boolean(node.isMask);
}

async function parseTextImgAndVectorDescendants(
  node: SceneNode & ChildrenMixin,
  context: ParseContext,
  logs: ExportLogEntry[]
): Promise<SlideElement[]> {
  if (context.clipRect === null) {
    return [];
  }

  const elements: SlideElement[] = [];

  for (const child of node.children) {
    const namingRule = getNamingRule(child.name);

    if (!child.visible) {
      elements.push(...(await parseNode(child, context, logs)));
      continue;
    }

    if (namingRule === "img") {
      elements.push(...(await parseNode(child, context, logs)));
      continue;
    }

    if (child.type === "TEXT") {
      elements.push(...(await parseNode(child, context, logs)));
      continue;
    }

    if (isVectorLikeNode(child)) {
      elements.push(...(await parseNode(child, context, logs)));
      continue;
    }

    if ("children" in child) {
      elements.push(...(await parseTextImgAndVectorDescendants(child, getChildContext(child, context), logs)));
    }
  }

  return elements;
}

function hasOwnContainerVisualLayer(node: SceneNode & ChildrenMixin): boolean {
  return ("fills" in node && hasVisibleFill(node.fills)) ||
    hasVisibleStroke(node) ||
    hasVisibleEffects(node);
}

function getChildContext(node: SceneNode & ChildrenMixin, context: ParseContext): ParseContext {
  if (context.clipRect === null) {
    return context;
  }

  const clipBounds = getClipBounds(node);

  if (!clipBounds) {
    return context;
  }

  return {
    ...context,
    clipRect: context.clipRect ? intersectRects(context.clipRect, clipBounds) ?? null : clipBounds
  };
}

function getClipBounds(node: SceneNode): ReturnType<typeof getGeometryBounds> {
  if (!("clipsContent" in node) || !node.clipsContent) {
    return undefined;
  }

  return getGeometryBounds(node);
}

function toElementList(element: SlideElement | undefined): SlideElement[] {
  return element ? [element] : [];
}

function pushLog(logs: ExportLogEntry[], node: SceneNode, mode: ExportMode, reason: string) {
  logs.push({
    nodeId: node.id,
    nodeName: node.name,
    nodeType: node.type,
    mode,
    reason
  });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
