import type { ImageSlideElement } from "../types/slide";
import type { ParseContext } from "./common";
import { exportNodeAsRaster } from "./raster";

export async function exportImage(node: SceneNode, context: ParseContext): Promise<ImageSlideElement | undefined> {
  return exportNodeAsRaster(node, context, "PPT_IMAGE");
}
