import type { ShapeSlideElement } from "../types/slide";
import { getBaseElement, getFillStyle, getStrokeStyle } from "./common";
import type { ParseContext } from "./common";

export function exportRectangle(node: RectangleNode, context: ParseContext): ShapeSlideElement {
  const base = getBaseElement(node, context);
  const cornerRadius = node.cornerRadius === figma.mixed ? undefined : node.cornerRadius;

  return {
    ...base,
    sourceMode: "PPT_RECTANGLE",
    type: "shape",
    shape: cornerRadius && cornerRadius > 0 ? "roundRect" : "rect",
    style: {
      fill: getFillStyle(node.fills, base.opacity, context.warnings, node.name),
      stroke: getStrokeStyle(node, base.opacity, context.warnings),
      opacity: base.opacity,
      cornerRadius
    }
  };
}
