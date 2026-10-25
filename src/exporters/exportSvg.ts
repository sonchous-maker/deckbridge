import type { SvgSlideElement } from "../types/slide";
import { getBaseElement } from "./common";
import type { ParseContext } from "./common";

export async function exportSvg(node: SceneNode, context: ParseContext): Promise<SvgSlideElement> {
  const bytes = await node.exportAsync({
    format: "SVG"
  });
  const svg = new TextDecoder().decode(bytes);

  if (!svg.trim()) {
    throw new Error(`${node.name}: Figma returned an empty SVG.`);
  }

  return {
    ...getBaseElement(node, context),
    sourceMode: "SVG",
    type: "svg",
    svg
  };
}
