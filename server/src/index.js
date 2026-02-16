import express from "express";
import http from "http";
import cors from "cors";
import { Server as SocketIOServer } from "socket.io";

import {
  LOBBY_ROOM_ID,
  assignRole,
  getRoomSnapshot,
  removeSocket,
  shouldCloseLobby,
  resetLobby,
  upsertPlacement,
  toggleTurn
} from "./lobby.js";

import { validateMove, buildNextPlacement } from "./validation.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: true,          // en prod pon tu dominio exacto
    credentials: true
  }
});

// --- Auto-heal: snapshot periódico (solo lobby) ---
// NO se manda en cada movimiento, solo cada cierto tiempo para reparar desync.
const SNAPSHOT_EVERY_MS = 5000;

setInterval(() => {
  const snapshot = getRoomSnapshot();

  // Si no hay nadie en lobby, no spamear
  const hasAnyone =
    snapshot.players.white ||
    snapshot.players.black ||
    snapshot.spectatorsCount > 0;

  if (!hasAnyone) return;

  io.to(LOBBY_ROOM_ID).emit("stateSnapshot", {
    roomId: LOBBY_ROOM_ID,
    turn: snapshot.turn,
    placements: snapshot.placements
  });
}, SNAPSHOT_EVERY_MS);

io.on("connection", (socket) => {
  console.log(`[socket] connected: ${socket.id}`);

  socket.on("joinLobby", () => {
    // siempre una sola room
    socket.join(LOBBY_ROOM_ID);

    const role = assignRole(socket.id);
    const snapshot = getRoomSnapshot();

    // snapshot inicial solo a este cliente
    socket.emit("roleAssigned", {
      roomId: LOBBY_ROOM_ID,
      role,
      turn: snapshot.turn,
      placements: snapshot.placements
    });

    // broadcast presencia (opcional, útil para UI)
    io.to(LOBBY_ROOM_ID).emit("lobbyPresence", {
      players: snapshot.players,
      spectatorsCount: snapshot.spectatorsCount
    });

    console.log(`[lobby] ${socket.id} joined as ${role}`);
  });

  // --- Anti-spam / rate limit simple por socket ---
let moveWindowStart = Date.now();
let moveCountInWindow = 0;

// 10 moves por 2 segundos (ajustable)
const WINDOW_MS = 2000;
const MAX_MOVES_PER_WINDOW = 10;

function rateLimitExceeded() {
  const now = Date.now();
  if (now - moveWindowStart > WINDOW_MS) {
    moveWindowStart = now;
    moveCountInWindow = 0;
  }
  moveCountInWindow += 1;
  return moveCountInWindow > MAX_MOVES_PER_WINDOW;
}

    socket.on("movePiece", (move, ack) => {
  const reply = typeof ack === "function" ? ack : () => {};

  if (rateLimitExceeded()) {
    reply({ ok: false, reason: "rate_limited" });
    socket.emit("moveRejected", { reason: "rate_limited" });
    return;
  }

    const result = validateMove(socket.id, move);
    if (!result.ok) {
        reply({ ok: false, reason: result.reason });
        socket.emit("moveRejected", { reason: result.reason });
        return;
    }

    // aplicar movimiento al estado autoritativo
    const nextPlacement = buildNextPlacement(move);
    upsertPlacement(nextPlacement);

    // MVP: cualquier movimiento aceptado consume turno
    toggleTurn();

    const snapshot = getRoomSnapshot();

    // confirmación al que movió
    reply({ ok: true, turn: snapshot.turn });

    // broadcast a TODOS en lobby (jugadores + spectators)
    io.to(LOBBY_ROOM_ID).emit("moveAccepted", {
        move: {
        action: move.action,
        pieceId: move.pieceId,
        to: move.to
        },
        turn: snapshot.turn
    });
    });

    socket.on("disconnect", (reason) => {
    console.log(`[socket] disconnected: ${socket.id} (${reason})`);

    const leftRole = removeSocket(socket.id);

    // Si se fueron ambos jugadores: cerrar lobby y reiniciar estado
    if (shouldCloseLobby()) {
        resetLobby();

        // Notifica cierre + manda snapshot vacío para que clientes limpien UI/estado
        io.to(LOBBY_ROOM_ID).emit("lobbyClosed", {
        reason: "both_players_left"
        });

        io.to(LOBBY_ROOM_ID).emit("stateSnapshot", {
        roomId: LOBBY_ROOM_ID,
        turn: "white",
        placements: []
        });

        io.to(LOBBY_ROOM_ID).emit("lobbyPresence", {
        players: { white: null, black: null },
        spectatorsCount: 0
        });

        console.log("[lobby] closed + reset (both players left)");
        return;
    }

    // Lobby sigue vivo: solo presencia actualizada
    const snapshot = getRoomSnapshot();
    io.to(LOBBY_ROOM_ID).emit("lobbyPresence", {
        players: snapshot.players,
        spectatorsCount: snapshot.spectatorsCount
    });

    console.log(`[lobby] ${socket.id} left (${leftRole ?? "unknown"})`);
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});