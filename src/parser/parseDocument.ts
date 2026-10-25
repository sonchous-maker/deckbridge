import { exportContainerBackground } from "../exporters/exportContainerBackground";
import { hasVisibleEffects } from "../classifier/hasVisibleEffects";
import { hasVisibleFill, hasVisibleStroke } from "../exporters/common";
import { parseNode } from "./parseNode";
import type { PresentationModel, SlideElement, SlideModel } from "../types/slide";

export interface ParseDocumentOptions {
  rasterScale: number;
}

export async function parseDocument(
  selection: readonly SceneNode[],
  options: ParseDocumentOptions
): Promise<PresentationModel> {
  const warnings: string[] = [];
  const logs: PresentationModel["logs"] = [];
  const slideNodes = sortSlideNodes(selection.filter(isSlideNode));

  if (slideNodes.length === 0) {
    throw new Error("Select one or more top-level frames/slides before exporting.");
  }

  const firstSlide = slideNodes[0];
  const firstWidth = firstSlide.width;
  const firstHeight = firstSlide.height;
  const slides: SlideModel[] = [];

  for (const slideNode of slideNodes) {
    const box = slideNode.absoluteBoundingBox;

    if (!box) {
      warnings.push(`${slideNode.name}: slide has no absolute bounds and was skipped.`);
      continue;
    }

    if (slideNode.width !== firstWidth || slideNode.height !== firstHeight) {
      warnings.push(`${slideNode.name}: slide size differs from the first selected slide; it will be fit into the deck layout without distortion.`);
    }

    const context = {
      origin: {
        x: box.x,
        y: box.y
      },
      rasterScale: options.rasterScale,
      warnings,
      clipRect: {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height
      }
    };

    const elements: SlideElement[] = [];
    const background = await getSlideBackground(slideNode, context);

    if (background) {
      elements.push(background);
      logs.push({
        nodeId: slideNode.id,
        nodeName: slideNode.name,
        nodeType: slideNode.type,
        mode: "RASTER_IMAGE",
        reason: "slide background fill"
      });
    }

    elements.push(...(await parseNodeChildren(slideNode, context, logs)));

    slides.push({
      id: slideNode.id,
      name: slideNode.name,
      width: slideNode.width,
      height: slideNode.height,
      elements
    });
  }

  if (slides.length === 0) {
    throw new Error("No exportable slides were found in the current selection.");
  }

  return {
    source: "figma",
    createdAt: new Date().toISOString(),
    rasterScale: options.rasterScale,
    slides,
    logs,
    warnings
  };
}

async function parseNodeChildren(
  node: SceneNode,
  context: Parameters<typeof parseNode>[1],
  logs: PresentationModel["logs"]
) {
  if (!("children" in node)) {
    return [];
  }

  const elements = [];

  for (const child of node.children) {
    elements.push(...(await parseNode(child, context, logs)));
  }

  return elements;
}

function isSlideNode(node: SceneNode): node is FrameNode {
  return node.type === "FRAME" || String(node.type) === "SLIDE";
}

function sortSlideNodes(nodes: readonly FrameNode[]): FrameNode[] {
  const indexedNodes = nodes.map((node, index) => ({
    node,
    index,
    slideNumber: getSlideNumber(node.name)
  }));

  if (indexedNodes.every(item => item.slideNumber === undefined)) {
    return [...nodes];
  }

  return indexedNodes
    .sort((a, b) => {
      if (a.slideNumber !== undefined && b.slideNumber !== undefined) {
        return a.slideNumber - b.slideNumber || a.index - b.index;
      }

      if (a.slideNumber !== undefined) return -1;
      if (b.slideNumber !== undefined) return 1;

      return a.index - b.index;
    })
    .map(item => item.node);
}

function getSlideNumber(name: string): number | undefined {
  const trimmedName = name.trim();
  const leadingNumber = trimmedName.match(/^(\d+)(?=$|[\s._\-):/])/);

  if (leadingNumber) {
    return Number(leadingNumber[1]);
  }

  const labeledNumber = trimmedName.match(/(?:^|[\s._\-:/([{])(?:slide|слайд|page|стр(?:аница)?\.?)\s*#?\s*(\d+)/i);

  if (labeledNumber) {
    return Number(labeledNumber[1]);
  }

  const trailingNumber = trimmedName.match(/(?:^|[\s._\-:/([{])(\d+)\s*$/);

  if (trailingNumber) {
    return Number(trailingNumber[1]);
  }

  return undefined;
}

async function getSlideBackground(
  node: SceneNode & ChildrenMixin,
  context: Parameters<typeof parseNode>[1]
) {
  const hasSlideVisualLayer = ("fills" in node && hasVisibleFill(node.fills)) ||
    hasVisibleStroke(node) ||
    hasVisibleEffects(node);

  if (!hasSlideVisualLayer) {
    return undefined;
  }

  return exportContainerBackground(node, context);
}
