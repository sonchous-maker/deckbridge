const POWERPOINT_POLYGON_COUNTS = new Set([3, 4, 5, 6, 7, 8]);
const POWERPOINT_STAR_COUNTS = new Set([4, 5, 6, 7, 8, 10, 12, 16, 24, 32]);

export function canRepresentAsPowerPointShape(node: PolygonNode | StarNode): boolean {
  const pointCount = Number(node.pointCount);

  if (node.type === "POLYGON") {
    return POWERPOINT_POLYGON_COUNTS.has(pointCount);
  }

  return POWERPOINT_STAR_COUNTS.has(pointCount);
}
