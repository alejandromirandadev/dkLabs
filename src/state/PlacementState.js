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
    for (const piece of boardScene.allPieces) {
      if (!piece?.circle) continue;

      // Base state SIN pool: siempre regresa a homeX/homeY, desmarca placement.
      const hx = piece.circle.getData?.("homeX");
      const hy = piece.circle.getData?.("homeY");
      if (typeof hx === "number" && typeof hy === "number") {
        piece.circle.setPosition(hx, hy);
        if (piece.hit) piece.hit.setPosition(hx, hy);
      }

      piece.circle.setData?.("placed", false);
      piece.circle.setData?.("nodeKey", null);
      if (piece.hit) {
        piece.hit.setData?.("placed", false);
        piece.hit.setData?.("nodeKey", null);
      }

      // Las piezas NO colocadas ya no viven en "pool": se ocultan y no son interactuables.
      // Excepción: bw siempre debe existir/verse (inicia en centro en la lógica del juego).
      const isBW = piece.type === "bw" || piece.id === "bw_1";
      if (!isBW) {
        piece.circle.setVisible?.(false);
        if (piece.hit) piece.hit.setVisible?.(false);
        const dragObj = piece.hit || piece.circle;
        dragObj.disableInteractive?.();
      } else {
        piece.circle.setVisible?.(true);
        if (piece.hit) piece.hit.setVisible?.(true);
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

      // Visual + hit deben moverse juntos
      piece.circle.setPosition(node.x, node.y);
      if (piece.hit) piece.hit.setPosition(node.x, node.y);

      // Deben quedar visibles y arrastrables aunque el pool use modo "stamp"
      piece.circle.setVisible?.(true);
      if (piece.hit) piece.hit.setVisible?.(true);

      // Reactivar input del draggable (hit) por si el pool lo desactivó
      const dragObj = piece.hit || piece.circle;
      dragObj.setInteractive?.();
      if (boardScene?.input?.setDraggable) boardScene.input.setDraggable(dragObj, true);

      piece.circle.setDepth(10);

      node.setData("occupied", true);
      node.setData("pieceId", piece.id);

      // Data en ambos (hit es el draggable); circle para compat
      piece.circle.setData("placed", true);
      piece.circle.setData("nodeKey", nodeKey);
      if (piece.hit) {
        piece.hit.setData("placed", true);
        piece.hit.setData("nodeKey", nodeKey);
      }
    }
  }
}

// Singleton
// Singleton
export const placementState = new PlacementState();

/**
 * Genera los placements del estado inicial del juego según DragonDragon notas:
 * - bw_1 en el centro del Hex central (0,0)
 * - 6 Hex iniciales (esquinas del radio 3) completamente llenos (7 huecos) alternando color
 *   en sentido horario, iniciando en (0,3) con blancas.
 *
 * Nota: aquí solo se genera la lista lógica de placements.
 * La aplicación visual (2D/3D) se hace en pasos posteriores.
 */
export function buildInitialSetupPlacements() {
  /**
   * Orden horario estándar de las 6 esquinas para radio 3, iniciando en (0,3).
   * (coordenadas axiales q,r => cellId = "q,r")
   */
  const cornerCellIds = ["0,3", "3,0", "3,-3", "0,-3", "-3,0", "-3,3"];

  /** @type {ReturnType<import('./PlacementState').placementState.getPlacements>} */
  const out = [];

  // 1) Corazón de Dragón (bw) en el centro del hex central
  out.push({
    pieceId: "bw_1",
    pieceType: "bw",
    cellId: "0,0",
    holeType: "center",
    sideIndex: null
  });

  // 2) Esquinas llenas: 3 blancas, 3 negras, alternando horario desde (0,3)
  let w = 1;
  let b = 1;

  for (let i = 0; i < cornerCellIds.length; i++) {
    const cellId = cornerCellIds[i];
    const isWhite = i % 2 === 0; // inicia blancas

    // Orden determinista de llenado de huecos: centro, luego sides 0..5
    const holes = [
      { holeType: "center", sideIndex: null },
      ...Array.from({ length: 6 }, (_, sideIndex) => ({ holeType: "side", sideIndex }))
    ];

    for (const h of holes) {
      if (isWhite) {
        out.push({
          pieceId: `white_${w++}`,
          pieceType: "white",
          homePoolId: "pool_white",
          cellId,
          holeType: h.holeType,
          sideIndex: h.sideIndex
        });
      } else {
        out.push({
          pieceId: `black_${b++}`,
          pieceType: "black",
          homePoolId: "pool_black",
          cellId,
          holeType: h.holeType,
          sideIndex: h.sideIndex
        });
      }
    }
  }

  return out;
}