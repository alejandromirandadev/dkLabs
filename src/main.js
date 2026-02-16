import './style.css'
import { createGame } from './game/createGame'
import ThreeBoardMode from './three/ThreeBoardMode'
import { placementState, buildInitialSetupPlacements } from './state/PlacementState'
import { initSocketClient } from './net/socketClient'

// Carga placements persistidos (si hay)
// Carga placements persistidos (si hay)
placementState.loadFromStorage()

function applyPlacementsEverywhere(placements) {
  // 2D
  const boardScene = getBoardScene()
  if (boardScene) placementState.applyToPhaser(boardScene)

  // 3D (si está montado)
  if (threeMode?.isMounted) {
    try {
      threeMode.setInitialPlacements(placements)
      threeMode._applyPlacementsToScene(placements)
    } catch {
      // ignore
    }
  }
}

function upsertLocalPlacementFromMove(move) {
  const curr = placementState.getPlacements()
  const idx = curr.findIndex(p => p.pieceId === move.pieceId)
  const next = {
    ...(idx >= 0 ? curr[idx] : { pieceId: move.pieceId }),
    cellId: move.to.cellId,
    holeType: move.to.holeType,
    sideIndex: move.to.sideIndex
  }

  if (idx >= 0) curr[idx] = next
  else curr.push(next)

  placementState.setPlacements(curr)
}


// --- HUD simple de red (DOM) ---
const netHud = document.createElement("div");
netHud.id = "netHud";
netHud.style.position = "fixed";
netHud.style.top = "12px";
netHud.style.right = "12px";
netHud.style.zIndex = "999999";
netHud.style.padding = "10px 12px";
netHud.style.borderRadius = "10px";
netHud.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
netHud.style.fontSize = "12px";
netHud.style.lineHeight = "1.25";
netHud.style.background = "rgba(0,0,0,0.55)";
netHud.style.color = "rgba(255,255,255,0.9)";
netHud.style.backdropFilter = "blur(6px)";
netHud.style.pointerEvents = "none";
netHud.style.minWidth = "180px";
netHud.textContent = "Conectando...";
document.body.appendChild(netHud);

const hudModel = {
  connected: false,
  role: "—",
  turn: "white",
  players: { white: null, black: null },
  spectatorsCount: 0,
};

function renderHud() {
  const roleLabel =
    hudModel.role === "white" ? "White" :
    hudModel.role === "black" ? "Black" :
    hudModel.role === "spectator" ? "Spectator" : "—";

  const turnLabel = hudModel.turn === "white" ? "White" : "Black";

  const canPlay =
    hudModel.connected &&
    (hudModel.role === "white" || hudModel.role === "black") &&
    hudModel.role === hudModel.turn;

  const status =
    !hudModel.connected ? "Offline" :
    hudModel.role === "spectator" ? "Spectating" :
    canPlay ? "Tu turno" : "Espera";

  netHud.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:12px;">
      <div><b>Net</b>: ${hudModel.connected ? "Online" : "Offline"}</div>
      <div style="opacity:0.85;">${status}</div>
    </div>
    <div style="margin-top:6px;">
      <div><b>Role</b>: ${roleLabel}</div>
      <div><b>Turn</b>: ${turnLabel}</div>
    </div>
    <div style="margin-top:6px; opacity:0.85;">
      <div><b>Players</b>: W=${hudModel.players.white ? "✔" : "—"} / B=${hudModel.players.black ? "✔" : "—"}</div>
      <div><b>Spectators</b>: ${hudModel.spectatorsCount}</div>
    </div>
  `;
}
renderHud();

// --- Socket.io: listeners -> estado global -> re-render ---
initSocketClient({
  onConnected: () => {
    hudModel.connected = true;
    renderHud();
  },

  onDisconnected: () => {
    hudModel.connected = false;
    hudModel.role = "—";
    hudModel.turn = "white";
    hudModel.players = { white: null, black: null };
    hudModel.spectatorsCount = 0;
    renderHud();
  },

  onRoleAssigned: (payload) => {
    hudModel.role = payload?.role ?? "—";
    hudModel.turn = payload?.turn ?? "white";
    renderHud();

    if (Array.isArray(payload?.placements)) placementState.setPlacements(payload.placements);
    applyPlacementsEverywhere(placementState.getPlacements());
  },

  onPresence: (payload) => {
    hudModel.players = payload?.players ?? hudModel.players;
    hudModel.spectatorsCount = payload?.spectatorsCount ?? hudModel.spectatorsCount;
    renderHud();
  },

  onMoveAccepted: (payload) => {
    hudModel.turn = payload?.turn ?? hudModel.turn;
    renderHud();

    const move = payload?.move;
    if (!move?.pieceId || !move?.to) return;
    upsertLocalPlacementFromMove(move);
    applyPlacementsEverywhere(placementState.getPlacements());
  },

  onMoveRejected: (_payload) => {
    // (Opcional) podrías parpadear el HUD o mostrar reason; lo dejamos limpio.
  },

  onSnapshot: (payload) => {
    hudModel.turn = payload?.turn ?? "white";
    renderHud();

    if (Array.isArray(payload?.placements)) placementState.setPlacements(payload.placements);
    applyPlacementsEverywhere(placementState.getPlacements());
  },

  onLobbyClosed: () => {
    hudModel.role = "—";
    hudModel.turn = "white";
    hudModel.players = { white: null, black: null };
    hudModel.spectatorsCount = 0;
    renderHud();

    placementState.setPlacements([]);
    applyPlacementsEverywhere([]);
  }
});


const game = createGame('app')

// UI Buttons
const btnEnter3D = document.getElementById('btnEnter3D')
const btnBack2D = document.getElementById('btnBack2D')
const btnClearBoard = document.getElementById('btnClearBoard')
const threeRoot = document.getElementById('threeRoot')

/** @type {HTMLCanvasElement | null} */
let phaserCanvas = null

const threeMode = new ThreeBoardMode(threeRoot)

function getBoardScene() {
  try {
    return game.scene.getScene('BoardScene')
  } catch {
    return null
  }
}

function setPhaserInteractive(isInteractive) {
  if (!phaserCanvas) phaserCanvas = document.querySelector('#app canvas')
  if (!phaserCanvas) return
  phaserCanvas.style.pointerEvents = isInteractive ? 'auto' : 'none'
  phaserCanvas.style.opacity = isInteractive ? '1' : '0'
}

function enter3D() {
  // Captura estado actual del 2D (placements) y pásalo al 3D
  const boardScene = getBoardScene()
  if (boardScene) {
    placementState.captureFromPhaser(boardScene)
    const placements = placementState.getPlacements()
    threeMode.setInitialPlacements(placements)
  }

  // Pausa el juego 2D (solo la escena actual)
  try {
    game.scene.pause('BoardScene')
  } catch {
    // ignore
  }

  threeRoot.classList.add('is-active')
  threeRoot.setAttribute('aria-hidden', 'false')
  setPhaserInteractive(false)
  threeMode.mount()

  btnEnter3D.disabled = true
  btnBack2D.disabled = false
}

function back2D() {
  // Toma placements del 3D y aplícalos al 2D
  try {
    const placements = threeMode.getPlacements()
    // eslint-disable-next-line no-console
    console.log('[ThreeMode] placements:', placements)

    placementState.setPlacements(placements)
  } catch {
    // ignore
  }

  threeMode.unmount()
  threeRoot.classList.remove('is-active')
  threeRoot.setAttribute('aria-hidden', 'true')
  setPhaserInteractive(true)

  try {
    game.scene.resume('BoardScene')
  } catch {
    // ignore
  }

  const boardScene = getBoardScene()
  if (boardScene) {
    // Aplica en cuanto regrese el render/input
    // (micro-delay para que Phaser ya esté resumiendo)
    setTimeout(() => {
      placementState.applyToPhaser(boardScene)
    }, 0)
  }

  btnEnter3D.disabled = false
  btnBack2D.disabled = true
}

btnEnter3D?.addEventListener('click', enter3D)
btnBack2D?.addEventListener('click', back2D)

btnClearBoard?.addEventListener('click', () => {
  // Estado inicial oficial (persistencia)
  const initialPlacements = buildInitialSetupPlacements()
  placementState.setPlacements(initialPlacements)

  // Limpia/aplica visualmente el 2D (aunque esté pausado)
  const boardScene = getBoardScene()
  if (boardScene) placementState.applyToPhaser(boardScene)

  // Aplica también en 3D si está montado
  if (threeMode?.isMounted) {
    try {
      threeMode.setInitialPlacements(initialPlacements)
      // Nota: método interno; se usa para re-sincronizar la escena sin remount.
      threeMode._applyPlacementsToScene(initialPlacements)
    } catch {
      // ignore
    }
  }
})