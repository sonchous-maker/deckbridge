export function hasImageFill(node: GeometryMixin): boolean {
  if (node.fills === figma.mixed) {
    return false;
  }

  return node.fills.some(fill => fill.visible !== false && fill.type === "IMAGE");
}
