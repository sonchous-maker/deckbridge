import type { LineSlideElement } from "../types/slide";
import { getBaseElement, getStrokeStyle } from "./common";
import type { ParseContext } from "./common";

export function exportLine(node: LineNode, context: ParseContext): LineSlideElement {
  const base = getBaseElement(node, context);

  return {
    ...base,
    sourceMode: "PPT_LINE",
    type: "line",
    style: {
      stroke: getStrokeStyle(node, base.opacity, context.warnings)
    }
  };
}
