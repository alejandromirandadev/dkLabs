/**
 * PieceCountState
 *
 * Estado compartido (en memoria + localStorage) para contadores de piezas disponibles por color.
 * - whiteRemaining: piezas blancas disponibles en el pool
 * - blackRemaining: piezas negras disponibles en el pool
 */
const STORAGE_KEY = "dkLabs:pieceCounts:v1";

class PieceCountState {
  constructor() {
    this.whiteRemaining = 21;
    this.blackRemaining = 21;
  }

  loadFromStorage() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;

      const w = Number(parsed.whiteRemaining);
      const b = Number(parsed.blackRemaining);

      if (Number.isFinite(w)) this.whiteRemaining = w;
      if (Number.isFinite(b)) this.blackRemaining = b;
    } catch {
      // ignore
    }
  }

  saveToStorage() {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          whiteRemaining: this.whiteRemaining,
          blackRemaining: this.blackRemaining,
        })
      );
    } catch {
      // ignore
    }
  }

  reset() {
    this.whiteRemaining = 21;
    this.blackRemaining = 21;
    this.saveToStorage();
  }

  /**
   * @param {{whiteRemaining?: number, blackRemaining?: number}} counts
   */
  setCounts(counts) {
    if (counts && typeof counts === "object") {
      if (typeof counts.whiteRemaining === "number" && Number.isFinite(counts.whiteRemaining)) {
        this.whiteRemaining = counts.whiteRemaining;
      }
      if (typeof counts.blackRemaining === "number" && Number.isFinite(counts.blackRemaining)) {
        this.blackRemaining = counts.blackRemaining;
      }
    }
    this.saveToStorage();
  }

  getCounts() {
    return {
      whiteRemaining: this.whiteRemaining,
      blackRemaining: this.blackRemaining,
    };
  }
}

// Singleton
export const pieceCountState = new PieceCountState();
