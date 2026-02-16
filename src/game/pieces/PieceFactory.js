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
        const isBW = type === "bw";
        pieces.push(
          new Piece(this.scene, {
            id: `${type}_${i + 1}`,
            type,
            x,
            y,
            radius,

            // normales
            fillColor: t.fillColor,
            strokeColor: t.strokeColor,

            // bw: usa los colores de los tipos del json (white/black)
            fillColorA: isBW ? this.cfg.types.white?.fillColor : undefined,
            fillColorB: isBW ? this.cfg.types.black?.fillColor : undefined,

            strokeWidth
          })
        );
      }
    }

    return pieces;
  }
}