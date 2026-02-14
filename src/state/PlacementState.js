/**
 * PlacementState
 *
 * Estado compartido (en memoria + localStorage) para placements de piezas en Huecos.
 *
 * Un placement representa: "la pieza X está en el Hueco (cellId, holeType, sideIndex)".
 * - holeType: "center" | "side"
 * - sideIndex: null | 0..5
 */

const STORAGE_KEY = "dkLabs:placements:v1";

class PlacementState {
  constructor() {
    /**
     * @type {Array<{
     *  pieceId: string,
     *  pieceType: 'white'|'black',
     *  homePoolId?: string,
     *  cellId: string,
     *  holeType: 'center'|'side',
     *  sideIndex: (number|null)
     * }>}
     */
    this.placements = [];
  }

  loadFromStorage() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) this.placements = parsed;
    } catch {
      // ignore
    }
  }

  saveToStorage() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.placements));
    } catch {
      // ignore
    }
  }

  clear() {
    this.placements = [];
    this.saveToStorage();
  }

  /**
   * @param {Array<any>} placements
   */
  setPlacements(placements) {
    this.placements = Array.isArray(placements) ? placements : [];
    this.saveToStorage();
  }

  getPlacements() {
    return this.placements.slice();
  }

  /**
   * Captura placements desde la escena Phaser (2D).
   * @param {import('phaser').Scene} boardScene
   */
  captureFromPhaser(boardScene) {
    if (!boardScene || !boardScene.allPieces || !boardScene.placeNodes) return;

    /** @type {ReturnType<PlacementState['getPlacements']>} */
    const out = [];

    for (const piece of boardScene.allPieces) {
      const g = piece?.circle;
      if (!g) continue;

      const placed = !!g.getData("placed");
      if (!placed) continue;

      const nodeKey = g.getData("nodeKey");
      if (typeof nodeKey !== "string") continue;

      const [cellId, holeType, sideIndexRaw] = nodeKey.split(":");
      const sideIndex = holeType === "side" ? Number(sideIndexRaw) : null;

      out.push({
        pieceId: piece.id,
        pieceType: piece.type,
        homePoolId: g.getData("homePoolId") || undefined,
        cellId,
        holeType,
        sideIndex
      });
    }

    this.setPlacements(out);
  }

  /**
   * Aplica placements a la escena Phaser (2D):
   * - marca nodos ocupados
   * - posiciona piezas sobre su nodo
   *
   * @param {import('phaser').Scene} boardScene
   */
  applyToPhaser(boardScene) {
    if (!boardScene || !boardScene.allPieces || !boardScene.placeNodes) return;

    // 0) Regresar TODAS las piezas a su home pool (estado base)
    // Esto hace que: "Limpiar tablero" funcione visualmente y que la sincronía 3D→2D
    // no deje piezas en posiciones viejas.
    const poolLeft = boardScene.poolLeft;
    const poolRight = boardScene.poolRight;

    for (const piece of boardScene.allPieces) {
      if (!piece?.circle) continue;

      const homePoolId = piece.circle.getData?.("homePoolId");

      if (homePoolId === "pool_white" && poolLeft?.returnPieceToHome) {
        poolLeft.returnPieceToHome(piece);
      } else if (homePoolId === "pool_black" && poolRight?.returnPieceToHome) {
        poolRight.returnPieceToHome(piece);
      } else {
        // Fallback seguro
        const hx = piece.circle.getData?.("homeX");
        const hy = piece.circle.getData?.("homeY");
        if (typeof hx === "number" && typeof hy === "number") {
          piece.circle.setPosition(hx, hy);
        }
        piece.circle.setData?.("placed", false);
        piece.circle.setData?.("nodeKey", null);
      }

      piece.circle.setDepth?.(10);
    }

    // 1) limpiar nodos
    for (const node of boardScene.placeNodes) {
      node?.setData?.("occupied", false);
      node?.setData?.("pieceId", null);
    }

    // 2) índice rápido de nodos
    const nodeByKey = new Map();
    for (const n of boardScene.placeNodes) {
      if (!n?.getData) continue;
      const key = `${n.getData("cellId")}:${n.getData("type")}:${n.getData("sideIndex")}`;
      nodeByKey.set(key, n);
    }

    // 3) índice rápido de piezas
    const pieceById = new Map();
    for (const p of boardScene.allPieces) pieceById.set(p.id, p);

    for (const pl of this.placements) {
      const piece = pieceById.get(pl.pieceId);
      if (!piece?.circle) continue;

      const nodeKey = `${pl.cellId}:${pl.holeType}:${pl.sideIndex}`;
      const node = nodeByKey.get(nodeKey);
      if (!node) continue;

      piece.circle.setPosition(node.x, node.y);
      piece.circle.setDepth(10);

      node.setData("occupied", true);
      node.setData("pieceId", piece.id);

      piece.circle.setData("placed", true);
      piece.circle.setData("nodeKey", nodeKey);
    }
  }
}

// Singleton
export const placementState = new PlacementState();
