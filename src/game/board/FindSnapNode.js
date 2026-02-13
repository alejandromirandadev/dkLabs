export function findNearestFreeNode(nodes, x, y, snapRadiusPx) {
  let best = null;
  let bestD2 = snapRadiusPx * snapRadiusPx;

  for (const n of nodes) {
    if (n.getData("occupied")) continue;

    const dx = n.x - x;
    const dy = n.y - y;
    const d2 = dx * dx + dy * dy;

    if (d2 <= bestD2) {
      bestD2 = d2;
      best = n;
    }
  }
  return best;
}