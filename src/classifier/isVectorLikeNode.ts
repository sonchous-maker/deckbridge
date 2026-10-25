export function isVectorLikeNode(node: SceneNode): boolean {
  return node.type === "VECTOR" || node.type === "BOOLEAN_OPERATION";
}
