import Phaser from "phaser";
import Board from "../board/Board";
import PieceFactory from "../pieces/PieceFactory";
import { findNearestFreeNode } from "../board/FindSnapNode";
import { placementState } from "../../state/PlacementState";
import { emitMovePiece } from "../../net/socketClient";

export default class BoardScene extends Phaser.Scene {

  constructor() {
    super("BoardScene");
    this.backColor = "#0b1020"; //Aquí cambia color del fondo 2d
  }

  preload() {
    this.load.image("boardBg1", "assets/images/background1.png");
  }

  async create() {
    this.cameras.main.setBackgroundColor(this.backColor);

    // Fondo fijo (no se mueve con la cámara)
    this.boardBg1 = this.add.image(0, 0, "boardBg1")
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(-9999);

    // Ajustar para cubrir el canvas
    this.boardBg1.displayWidth = this.scale.width;
    this.boardBg1.displayHeight = this.scale.height;

    // 1) Board
    const boardCfg = await fetch("/boards/board_default.json").then((r) => r.json());
    this.board = new Board(this, boardCfg);
    // 2) Pools (izq/der) — DESACTIVADOS (ya no se usan reservas laterales)
    // Creamos "null pools" para no romper referencias existentes en el resto del flujo.
    const makeNullPool = (id) => ({
      id,
      setRemaining: () => {},
      addPieces: () => {},
      layoutStack: () => {},
      refreshActivePiece: () => {},
      returnPieceToHome: (piece) => {
        const hx = piece?.circle?.getData?.("homeX");
        const hy = piece?.circle?.getData?.("homeY");
        if (typeof hx === "number" && typeof hy === "number") {
          piece.circle.setPosition(hx, hy);
          if (piece.hit) piece.hit.setPosition(hx, hy);
        }
      },
    });

    this.poolLeft = makeNullPool("pool_white");
    this.poolRight = makeNullPool("pool_black");

    // 3) Piezas desde JSON

    const piecesCfg = await fetch("/pieces/pieces_default.json").then((r) => r.json());
    const nodeRadius = boardCfg.nodes.radius;

    const factory = new PieceFactory(this, piecesCfg, nodeRadius);

    const all = factory.createAllAt(0, 0);
    const whites = all.filter((p) => p.type === "white");
    const blacks = all.filter((p) => p.type === "black");
    const bw = all.find((p) => p.type === "bw") ?? null;

    this.poolLeft.addPieces(whites);
    this.poolRight.addPieces(blacks);

    // Modo pool tipo “stamp”: todas las piezas apiladas y solo 1 visible/arrastrable
    this.poolLeft.layoutStack();
    this.poolRight.layoutStack();

    // Activa 1 pieza disponible por pool según el contador
    this.poolLeft.refreshActivePiece();
    this.poolRight.refreshActivePiece();

    // 4) Lista de nodos donde se pueden poner piezas
    this.placeNodes = this.board.getAllNodes();

    // Colocar la pieza "bw" SIEMPRE iniciando en el Hueco central del Hex central (0,0)
    if (bw) {
      const centerNode = this.placeNodes.find((n) => {
        return (
          n.getData("cellId") === "0,0" &&
          n.getData("type") === "center" &&
          n.getData("sideIndex") === null
        );
      });

      if (centerNode && !centerNode.getData("occupied")) {
        // Visual + hit deben moverse juntos
        bw.circle.setPosition(centerNode.x, centerNode.y);
        if (bw.hit) bw.hit.setPosition(centerNode.x, centerNode.y);

        bw.circle.setDepth(10);

        centerNode.setData("occupied", true);
        centerNode.setData("pieceId", bw.id);

        // Data en hit (y duplicada en circle para compat)
        bw.circle.setData("placed", true);
        bw.circle.setData("nodeKey", "0,0:center:null");
        if (bw.hit) {
          bw.hit.setData("placed", true);
          bw.hit.setData("nodeKey", "0,0:center:null");
        }
      }
    }

    // 5) Drag & snap
    this.allPieces = bw ? [...whites, ...blacks, bw] : [...whites, ...blacks];

    // draggable en zona invisible (hit). Si no existe hit, fallback a circle.
    // bw (neutral) NO se mueve por red (fixture): lo dejamos fijo.
    for (const piece of this.allPieces) {
      if (piece.type === "bw") continue;

      const dragObj = piece.hit || piece.circle;
      dragObj.setData("pieceRef", piece);
      dragObj.setInteractive();
      this.input.setDraggable(dragObj);
    }

    // (Opcional) hacerlo más sensible:
    // this.input.dragDistanceThreshold = 0;

    // ---- Handlers ----
    this.input.on("dragstart", async (pointer, gameObject) => {
      const piece = gameObject.getData("pieceRef");
      if (!piece) return;

      // UX block: spectator o no es tu turno => no iniciar drag
      const { getNetState } = await import("../../net/socketClient");
      const ns = getNetState();

      if (!ns.connected) return;
      if (ns.role !== "white" && ns.role !== "black") return;
      if (ns.turn !== ns.role) return;

      // Evitar doble drag mientras esperamos ack
      if (gameObject.getData("pendingMove")) return;

      // Subir el visual
      piece.circle.setDepth(999);

      // Guardar estado inicial para revert (confirmación-only)
      gameObject.setData("dragStartX", gameObject.x);
      gameObject.setData("dragStartY", gameObject.y);

      const wasPlaced = !!gameObject.getData("placed");
      gameObject.setData("wasPlacedAtDragStart", wasPlaced);

      const startKey = gameObject.getData("nodeKey") ?? null;
      gameObject.setData("nodeKeyAtDragStart", startKey);
    });

    this.input.on("drag", (pointer, gameObject, dragX, dragY) => {
      const piece = gameObject.getData("pieceRef");
      if (!piece) return;

      // Mover el draggable
      gameObject.setPosition(dragX, dragY);

      // Mover el visual
      piece.circle.setPosition(dragX, dragY);
    });

    this.input.on("dragend", async (pointer, gameObject) => {
      const piece = gameObject.getData("pieceRef");
      if (!piece) return;

      if (gameObject.getData("pendingMove")) return;

      const startX = gameObject.getData("dragStartX");
      const startY = gameObject.getData("dragStartY");
      const wasPlacedAtStart = !!gameObject.getData("wasPlacedAtDragStart");
      const startKey = gameObject.getData("nodeKeyAtDragStart"); // puede ser null

      const target = findNearestFreeNode(
        this.placeNodes,
        gameObject.x,
        gameObject.y,
        nodeRadius * 2.2
      );

      // Si no hay target: revert visual (no hay cambios de estado)
      if (!target) {
        if (typeof startX === "number" && typeof startY === "number") {
          gameObject.setPosition(startX, startY);
          piece.circle.setPosition(startX, startY);
        }
        piece.circle.setDepth(10);
        return;
      }

      const targetKey = `${target.getData("cellId")}:${target.getData("type")}:${target.getData("sideIndex")}`;

      // Si soltó en el mismo slot donde ya estaba: no-op -> revert
      if (wasPlacedAtStart && typeof startKey === "string" && startKey === targetKey) {
        if (typeof startX === "number" && typeof startY === "number") {
          gameObject.setPosition(startX, startY);
          piece.circle.setPosition(startX, startY);
        }
        piece.circle.setDepth(10);
        return;
      }

      // Visual snap "pending" (pero NO mutamos occupied/nodeKey aún)
      gameObject.setPosition(target.x, target.y);
      piece.circle.setPosition(target.x, target.y);
      piece.circle.setDepth(10);

      gameObject.setData("pendingMove", true);

      const move = {
        action: wasPlacedAtStart ? "relocate" : "place",
        pieceId: piece.id,
        to: {
          cellId: target.getData("cellId"),
          holeType: target.getData("type"),
          sideIndex: target.getData("sideIndex") // int o null
        }
      };

      const ack = await emitMovePiece(move);

      // Confirmación-only: si server rechaza, revert visual al start
      if (!ack?.ok) {
        if (typeof startX === "number" && typeof startY === "number") {
          gameObject.setPosition(startX, startY);
          piece.circle.setPosition(startX, startY);
        }
      }

      gameObject.setData("pendingMove", false);
    });

    // En multijugador, el estado lo manda el server.
    // (Si aún no conectó, esto solo deja el tablero limpio; luego Step 9 aplicará snapshot/moves.)
    placementState.applyToPhaser(this);

    // Reajustar fondo si cambia el tamaño del canvas
    this.scale.on("resize", (gameSize) => {
      const { width, height } = gameSize;
      this.boardBg1.displayWidth = width;
      this.boardBg1.displayHeight = height;
    });
  }

  #returnToPool(piece) {
    const homePoolId = piece.circle.getData("homePoolId");
    if (homePoolId === "pool_white") this.poolLeft.returnPieceToHome(piece);
    else this.poolRight.returnPieceToHome(piece);

    // El drag corre sobre `hit`, así que también debe regresar a home
    if (piece.hit) piece.hit.setPosition(piece.circle.x, piece.circle.y);
  }
}
