// src/net/socketClient.js
import { io } from "socket.io-client";

let socket = null;
let netState = {
  connected: false,
  role: null,     // "white" | "black" | "spectator"
  turn: "white",  // "white" | "black"
};

const defaultHandlers = {
  onConnected: () => {},
  onDisconnected: () => {},
  onRoleAssigned: (_payload) => {},
  onPresence: (_payload) => {},
  onMoveAccepted: (_payload) => {},
  onMoveRejected: (_payload) => {},
  onSnapshot: (_payload) => {},
  onLobbyClosed: (_payload) => {},
};

export function getSocket() {
  return socket;
}

export function getNetState() {
  return { ...netState };
}

export function initSocketClient(handlers = {}) {
  const h = { ...defaultHandlers, ...handlers };

  if (socket) return socket;

  const url =
    import.meta.env.VITE_SERVER_URL?.trim() || "http://localhost:3001";

  socket = io(url, {
    // deja que socket.io use polling y luego suba a websocket
    transports: ["polling", "websocket"],
    upgrade: true,

    autoConnect: true,
    reconnection: true,
    reconnectionDelay: 300,
    reconnectionDelayMax: 2000,
  });

  socket.on("connect_error", (err) => {
    console.warn("[socket] connect_error:", err?.message || err);
  });

  socket.on("error", (err) => {
    console.warn("[socket] error:", err);
  });

  socket.on("connect", () => {
    netState.connected = true;
    h.onConnected();

    // una sola sala
    socket.emit("joinLobby");
  });

  socket.on("disconnect", () => {
    netState.connected = false;
    netState.role = null;
    h.onDisconnected();
  });

  socket.on("roleAssigned", (payload) => {
    netState.role = payload?.role ?? null;
    netState.turn = payload?.turn ?? "white";
    h.onRoleAssigned(payload);
  });

  socket.on("lobbyPresence", (payload) => {
    h.onPresence(payload);
  });

  socket.on("moveAccepted", (payload) => {
    netState.turn = payload?.turn ?? netState.turn;
    h.onMoveAccepted(payload);
  });

  socket.on("moveRejected", (payload) => {
    h.onMoveRejected(payload);
  });

  socket.on("stateSnapshot", (payload) => {
    netState.turn = payload?.turn ?? "white";
    h.onSnapshot(payload);
  });

  socket.on("lobbyClosed", (payload) => {
    netState.role = null;
    netState.turn = "white";
    h.onLobbyClosed(payload);
  });

  return socket;
}

/**
 * move:
 * {
 *   action: "place" | "relocate",
 *   pieceId: string,
 *   to: { cellId: string, holeType: string, sideIndex: number }
 * }
 */
export function emitMovePiece(move) {
  if (!socket) return Promise.resolve({ ok: false, reason: "no_socket" });

  return new Promise((resolve) => {
    socket.emit("movePiece", move, (ack) => {
      resolve(ack ?? { ok: false, reason: "no_ack" });
    });
  });
}

export function shutdownSocketClient() {
  if (!socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
  netState = { connected: false, role: null, turn: "white" };
}