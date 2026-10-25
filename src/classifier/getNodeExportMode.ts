import type { ExportMode } from "../types/exportMode";
import { canRepresentAsPowerPointShape } from "./canRepresentAsPowerPointShape";
import { getNamingRule } from "./getNamingRule";
import { hasImageFill } from "./hasImageFill";
import { hasVisibleEffects } from "./hasVisibleEffects";
import { isVectorLikeNode } from "./isVectorLikeNode";

export function getNodeExportMode(node: SceneNode): ExportMode {
  const rule = getNamingRule(node.name);

  if (rule === "img") return "RASTER_IMAGE";
  if (rule === "svg") return "SVG";

  if (node.type !== "TEXT" && hasVisibleEffects(node)) {
    return "RASTER_IMAGE";
  }

  if (isVectorLikeNode(node)) {
    return "RASTER_IMAGE";
  }

  switch (node.type) {
    case "TEXT":
      return "PPT_TEXT";

    case "RECTANGLE":
      return hasImageFill(node) ? "PPT_IMAGE" : "PPT_RECTANGLE";

    case "ELLIPSE":
      return hasImageFill(node) ? "PPT_IMAGE" : "PPT_ELLIPSE";

    case "LINE":
      return "PPT_LINE";

    case "POLYGON":
      return canRepresentAsPowerPointShape(node) ? "PPT_SHAPE" : "SVG";

    case "STAR":
      return "PPT_SHAPE";

    default:
      return "RASTER_IMAGE";
  }
}
