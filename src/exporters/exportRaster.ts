import type { ImageSlideElement } from "../types/slide";
import type { ParseContext } from "./common";
import { exportNodeAsRaster } from "./raster";

export async function exportRaster(node: SceneNode, context: ParseContext): Promise<ImageSlideElement | undefined> {
  return exportNodeAsRaster(node, context, "RASTER_IMAGE");
}
