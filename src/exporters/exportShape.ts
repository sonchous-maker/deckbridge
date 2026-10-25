import type { ShapeSlideElement } from "../types/slide";
import { getBaseElement, getFillStyle, getStrokeStyle } from "./common";
import type { ParseContext } from "./common";

export function exportShape(node: PolygonNode | StarNode, context: ParseContext): ShapeSlideElement {
  const base = getBaseElement(node, context);

  return {
    ...base,
    sourceMode: "PPT_SHAPE",
    type: "shape",
    shape: getPowerPointShape(node),
    style: {
      fill: getFillStyle(node.fills, base.opacity, context.warnings, node.name),
      stroke: getStrokeStyle(node, base.opacity, context.warnings),
      opacity: base.opacity
    }
  };
}

function getPowerPointShape(node: PolygonNode | StarNode): ShapeSlideElement["shape"] {
  if (node.type === "POLYGON") {
    switch (node.pointCount) {
      case 3:
        return "triangle";
      case 4:
        return "diamond";
      case 5:
        return "pentagon";
      case 6:
        return "hexagon";
      case 7:
        return "heptagon";
      case 8:
        return "octagon";
      default:
        return "triangle";
    }
  }

  switch (node.pointCount) {
    case 4:
      return "star4";
    case 5:
      return "star5";
    case 6:
      return "star6";
    case 7:
      return "star7";
    case 8:
      return "star8";
    case 10:
      return "star10";
    case 12:
      return "star12";
    case 16:
      return "star16";
    case 24:
      return "star24";
    case 32:
      return "star32";
    default:
      return "star5";
  }
}
