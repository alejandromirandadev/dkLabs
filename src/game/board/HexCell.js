import Phaser from "phaser";

/**
 * HexCell (flat-top)
 * - Dibuja un hexágono regular de lado `sideLength`
 * - Crea 7 círculos interactivos:
 *   - 1 centro
 *   - 6 "side nodes" (uno por lado), alineados perpendicular al lado desde su midpoint
 *
 * Orientación: flat-top (lado plano arriba/abajo)
 */
export default class HexCell {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} opts
   * @param {string|number} opts.id
   * @param {number} opts.x - centro del hex
   * @param {number} opts.y - centro del hex
   * @param {number} opts.sideLength - longitud del lado (en pixeles)
   * @param {number} opts.nodeRadius - radio de cada círculo (en pixeles)
   * @param {number} [opts.nodeMargin=6] - espacio extra para que el nodo no pegue al borde
   * @param {number} [opts.strokeWidth=2]
   */
  constructor(scene, opts) {
    this.scene = scene;

    this.id = opts.id;
    this.cx = opts.x;
    this.cy = opts.y;

    this.sideLength = opts.sideLength;
    this.nodeRadius = opts.nodeRadius;

    this.nodeMargin = opts.nodeMargin ?? 6;
    this.strokeWidth = opts.strokeWidth ?? 2;

    // Colores por defecto (los puedes cambiar luego)
    this.colors = {
      //hexFill: 0x1b1b1b,
      hexFill: 0x223344, //Aquí cambia color de la celda en 2d
      hexStroke: 0xffffff,
      nodeFill: 0xffffff,
      nodeStroke: 0x000000,
      nodeHover: 0xffd54a
    };

    this.vertices = this.#computeHexVerticesFlatTop(this.cx, this.cy, this.sideLength);
    this.sideMidpoints = this.#computeSideMidpoints(this.vertices);

    this.graphics = scene.add.graphics();
    this.graphics.setDepth(0);

    this.nodes = {
      center: null,
      sides: new Array(6).fill(null)
    };

    this.#drawHex();
    this.#createNodes();
  }

  destroy() {
    if (this.graphics) this.graphics.destroy();

    if (this.nodes.center) this.nodes.center.destroy();
    for (const n of this.nodes.sides) {
      if (n) n.destroy();
    }
  }

  // =========================
  // Geometry
  // =========================

  /**
   * Flat-top hex:
   * vertices angles: 0, 60, 120, 180, 240, 300 degrees
   * Here we use radius = sideLength (for a regular hex, circumradius = side length).
   */
  #computeHexVerticesFlatTop(cx, cy, sideLength) {
    const R = sideLength; // circumradius
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const angleDeg = 60 * i; // flat-top starts at 0° (pointing right)
      const a = Phaser.Math.DegToRad(angleDeg);
      pts.push(new Phaser.Math.Vector2(cx + R * Math.cos(a), cy + R * Math.sin(a)));
    }
    return pts;
  }

  #computeSideMidpoints(verts) {
    const mids = [];
    for (let i = 0; i < 6; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % 6];
      mids.push(new Phaser.Math.Vector2((a.x + b.x) / 2, (a.y + b.y) / 2));
    }
    return mids;
  }

  /**
   * apothem = sideLength * sqrt(3)/2
   * Distance from center to each side (to the midpoint).
   */
  #apothem() {
    return this.sideLength * (Math.sqrt(3) / 2);
  }

  // =========================
  // Drawing + Nodes
  // =========================

  #drawHex() {
    const g = this.graphics;
    g.clear();

    // Fill
    g.fillStyle(this.colors.hexFill, 1);
    g.beginPath();
    g.moveTo(this.vertices[0].x, this.vertices[0].y);
    for (let i = 1; i < 6; i++) g.lineTo(this.vertices[i].x, this.vertices[i].y);
    g.closePath();
    g.fillPath();

    // Stroke
    g.lineStyle(this.strokeWidth, this.colors.hexStroke, 1);
    g.strokePoints(this.vertices, true);
  }

  #createNodes() {
    // Centro
    this.nodes.center = this.#makeNode(this.cx, this.cy, {
      type: "center",
      sideIndex: null
    });

    // 6 nodos por lado
    const ap = this.#apothem();
    const offset = ap - this.nodeMargin - this.nodeRadius;

    for (let i = 0; i < 6; i++) {
      const mid = this.sideMidpoints[i];

      // Dirección perpendicular al lado hacia el midpoint (center -> midpoint)
      const dir = new Phaser.Math.Vector2(mid.x - this.cx, mid.y - this.cy).normalize();

      const nx = this.cx + dir.x * offset;
      const ny = this.cy + dir.y * offset;

      this.nodes.sides[i] = this.#makeNode(nx, ny, {
        type: "side",
        sideIndex: i
      });
    }
  }

  #makeNode(x, y, meta) {
    const c = this.scene.add.circle(x, y, this.nodeRadius, this.colors.nodeFill, 1);
    c.setDepth(1);

    // borde para que se vea pro
    c.setStrokeStyle(2, this.colors.nodeStroke, 1);

    // Data útil
    c.setDataEnabled();
    c.setData({
      cellId: this.id,
      ...meta,
      occupied: false
    });

    // Interacción básica
    c.setInteractive(new Phaser.Geom.Circle(0, 0, this.nodeRadius), Phaser.Geom.Circle.Contains);

    c.on("pointerover", () => {
      c.setFillStyle(this.colors.nodeHover, 1);
    });

    c.on("pointerout", () => {
      c.setFillStyle(this.colors.nodeFill, 1);
    });

    // Click: por ahora solo log, luego tú metes reglas
    c.on("pointerdown", () => {
      // Aquí tú después metes tu lógica
      // Por ahora: debug
      // eslint-disable-next-line no-console
      console.log("Node click:", c.getData("cellId"), c.getData("type"), c.getData("sideIndex"));
    });

    return c;
  }

  getAllNodes() {
    return [this.nodes.center, ...this.nodes.sides];
  }
}