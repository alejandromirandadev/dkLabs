// server/src/lobby.js
import { buildInitialSetupPlacements } from "./initialState.js";
export const LOBBY_ROOM_ID = "lobby";

/**
 * Room shape:
 * {
 *   players: { white: socketId|null, black: socketId|null },
 *   spectators: Set<socketId>,
 *   turn: "white"|"black",
 *   placements: Array<Placement>
 * }
 */

const createEmptyRoom = () => ({
  players: { white: null, black: null },
  spectators: new Set(),
  turn: "white",
  placements: buildInitialSetupPlacements()
});

let room = createEmptyRoom();

export function getRoomSnapshot() {
  return {
    roomId: LOBBY_ROOM_ID,
    players: { ...room.players },
    spectatorsCount: room.spectators.size,
    turn: room.turn,
    placements: room.placements
  };
}

export function getRoleForSocket(socketId) {
  if (room.players.white === socketId) return "white";
  if (room.players.black === socketId) return "black";
  if (room.spectators.has(socketId)) return "spectator";
  return null;
}

export function assignRole(socketId) {
  const existing = getRoleForSocket(socketId);
  if (existing) return existing;

  if (!room.players.white) {
    room.players.white = socketId;
    return "white";
  }
  if (!room.players.black) {
    room.players.black = socketId;
    return "black";
  }
  room.spectators.add(socketId);
  return "spectator";
}

export function removeSocket(socketId) {
  const role = getRoleForSocket(socketId);

  if (role === "white") room.players.white = null;
  else if (role === "black") room.players.black = null;
  else if (role === "spectator") room.spectators.delete(socketId);

  return role;
}

export function shouldCloseLobby() {
  return !room.players.white && !room.players.black;
}

export function resetLobby() {
  room = createEmptyRoom();
}

export function toggleTurn() {
  room.turn = room.turn === "white" ? "black" : "white";
}

export function getTurn() {
  return room.turn;
}

export function getPlacements() {
  return room.placements;
}

export function upsertPlacement(nextPlacement) {
  const idx = room.placements.findIndex((p) => p.pieceId === nextPlacement.pieceId);
  if (idx >= 0) room.placements[idx] = nextPlacement;
  else room.placements.push(nextPlacement);
}

export function isSlotOccupied({ cellId, holeType, sideIndex }) {
  return room.placements.some(
    (p) =>
      p.cellId === cellId &&
      p.holeType === holeType &&
      p.sideIndex === sideIndex
  );
}