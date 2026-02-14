import './style.css'
import { createGame } from './game/createGame'
import ThreeBoardMode from './three/ThreeBoardMode'
import { placementState } from './state/PlacementState'
import { pieceCountState } from './state/PieceCountState'

// Carga placements persistidos (si hay)
placementState.loadFromStorage()

// Carga contadores persistidos (si hay)
pieceCountState.loadFromStorage()

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

      // Refresca contadores del pool (por si se colocó/quitó en 3D)
      const counts = pieceCountState.getCounts()
      try {
        boardScene.poolLeft?.setRemaining?.(counts.whiteRemaining)
        boardScene.poolRight?.setRemaining?.(counts.blackRemaining)
        boardScene.poolLeft?.refreshActivePiece?.()
        boardScene.poolRight?.refreshActivePiece?.()
      } catch {
        // ignore
      }
    }, 0)
  }

  btnEnter3D.disabled = false
  btnBack2D.disabled = true
}

btnEnter3D?.addEventListener('click', enter3D)
btnBack2D?.addEventListener('click', back2D)

btnClearBoard?.addEventListener('click', () => {
  // Limpia estado compartido (persistencia)
  placementState.clear()

  // Reinicia contadores del pool (persistencia)
  pieceCountState.reset()

  // Si estamos en 3D, limpia también visualmente el 3D
  if (threeMode?.isMounted) {
    try {
      threeMode.clearPlacements()
    } catch {
      // ignore
    }
  }

  // Limpia visualmente el 2D (aunque esté pausado)
  const boardScene = getBoardScene()
  if (boardScene) placementState.applyToPhaser(boardScene)
})
