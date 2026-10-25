import { getNamingRule } from "../classifier/getNamingRule";
import { isVectorLikeNode } from "../classifier/isVectorLikeNode";
import type { ImageSlideElement } from "../types/slide";
import { getBaseElementForBounds, getGeometryBounds } from "./common";
import type { ParseContext } from "./common";

export interface ExportContainerBackgroundOptions {
  includeNonTextChildren?: boolean;
  excludeImgDescendants?: boolean;
  excludeVectorDescendants?: boolean;
}

export async function exportContainerBackground(
  node: SceneNode & ChildrenMixin,
  context: ParseContext,
  options: ExportContainerBackgroundOptions = {}
): Promise<ImageSlideElement | undefined> {
  const fallbackBounds = getGeometryBounds(node);

  if (!fallbackBounds) {
    context.warnings.push(`${node.name}: frame background has no export bounds and was skipped.`);
    return undefined;
  }

  const clone = cloneSceneNode(node);

  try {
    clone.name = `${node.name} background export`;
    figma.currentPage.appendChild(clone);
    setAbsoluteTransform(clone, node.absoluteTransform);
    if (options.includeNonTextChildren) {
      makeTextImgAndVectorDescendantsTransparent(
        clone,
        options.excludeImgDescendants ?? false,
        options.excludeVectorDescendants ?? false
      );
    } else {
      makeChildrenTransparent(clone);
    }

    let bytes: Uint8Array;

    try {
      bytes = await clone.exportAsync({
        format: "PNG",
        contentsOnly: true,
        useAbsoluteBounds: true,
        constraint: {
          type: "SCALE",
          value: context.rasterScale
        }
      });
    } catch (error) {
      context.warnings.push(`${node.name}: frame PNG background was skipped because Figma could not export it. ${getErrorMessage(error)}`);
      return undefined;
    }

    return {
      ...getBaseElementForBounds(node, context, fallbackBounds, 0),
      id: `${node.id}:background`,
      name: `${node.name} background`,
      sourceMode: "RASTER_IMAGE",
      type: "image",
      data: {
        mimeType: "image/png",
        bytes
      }
    };
  } finally {
    if (!clone.removed) {
      clone.remove();
    }
  }
}

function cloneSceneNode(node: SceneNode): SceneNode & ChildrenMixin {
  return (node as SceneNode & ChildrenMixin & { clone(): unknown }).clone() as SceneNode & ChildrenMixin;
}

function setAbsoluteTransform(node: SceneNode, absoluteTransform: Transform) {
  if ("relativeTransform" in node) {
    node.relativeTransform = absoluteTransform;
  }
}

function makeTextImgAndVectorDescendantsTransparent(
  node: SceneNode & ChildrenMixin,
  excludeImgDescendants: boolean,
  excludeVectorDescendants: boolean
) {
  for (const child of node.children) {
    if (
      child.type === "TEXT" ||
      (excludeImgDescendants && getNamingRule(child.name) === "img") ||
      (excludeVectorDescendants && isVectorLikeNode(child))
    ) {
      makeNodeTransparent(child);
      continue;
    }

    if ("children" in child) {
      makeTextImgAndVectorDescendantsTransparent(child, excludeImgDescendants, excludeVectorDescendants);
    }
  }
}

function makeChildrenTransparent(node: SceneNode & ChildrenMixin) {
  for (const child of node.children) {
    makeNodeTransparent(child);
  }
}

function makeNodeTransparent(node: SceneNode) {
  if ("opacity" in node) {
    node.opacity = 0;
    return;
  }

  node.visible = false;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
