import HexCell from "./HexCell";

export default class Board {
  constructor(scene, config) {
    this.scene = scene;
    this.config = config;
    this.cells = [];

    this.originX = config.layout.origin.x;
    this.originY = config.layout.origin.y;

    this.sideLength = config.hex.sideLength;
    this.nodeRadius = config.nodes.radius;
    this.nodeMargin = config.nodes.margin;

    this.#generate();
  }

  #generate() {
    if (this.config.generate.type === "hex") {
      this.#generateHexRadius(this.config.generate.radius);
    }
  }

  #generateHexRadius(radius) {
    for (let q = -radius; q <= radius; q++) {
      for (let r = -radius; r <= radius; r++) {
        if (Math.abs(q + r) <= radius) {
          const { x, y } = this.#axialToPixel(q, r);

          const cell = new HexCell(this.scene, {
            id: `${q},${r}`,
            x,
            y,
            sideLength: this.sideLength,
            nodeRadius: this.nodeRadius,
            nodeMargin: this.nodeMargin
          });

          this.cells.push(cell);
        }
      }
    }
  }

  #axialToPixel(q, r) {
    const s = this.sideLength;

    const x = s * (3 / 2) * q;
    const y = s * Math.sqrt(3) * (r + q / 2);

    return {
      x: x + this.originX,
      y: y + this.originY
    };
  }

  getAllNodes() {
    const out = [];
    for (const cell of this.cells) {
      out.push(cell.nodes.center);
      out.push(...cell.nodes.sides);
    }
    return out;
  }
}