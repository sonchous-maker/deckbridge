import type { ExportMode } from "../types/exportMode";
import type { ImageSlideElement } from "../types/slide";
import {
  getBaseElementForBounds,
  getRenderBounds,
  intersectRects,
  rectContains,
  type AbsoluteRect,
  type ParseContext
} from "./common";

export async function exportNodeAsRaster(
  node: SceneNode,
  context: ParseContext,
  sourceMode: Extract<ExportMode, "PPT_IMAGE" | "RASTER_IMAGE">
): Promise<ImageSlideElement | undefined> {
  if (context.clipRect === null) {
    return undefined;
  }

  const renderBounds = getRenderBounds(node);

  if (!renderBounds) {
    context.warnings.push(`${node.name}: has no render bounds and was skipped.`);
    return undefined;
  }

  const exportBounds = context.clipRect
    ? intersectRects(renderBounds, context.clipRect)
    : renderBounds;

  if (!exportBounds) {
    context.warnings.push(`${node.name}: is outside the clipping frame and was skipped.`);
    return undefined;
  }

  const needsClipping = Boolean(context.clipRect && !rectContains(context.clipRect, renderBounds));
  let bytes: Uint8Array;

  try {
    bytes = needsClipping
      ? await exportClippedNode(node, exportBounds, context.rasterScale)
      : await exportNode(node, context.rasterScale);
  } catch (error) {
    context.warnings.push(`${node.name}: PNG export was skipped because Figma could not export it. ${getErrorMessage(error)}`);
    return undefined;
  }

  return {
    ...getBaseElementForBounds(node, context, exportBounds, 0),
    sourceMode,
    type: "image",
    data: {
      mimeType: "image/png",
      bytes
    }
  };
}

async function exportNode(node: SceneNode, rasterScale: number): Promise<Uint8Array> {
  return node.exportAsync({
    format: "PNG",
    constraint: {
      type: "SCALE",
      value: rasterScale
    }
  });
}

async function exportClippedNode(
  node: SceneNode,
  clipBounds: AbsoluteRect,
  rasterScale: number
): Promise<Uint8Array> {
  const clipFrame = figma.createFrame();
  const clone = cloneSceneNode(node);
  const nodeTransform = node.absoluteTransform;

  try {
    clipFrame.name = `${node.name} clipped export`;
    clipFrame.resizeWithoutConstraints(Math.max(clipBounds.width, 1), Math.max(clipBounds.height, 1));
    clipFrame.x = clipBounds.x;
    clipFrame.y = clipBounds.y;
    clipFrame.fills = [];
    clipFrame.strokes = [];
    clipFrame.clipsContent = true;

    clipFrame.appendChild(clone);
    setAbsoluteTransform(clone, nodeTransform, clipFrame.absoluteTransform);

    return await clipFrame.exportAsync({
      format: "PNG",
      contentsOnly: true,
      useAbsoluteBounds: true,
      constraint: {
        type: "SCALE",
        value: rasterScale
      }
    });
  } finally {
    if (!clone.removed) {
      clone.remove();
    }

    if (!clipFrame.removed) {
      clipFrame.remove();
    }
  }
}

function cloneSceneNode(node: SceneNode): SceneNode {
  return (node as SceneNode & { clone(): SceneNode }).clone();
}

function setAbsoluteTransform(node: SceneNode, absoluteTransform: Transform, parentTransform: Transform) {
  if (!("relativeTransform" in node)) {
    return;
  }

  node.relativeTransform = multiplyTransforms(invertTransform(parentTransform), absoluteTransform);
}

function invertTransform(transform: Transform): Transform {
  const [[a, c, e], [b, d, f]] = transform;
  const determinant = a * d - b * c;

  if (determinant === 0) {
    return [[1, 0, -e], [0, 1, -f]];
  }

  const inverseA = d / determinant;
  const inverseB = -b / determinant;
  const inverseC = -c / determinant;
  const inverseD = a / determinant;

  return [
    [inverseA, inverseC, -(inverseA * e + inverseC * f)],
    [inverseB, inverseD, -(inverseB * e + inverseD * f)]
  ];
}

function multiplyTransforms(first: Transform, second: Transform): Transform {
  const [[a1, c1, e1], [b1, d1, f1]] = first;
  const [[a2, c2, e2], [b2, d2, f2]] = second;

  return [
    [
      a1 * a2 + c1 * b2,
      a1 * c2 + c1 * d2,
      a1 * e2 + c1 * f2 + e1
    ],
    [
      b1 * a2 + d1 * b2,
      b1 * c2 + d1 * d2,
      b1 * e2 + d1 * f2 + f1
    ]
  ];
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
