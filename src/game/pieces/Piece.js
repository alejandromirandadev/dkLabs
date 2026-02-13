import Phaser from "phaser";

function hexTo0x(hex) {
  // "#ffcc00" -> 0xffcc00
  return Number("0x" + hex.replace("#", ""));
}

export default class Piece {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} opts
   * @param {string} opts.id
   * @param {"white"|"black"} opts.type
   * @param {number} opts.x
   * @param {number} opts.y
   * @param {number} opts.radius
   * @param {string} opts.fillColor - "#rrggbb"
   * @param {string} opts.strokeColor - "#rrggbb"
   * @param {number} opts.strokeWidth
   */
  constructor(scene, opts) {
    this.scene = scene;
    this.id = opts.id;
    this.type = opts.type;

    this.radius = opts.radius;

    this.circle = scene.add.circle(
      opts.x,
      opts.y,
      this.radius,
      hexTo0x(opts.fillColor),
      1
    );

    this.circle.setStrokeStyle(opts.strokeWidth, hexTo0x(opts.strokeColor), 1);
    this.circle.setDepth(10); // encima del tablero

    this.circle.setDataEnabled();
    this.circle.setData({
      pieceId: this.id,
      type: this.type,
      // dónde está colocada (luego lo llenas con q,r + nodeIndex)
      placed: false,
      cellId: null,
      nodeType: null,
      sideIndex: null
    });

    // Interacción base (por ahora)
    this.circle.setInteractive(
      new Phaser.Geom.Circle(0, 0, this.radius),
      Phaser.Geom.Circle.Contains
    );

    this.circle.on("pointerdown", () => {
      // eslint-disable-next-line no-console
      console.log("Piece click:", this.id, this.type);
    });
  }

  setPosition(x, y) {
    this.circle.setPosition(x, y);
  }

  destroy() {
    this.circle.destroy();
  }
}