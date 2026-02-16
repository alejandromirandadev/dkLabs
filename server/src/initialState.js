// server/src/initialState.js
export function buildInitialSetupPlacements() {
  // 6 esquinas para radio 3 (cellId "q,r")
  const cornerCellIds = ["0,3", "3,0", "3,-3", "0,-3", "-3,0", "-3,3"];

  const out = [];

  // bw neutral en el centro del hex central
  out.push({
    pieceId: "bw_1",
    pieceType: "bw",
    cellId: "0,0",
    holeType: "center",
    sideIndex: null
  });

  // esquinas: 3 blancas, 3 negras, alternando, llenando centro + sides 0..5
  let w = 1;
  let b = 1;

  for (let i = 0; i < cornerCellIds.length; i++) {
    const cellId = cornerCellIds[i];
    const isWhite = i % 2 === 0;

    const holes = [
      { holeType: "center", sideIndex: null },
      ...Array.from({ length: 6 }, (_, sideIndex) => ({ holeType: "side", sideIndex }))
    ];

    for (const h of holes) {
      if (isWhite) {
        out.push({
          pieceId: `white_${w++}`,
          pieceType: "white",
          homePoolId: "pool_white",
          cellId,
          holeType: h.holeType,
          sideIndex: h.sideIndex
        });
      } else {
        out.push({
          pieceId: `black_${b++}`,
          pieceType: "black",
          homePoolId: "pool_black",
          cellId,
          holeType: h.holeType,
          sideIndex: h.sideIndex
        });
      }
    }
  }

  return out;
}