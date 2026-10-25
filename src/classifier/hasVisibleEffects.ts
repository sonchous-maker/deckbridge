export function hasVisibleEffects(node: SceneNode): boolean {
  if (!("effects" in node)) {
    return false;
  }

  return node.effects.some(isVisibleEffect);
}

function isVisibleEffect(effect: Effect): boolean {
  if (effect.visible === false) {
    return false;
  }

  switch (effect.type) {
    case "DROP_SHADOW":
    case "INNER_SHADOW":
      return (effect.color.a ?? 1) > 0 &&
        (effect.radius > 0 || effect.offset.x !== 0 || effect.offset.y !== 0 || (effect.spread ?? 0) !== 0);

    case "LAYER_BLUR":
    case "BACKGROUND_BLUR":
      return effect.radius > 0;

    default:
      return true;
  }
}
