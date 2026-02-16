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
   * @param {"white"|"black"|"bw"} opts.type
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

    // Zona invisible para input (evita hitArea desfasado)
    this.hit = scene.add.zone(opts.x, opts.y, this.radius * 2, this.radius * 2);
    this.hit.setOrigin(0.5, 0.5);
    this.hit.setDepth(1000); // no importa visualmente, es invisible
    this.hit.setDataEnabled();

    // GameObject principal
    this.go = null;

    // Back-compat: el resto del código (PiecePool / BoardScene) aún usa `piece.circle`
    this.circle = null;

    if (this.type === "bw") {
      const g = scene.add.graphics();
      g.setPosition(opts.x, opts.y);

      // bw: 2 colores (vienen del json vía factory)
      const cA = hexTo0x(opts.fillColorA ?? "#000000");
      const cB = hexTo0x(opts.fillColorB ?? "#ffffff");

      g.fillStyle(cA, 1);
      g.slice(0, 0, this.radius, -Math.PI / 2, Math.PI / 2, false);
      g.fillPath();

      g.fillStyle(cB, 1);
      g.slice(0, 0, this.radius, Math.PI / 2, (3 * Math.PI) / 2, false);
      g.fillPath();

      // stroke
      g.lineStyle(opts.strokeWidth, hexTo0x(opts.strokeColor), 1);
      g.strokeCircle(0, 0, this.radius);

      g.setDepth(10); // encima del tablero

      g.setDataEnabled();
      g.setData({
        pieceId: this.id,
        type: this.type,
        placed: false,
        cellId: null,
        nodeType: null,
        sideIndex: null
      });

      this.hit.setData({
        pieceId: this.id,
        type: this.type,
        placed: false,
        cellId: null,
        nodeType: null,
        sideIndex: null
      });
      this.hit.setData("pieceRef", this);

      this.hit.setInteractive();

      g.on("pointerdown", () => {
        // eslint-disable-next-line no-console
        console.log("Piece click:", this.id, this.type);
      });

      this.go = g;
      this.circle = this.go; // <-- NUEVO: alias back-compat
    } else {
      const c = scene.add.circle(
        opts.x,
        opts.y,
        this.radius,
        hexTo0x(opts.fillColor),
        1
      );

      c.setStrokeStyle(opts.strokeWidth, hexTo0x(opts.strokeColor), 1);
      c.setDepth(10); // encima del tablero

      c.setDataEnabled();
      c.setData({
        pieceId: this.id,
        type: this.type,
        placed: false,
        cellId: null,
        nodeType: null,
        sideIndex: null
      });

      this.hit.setData({
        pieceId: this.id,
        type: this.type,
        placed: false,
        cellId: null,
        nodeType: null,
        sideIndex: null
      });

      this.hit.setData("pieceRef", this);

      this.hit.setInteractive();

      c.on("pointerdown", () => {
        // eslint-disable-next-line no-console
        console.log("Piece click:", this.id, this.type);
      });

      this.go = c;
      this.circle = this.go; // <-- NUEVO: alias back-compat
    }
  }

  setPosition(x, y) {
    (this.go || this.circle).setPosition(x, y);
  }

  destroy() {
    (this.go || this.circle).destroy();
    if (this.hit) this.hit.destroy();
  }
}