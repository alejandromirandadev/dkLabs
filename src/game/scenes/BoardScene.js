import Phaser from "phaser";
import Board from "../board/Board";
import PieceFactory from "../pieces/PieceFactory";
import PiecePool from "../pieces/PiecePool";
import { findNearestFreeNode } from "../board/FindSnapNode"; // <-- OJO: ajusta el nombre EXACTO del archivo si el tuyo difiere
import { placementState } from "../../state/PlacementState";
import { pieceCountState } from "../../state/PieceCountState";

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

    // 2) Pools (izq/der)
    const margin = 16;
    const poolW = 200;
    const poolH = this.scale.height - margin * 2;

    this.poolLeft = new PiecePool(this, {
      id: "pool_white",
      type: "white",
      x: margin,
      y: margin,
      width: poolW,
      height: poolH,
    });

    this.poolRight = new PiecePool(this, {
      id: "pool_black",
      type: "black",
      x: this.scale.width - poolW - margin,
      y: margin,
      width: poolW,
      height: poolH,
    });

    // 2.5) Contadores (desde estado persistido)
    const counts = pieceCountState.getCounts();
    this.poolLeft.setRemaining(counts.whiteRemaining);
    this.poolRight.setRemaining(counts.blackRemaining);

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
    for (const piece of this.allPieces) {
      const dragObj = piece.hit || piece.circle;
      dragObj.setData("pieceRef", piece);
      dragObj.setInteractive();
      this.input.setDraggable(dragObj);
    }

    // (Opcional) hacerlo más sensible:
    // this.input.dragDistanceThreshold = 0;

    // ---- Handlers ----
    this.input.on("dragstart", (pointer, gameObject) => {
      const piece = gameObject.getData("pieceRef");
      if (!piece) return;

      // Subir el visual
      piece.circle.setDepth(999);

      // Guardar si ya estaba colocada ANTES de limpiar nodeKey
      const wasPlaced = !!gameObject.getData("placed");
      gameObject.setData("wasPlacedAtDragStart", wasPlaced);

      if (wasPlaced) {
        const prevKey = gameObject.getData("nodeKey");

        // Guardar para revert (caso bw)
        gameObject.setData("nodeKeyAtDragStart", prevKey);

        // liberar nodo previo
        if (typeof prevKey === "string") {
          const prevNode = this.placeNodes.find((n) => {
            const k = `${n.getData("cellId")}:${n.getData("type")}:${n.getData("sideIndex")}`;
            return k === prevKey;
          });
          if (prevNode) {
            prevNode.setData("occupied", false);
            prevNode.setData("pieceId", null);
          }
        }

        // queda en el aire (hit + circle)
        gameObject.setData("placed", false);
        gameObject.setData("nodeKey", null);
        piece.circle.setData("placed", false);
        piece.circle.setData("nodeKey", null);
      }
    });

    this.input.on("drag", (pointer, gameObject, dragX, dragY) => {
      const piece = gameObject.getData("pieceRef");
      if (!piece) return;

      // Mover el draggable
      gameObject.setPosition(dragX, dragY);

      // Mover el visual
      piece.circle.setPosition(dragX, dragY);
    });

    this.input.on("dragend", (pointer, gameObject) => {
      const piece = gameObject.getData("pieceRef");
      if (!piece) return;

      const wasPlacedAtStart = !!gameObject.getData("wasPlacedAtDragStart");

      const target = findNearestFreeNode(
        this.placeNodes,
        gameObject.x,
        gameObject.y,
        nodeRadius * 2.2
      );

      const syncCountsToPools = () => {
        const c = pieceCountState.getCounts();
        this.poolLeft.setRemaining(c.whiteRemaining);
        this.poolRight.setRemaining(c.blackRemaining);
        this.poolLeft.refreshActivePiece();
        this.poolRight.refreshActivePiece();
      };

      // Soltó fuera del tablero
      if (!target) {
        // bw: no eliminable, regresa a hueco previo o centro
        if (piece.type === "bw") {
          const prevKey = gameObject.getData("nodeKeyAtDragStart");

          const prevNode =
            typeof prevKey === "string"
              ? this.placeNodes.find((n) => {
                  const k = `${n.getData("cellId")}:${n.getData("type")}:${n.getData("sideIndex")}`;
                  return k === prevKey;
                })
              : null;

          const fallbackCenter = this.placeNodes.find((n) => {
            return (
              n.getData("cellId") === "0,0" &&
              n.getData("type") === "center" &&
              n.getData("sideIndex") === null
            );
          });

          const nodeToRestore = prevNode ?? fallbackCenter;

          if (nodeToRestore) {
            gameObject.setPosition(nodeToRestore.x, nodeToRestore.y);
            piece.circle.setPosition(nodeToRestore.x, nodeToRestore.y);
            piece.circle.setDepth(10);

            nodeToRestore.setData("occupied", true);
            nodeToRestore.setData("pieceId", piece.id);

            const nk = `${nodeToRestore.getData("cellId")}:${nodeToRestore.getData("type")}:${nodeToRestore.getData(
              "sideIndex"
            )}`;

            gameObject.setData("placed", true);
            gameObject.setData("nodeKey", nk);
            piece.circle.setData("placed", true);
            piece.circle.setData("nodeKey", nk);
          } else {
            piece.circle.setDepth(10);
          }

          placementState.captureFromPhaser(this);
          syncCountsToPools();
          return;
        }

        // white/black: si venía del tablero, devolver 1 al contador
        if (wasPlacedAtStart) {
          const c = pieceCountState.getCounts();
          if (piece.type === "white") c.whiteRemaining = Math.min(21, c.whiteRemaining + 1);
          else if (piece.type === "black") c.blackRemaining = Math.min(21, c.blackRemaining + 1);
          pieceCountState.setCounts(c);
        }

        this.#returnToPool(piece);
        piece.circle.setDepth(10);

        placementState.captureFromPhaser(this);
        syncCountsToPools();
        return;
      }

      // Snap a un hueco válido
      gameObject.setPosition(target.x, target.y);
      piece.circle.setPosition(target.x, target.y);
      piece.circle.setDepth(10);

      target.setData("occupied", true);
      target.setData("pieceId", piece.id);

      const nk = `${target.getData("cellId")}:${target.getData("type")}:${target.getData("sideIndex")}`;

      gameObject.setData("placed", true);
      gameObject.setData("nodeKey", nk);
      piece.circle.setData("placed", true);
      piece.circle.setData("nodeKey", nk);

      // si venía del pool => consumir 1 (excepto bw)
      if (!wasPlacedAtStart) {
        const c = pieceCountState.getCounts();
        if (piece.type === "white") c.whiteRemaining = Math.max(0, c.whiteRemaining - 1);
        else if (piece.type === "black") c.blackRemaining = Math.max(0, c.blackRemaining - 1);
        pieceCountState.setCounts(c);
      }

      placementState.captureFromPhaser(this);
      syncCountsToPools();
    });

    // Restaurar placements previos (persistidos) en 2D
    placementState.applyToPhaser(this);

    // Tras restaurar placements, asegurar que el pool solo muestre 1 pieza (stamp)
    // y que respete el contador (0 => no arrastrable desde pool)
    {
      const c = pieceCountState.getCounts();
      this.poolLeft.setRemaining(c.whiteRemaining);
      this.poolRight.setRemaining(c.blackRemaining);
      this.poolLeft.refreshActivePiece();
      this.poolRight.refreshActivePiece();
    }

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
