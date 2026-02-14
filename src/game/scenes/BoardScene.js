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

  async create() {
    this.cameras.main.setBackgroundColor(this.backColor); // azul oscuro elegante

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

    // 5) Drag & snap (ROBUSTO: eventos globales de input)
    this.allPieces = [...whites, ...blacks];

    // Marca cada circle como draggable y enlaza referencia a su "Piece"
    for (const piece of this.allPieces) {
      piece.circle.setData("pieceRef", piece); // para encontrar la instancia en los handlers
      piece.circle.setInteractive();
      this.input.setDraggable(piece.circle);
    }

    // Si quieres que sea más sensible, puedes bajar el threshold:
    // this.input.dragDistanceThreshold = 0;

    this.input.on("dragstart", (pointer, gameObject) => {
      gameObject.setDepth(999);

      // IMPORTANTE: guardar si ya estaba colocada ANTES de limpiar nodeKey
      const wasPlaced = !!gameObject.getData("placed");
      gameObject.setData("wasPlacedAtDragStart", wasPlaced);

      // Si la pieza ya estaba colocada, libera su Hueco previo para evitar "ocupados fantasma"
      if (wasPlaced) {
        const prevKey = gameObject.getData("nodeKey");
        if (typeof prevKey === "string") {
          const prevNode = this.placeNodes.find((n) => {
            if (!n?.getData) return false;
            const k = `${n.getData("cellId")}:${n.getData("type")}:${n.getData("sideIndex")}`;
            return k === prevKey;
          });

          if (prevNode) {
            prevNode.setData("occupied", false);
            prevNode.setData("pieceId", null);
          }
        }

        // Queda "en el aire" durante el drag
        gameObject.setData("placed", false);
        gameObject.setData("nodeKey", null);
      }
    });


this.input.on("drag", (pointer, gameObject, dragX, dragY) => {
      // mueve el objeto que se está arrastrando
      gameObject.setPosition(dragX, dragY);
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

      // Helpers de conteo
      const syncCountsToPools = () => {
        const c = pieceCountState.getCounts();
        this.poolLeft.setRemaining(c.whiteRemaining);
        this.poolRight.setRemaining(c.blackRemaining);
        this.poolLeft.refreshActivePiece();
        this.poolRight.refreshActivePiece();
      };

      if (!target) {
        // Si venía del tablero y lo soltó fuera -> "eliminar" del tablero y regresar al pool (+1)
        if (wasPlacedAtStart) {
          const c = pieceCountState.getCounts();
          if (piece.type === "white") c.whiteRemaining = Math.min(21, c.whiteRemaining + 1);
          else c.blackRemaining = Math.min(21, c.blackRemaining + 1);
          pieceCountState.setCounts(c);
        }

        this.#returnToPool(piece);
        gameObject.setDepth(10);

        // Persistir placements y refrescar pools
        placementState.captureFromPhaser(this);
        syncCountsToPools();
        return;
      }

      // Snap
      gameObject.setPosition(target.x, target.y);
      gameObject.setDepth(10);

      // Ocupa nodo
      target.setData("occupied", true);
      target.setData("pieceId", piece.id);

      // Guarda vínculo
      gameObject.setData("placed", true);
      gameObject.setData(
        "nodeKey",
        `${target.getData("cellId")}:${target.getData("type")}:${target.getData("sideIndex")}`
      );

      // Si NO estaba colocada al iniciar el drag => venía del pool => consumir 1 (si hay)
      if (!wasPlacedAtStart) {
        const c = pieceCountState.getCounts();

        if (piece.type === "white") {
          // Seguridad: si ya está en 0, no debería poder colocarse
          if (c.whiteRemaining <= 0) {
            // Revertir: devolver al pool y salir
            this.#returnToPool(piece);
            gameObject.setDepth(10);
            placementState.captureFromPhaser(this);
            syncCountsToPools();
            return;
          }
          c.whiteRemaining -= 1;
        } else {
          if (c.blackRemaining <= 0) {
            this.#returnToPool(piece);
            gameObject.setDepth(10);
            placementState.captureFromPhaser(this);
            syncCountsToPools();
            return;
          }
          c.blackRemaining -= 1;
        }

        pieceCountState.setCounts(c);
      }

      placementState.captureFromPhaser(this);
      syncCountsToPools();
    });
;

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
  }

  #returnToPool(piece) {
    const homePoolId = piece.circle.getData("homePoolId");
    if (homePoolId === "pool_white") this.poolLeft.returnPieceToHome(piece);
    else this.poolRight.returnPieceToHome(piece);
  }
}