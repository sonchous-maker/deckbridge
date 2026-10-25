import type { ShapeSlideElement } from "../types/slide";
import { getBaseElement, getFillStyle, getStrokeStyle } from "./common";
import type { ParseContext } from "./common";

export function exportEllipse(node: EllipseNode, context: ParseContext): ShapeSlideElement {
  const base = getBaseElement(node, context);

  return {
    ...base,
    sourceMode: "PPT_ELLIPSE",
    type: "shape",
    shape: "ellipse",
    style: {
      fill: getFillStyle(node.fills, base.opacity, context.warnings, node.name),
      stroke: getStrokeStyle(node, base.opacity, context.warnings),
      opacity: base.opacity
    }
  };
}
