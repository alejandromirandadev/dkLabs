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

    // Counter (piezas restantes en el pool)
    this.remaining = 21;
    this.counterText = scene.add.text(this.x + this.width - 12, this.y + 10, String(this.remaining), {
      fontFamily: "Arial",
      fontSize: "16px",
      color: "#ffffff"
    });
    this.counterText.setOrigin(1, 0);
    this.counterText.setDepth(3);

    this.pieces = [];
  }

  setRemaining(count) {
    this.remaining = Math.max(0, Math.floor(Number(count) || 0));
    if (this.counterText) this.counterText.setText(String(this.remaining));
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


  /**
   * Acomoda todas las piezas del pool en un solo punto (modo "stamp"):
   * solo 1 pieza se verá/arrastrará a la vez.
   */
  layoutStack({ padding = 12, topOffset = 72 } = {}) {
    const px = this.x + this.width / 2;
    const py = this.y + topOffset;

    this.pieces.forEach((p) => {
      p.setPosition(px, py);
      p.circle.setData("homeX", px);
      p.circle.setData("homeY", py);
    });
  }

  /**
   * Muestra/activa SOLO 1 pieza disponible en el pool si remaining > 0.
   * Si remaining == 0, deshabilita el drag desde el pool.
   */
  refreshActivePiece() {
    // piezas que están físicamente en el pool (no colocadas)
    const available = this.pieces.filter((p) => !p?.circle?.getData("placed"));

    // Oculta/desactiva todas por default
    for (const p of available) {
      const g = p.circle;
      if (!g) continue;
      g.setVisible(false);
      g.disableInteractive();
      this.scene.input.setDraggable(g, false);
    }

    if (this.remaining <= 0) return;

    // Activa la primera disponible
    const active = available[0];
    if (!active?.circle) return;

    active.circle.setVisible(true);
    active.circle.setInteractive();
    this.scene.input.setDraggable(active.circle, true);
  }

  returnPieceToHome(piece) {
    piece.setPosition(piece.circle.getData("homeX"), piece.circle.getData("homeY"));
    piece.circle.setData("placed", false);
    piece.circle.setData("cellId", null);
    piece.circle.setData("nodeKey", null);
  }
}