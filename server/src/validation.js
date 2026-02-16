// server/src/validation.js

import { getRoleForSocket, getTurn, isSlotOccupied, getPlacements } from "./lobby.js";

/**
 * Move DTO:
 * {
 *   action: "place" | "relocate",
 *   pieceId: string,
 *   to: { cellId: string, holeType: string, sideIndex: number }
 * }
 *
 * Server will keep Placement shape compatible with your frontend PlacementState:
 * { pieceId, cellId, holeType, sideIndex, ...optional metadata }
 */

export function validateMove(socketId, move) {
  const role = getRoleForSocket(socketId);

  if (!role) return { ok: false, reason: "not_in_lobby" };
  if (role === "spectator") return { ok: false, reason: "spectators_cannot_move" };

  const turn = getTurn();
  if (turn !== role) return { ok: false, reason: "not_your_turn" };

  if (!move || typeof move !== "object") return { ok: false, reason: "invalid_payload" };
  const { action, pieceId, to } = move;

  if (action !== "place" && action !== "relocate")
    return { ok: false, reason: "invalid_action" };

  if (typeof pieceId !== "string" || !pieceId.length)
    return { ok: false, reason: "invalid_pieceId" };

  if (!to || typeof to !== "object") return { ok: false, reason: "invalid_to" };
  const { cellId, holeType, sideIndex } = to;

  if (typeof cellId !== "string" || !cellId.length)
    return { ok: false, reason: "invalid_cellId" };

  if (typeof holeType !== "string" || !holeType.length)
    return { ok: false, reason: "invalid_holeType" };

  // sideIndex: int para sides, null para center
  if (!(Number.isInteger(sideIndex) || sideIndex === null))
    return { ok: false, reason: "invalid_sideIndex" };

  // destino libre
  if (isSlotOccupied({ cellId, holeType, sideIndex }))
    return { ok: false, reason: "slot_occupied" };

  // relocate requiere que la pieza ya exista colocada (si no, es inválido)
  if (action === "relocate") {
    const placements = getPlacements();
    const exists = placements.some((p) => p.pieceId === pieceId);
    if (!exists) return { ok: false, reason: "piece_not_placed" };
  }

  // place requiere que la pieza NO exista colocada (si ya estaba colocada, inválido)
  if (action === "place") {
    const placements = getPlacements();
    const exists = placements.some((p) => p.pieceId === pieceId);
    if (exists) return { ok: false, reason: "piece_already_placed" };
  }

  return { ok: true, role, turn };
}

/**
 * Construye el placement canon del server.
 * Aquí podemos conservar metadata opcional si la mandas,
 * pero por ahora mantenemos mínimo: pieceId + destino.
 */
export function buildNextPlacement(move) {
  return {
    pieceId: move.pieceId,
    cellId: move.to.cellId,
    holeType: move.to.holeType,
    sideIndex: move.to.sideIndex
  };
}