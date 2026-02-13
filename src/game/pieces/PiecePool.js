export default class PiecePool {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} opts
   * @param {string} opts.id
   * @param {"white"|"black"} opts.type
   * @param {number} opts.x
   * @param {number} opts.y
   * @param {number} opts.width
   * @param {number} opts.height
   */
  constructor(scene, opts) {
    this.scene = scene;
    this.id = opts.id;
    this.type = opts.type;

    this.x = opts.x;
    this.y = opts.y;
    this.width = opts.width;
    this.height = opts.height;

    // Fondo del contenedor
    this.bg = scene.add.rectangle(this.x, this.y, this.width, this.height, 0x222222, 1);
    this.bg.setOrigin(0, 0);
    this.bg.setDepth(2);

    // Borde
    this.border = scene.add.rectangle(this.x, this.y, this.width, this.height);
    this.border.setOrigin(0, 0);
    this.border.setStrokeStyle(2, 0xffffff, 0.25);
    this.border.setDepth(2);

    // Label
    this.label = scene.add.text(this.x + 12, this.y + 10, this.type.toUpperCase(), {
      fontFamily: "Arial",
      fontSize: "16px",
      color: "#ffffff"
    });
    this.label.setDepth(3);

    this.pieces = [];
  }

  addPieces(pieces) {
    // asigna “home” a cada pieza
    for (const p of pieces) {
      p.circle.setData("homePoolId", this.id);
      p.circle.setData("homeX", p.circle.x);
      p.circle.setData("homeY", p.circle.y);
      this.pieces.push(p);
    }
  }

  /**
   * acomoda visualmente en una rejilla dentro del pool
   */
  layoutGrid({ cols = 3, padding = 12, topOffset = 36 } = {}) {
    const startX = this.x + padding;
    const startY = this.y + topOffset;

    const cellW = (this.width - padding * 2) / cols;

    this.pieces.forEach((p, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);

      const px = startX + col * cellW + cellW / 2;
      const py = startY + row * (p.radius * 2 + 10) + p.radius;

      p.setPosition(px, py);
      p.circle.setData("homeX", px);
      p.circle.setData("homeY", py);
    });
  }

  returnPieceToHome(piece) {
    piece.setPosition(piece.circle.getData("homeX"), piece.circle.getData("homeY"));
    piece.circle.setData("placed", false);
    piece.circle.setData("cellId", null);
    piece.circle.setData("nodeKey", null);
  }
}