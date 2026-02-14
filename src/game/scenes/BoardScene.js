import Phaser from "phaser";
import Board from "../board/Board";
import PieceFactory from "../pieces/PieceFactory";
import PiecePool from "../pieces/PiecePool";
import { findNearestFreeNode } from "../board/FindSnapNode"; // <-- OJO: ajusta el nombre EXACTO del archivo si el tuyo difiere
import { placementState } from "../../state/PlacementState";

export default class BoardScene extends Phaser.Scene {
  constructor() {
    super("BoardScene");
  }

  async create() {
    this.cameras.main.setBackgroundColor("#111");

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

    // 3) Piezas desde JSON
    const piecesCfg = await fetch("/pieces/pieces_default.json").then((r) => r.json());
    const nodeRadius = boardCfg.nodes.radius;

    const factory = new PieceFactory(this, piecesCfg, nodeRadius);

    const all = factory.createAllAt(0, 0);
    const whites = all.filter((p) => p.type === "white");
    const blacks = all.filter((p) => p.type === "black");

    this.poolLeft.addPieces(whites);
    this.poolRight.addPieces(blacks);

    this.poolLeft.layoutGrid({ cols: 3 });
    this.poolRight.layoutGrid({ cols: 3 });

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

      // Si la pieza ya estaba colocada, libera su Hueco previo para evitar "ocupados fantasma"
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

      const target = findNearestFreeNode(
        this.placeNodes,
        gameObject.x,
        gameObject.y,
        nodeRadius * 2.2
      );

      if (!target) {
        this.#returnToPool(piece);
        gameObject.setDepth(10);
        placementState.captureFromPhaser(this);
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

      placementState.captureFromPhaser(this);
    });

    // Restaurar placements previos (persistidos) en 2D
    placementState.applyToPhaser(this);
  }

  #returnToPool(piece) {
    const homePoolId = piece.circle.getData("homePoolId");
    if (homePoolId === "pool_white") this.poolLeft.returnPieceToHome(piece);
    else this.poolRight.returnPieceToHome(piece);
  }
}