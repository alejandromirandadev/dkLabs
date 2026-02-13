import Piece from "./Piece";

export default class PieceFactory {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} piecesConfig - JSON ya parseado
   * @param {number} nodeRadius - radio del nodo (del tablero)
   */
  constructor(scene, piecesConfig, nodeRadius) {
    this.scene = scene;
    this.cfg = piecesConfig;
    this.nodeRadius = nodeRadius;
  }

  createAllAt(x, y) {
    const pieces = [];

    const scale = this.cfg.scale.radiusRelativeToNode ?? 1.2;
    const radius = this.nodeRadius * scale;
    const strokeWidth = this.cfg.styles.strokeWidth ?? 2;

    for (const type of Object.keys(this.cfg.types)) {
      const t = this.cfg.types[type];
      for (let i = 0; i < t.count; i++) {
        pieces.push(
          new Piece(this.scene, {
            id: `${type}_${i + 1}`,
            type,
            x,
            y,
            radius,
            fillColor: t.fillColor,
            strokeColor: t.strokeColor,
            strokeWidth
          })
        );
      }
    }

    return pieces;
  }
}