import * as THREE from 'three';
import { pieceCountState } from '../state/PieceCountState';

/**
 * ThreeBoardMode
 * - Monta/desmonta un renderer de Three.js en un contenedor.
 * - Aún no genera tablero/piezas (eso va en el Paso 3).
 *
 * Objetivo del Paso 2:
 * - Tener ciclo de vida limpio (mount/unmount)
 * - Cámara fija estilo "juego de mesa"
 * - Resize correcto
 */
export default class ThreeBoardMode {
  /**
   * @param {HTMLElement} container
   */
  constructor(container) {
    this.container = container;

    /** @type {THREE.WebGLRenderer | null} */
    this.renderer = null;
    /** @type {THREE.Scene | null} */
    this.scene = null;
    /** @type {THREE.PerspectiveCamera | null} */
    this.camera = null;

    this._raf = 0;
    this._onResize = this._onResize.bind(this);

    /** @type {THREE.Group | null} */
    this.boardGroup = null;

    /** @type {THREE.Group | null} */
    this.piecesGroup = null;

    /**
     * Piezas 3D activas (pool + colocadas en huecos).
     *
     * @type {Array<{ id: string, type: 'white'|'black', mesh: THREE.Object3D, home: THREE.Vector3, holeId: (string|null) }>} */
    this.pieces = [];

    /** @type {Array<any>} */
    this.initialPlacements = [];

    /**
     * Config actual del tablero (para snap / tamaños).
     * @type {{ sideLength:number, nodeRadius:number, nodeMargin:number, radius:number, hexHeight:number } | null}
     */
    this.boardCfg = null;

    /** @type {{ minX:number, maxX:number, minZ:number, maxZ:number } | null} */
    this.boardBoundsXZ = null;

    // Interaction
    /** @type {THREE.Raycaster | null} */
    this.raycaster = null;
    /** @type {THREE.Vector2 | null} */
    this.pointerNdc = null;

    /** @type {{ pieceId: string, grabOffset: THREE.Vector3, dragPlaneY: number, prevHoleId: (string|null) } | null} */
    this.dragState = null;

    /**
     * Indicador visual de snap (highlight del Hueco objetivo).
     * @type {{ mesh: THREE.Mesh, okMat: THREE.MeshBasicMaterial, badMat: THREE.MeshBasicMaterial } | null}
     */
    this.snapPreview = null;

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onDoubleClick = this._onDoubleClick.bind(this);

    /**
     * Huecos (slots) generados por el tablero 3D.
     * Cada elemento representa un “Hueco” lógico del juego.
     *
     * @type {Array<{ id: string, cellId: string, type: 'center'|'side', sideIndex: (number|null), position: THREE.Vector3, occupied: boolean }>} */
    this.holes = [];

    /** @type {AbortController | null} */
    this._abort = null;

    /**
     * Contadores 3D (sprites) para remaining por color.
     * @type {{ white: { sprite: THREE.Sprite, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, texture: THREE.CanvasTexture } | null,
     *         black: { sprite: THREE.Sprite, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, texture: THREE.CanvasTexture } | null } | null}
     */
    this.counter3D = null;
  }

  get isMounted() {
    return !!this.renderer;
  }

  /**
   * Devuelve el estado de colocación actual (qué pieza está en qué Hueco).
   * Útil para persistencia / debug.
   */
  getPlacements() {
    const holeById = new Map(this.holes.map((h) => [h.id, h]));
    return this.pieces
      .filter((p) => !!p.holeId)
      .map((p) => {
        const h = holeById.get(p.holeId);
        return {
          pieceId: p.id,
          pieceType: p.type,
          holeId: p.holeId,
          cellId: h?.cellId ?? null,
          holeType: h?.type ?? null,
          sideIndex: h?.sideIndex ?? null,
        };
      });
  }

  _applyPlacementsToScene(placements) {
    if (!Array.isArray(placements)) placements = [];

    // Reset holes/pieces
    for (const h of this.holes) h.occupied = false;
    for (const p of this.pieces) {
      p.holeId = null;
      p.mesh.position.copy(p.home);
    }

    const pieceById = new Map(this.pieces.map((p) => [p.id, p]));
    const holeById = new Map(this.holes.map((h) => [h.id, h]));

    for (const pl of placements) {
      const piece = pieceById.get(pl.pieceId);
      if (!piece) continue;

      // Hole ID en Three: `${cellId}:${type}:${sideIndex ?? 'c'}`
      const sid = pl.holeType === 'side' ? pl.sideIndex : 'c';
      const holeId = `${pl.cellId}:${pl.holeType}:${sid}`;
      const hole = holeById.get(holeId);
      if (!hole) continue;
      if (hole.occupied) continue;
      
      const pegH = this.boardCfg.hexHeight * 0.85; //Aquí checar
      piece.mesh.position.set(hole.position.x, hole.position.y - pegH, hole.position.z);
      hole.occupied = true;
      piece.holeId = hole.id;
    }

    // Asegura que el pool respete el contador (solo 1 pieza visible si hay remaining)
    this._syncPoolsFromCounts();
  }

  setInitialPlacements(placements) {
    this.initialPlacements = Array.isArray(placements) ? placements : [];
  }

  /**
   * Limpia todas las colocaciones actuales (tablero vacío).
   * - Resetea holes.occupied
   * - Devuelve piezas a su posición home
   */
  clearPlacements() {
    this.initialPlacements = [];
    if (!this.holes?.length || !this.pieces?.length) return;
    this._applyPlacementsToScene([]);
  }

  mount() {
    if (this.isMounted) return;

    // Scene
    this.scene = new THREE.Scene();
    //this.scene.background = new THREE.Color(0x0b1020); //Aquí cambia el color del fondo 3d

      new THREE.TextureLoader().load(
    "assets/images/background2.png",
    (tex) => {
      // sRGB según versión de Three
      if ("colorSpace" in tex) tex.colorSpace = THREE.SRGBColorSpace;
      else tex.encoding = THREE.sRGBEncoding;

      this.scene.background = tex;
      console.log("[ThreeBoardMode] Background loaded:", "assets/images/background2.png");
    },
    undefined,
    (err) => {
      console.error("[ThreeBoardMode] Background FAILED to load:", "assets/images/background2.png", err);
    }
  );

    // Fondo 3D con imagen fija (diagnóstico + ruta robusta con Vite BASE_URL)
    const base = (import.meta?.env?.BASE_URL ?? '/');
    const bgUrl = `${base.endsWith('/') ? base : base + '/'}assets/images/background2.png`;

    new THREE.TextureLoader().load(
      bgUrl,
      (bgTexture) => {
        // Ajuste sRGB (según versión de Three)
        if ("colorSpace" in bgTexture) bgTexture.colorSpace = THREE.SRGBColorSpace;
        else bgTexture.encoding = THREE.sRGBEncoding;

        this.scene.background = bgTexture;
        console.log('[ThreeBoardMode] Background loaded:', bgUrl);
      },
      undefined,
      (err) => {
        console.error('[ThreeBoardMode] Background FAILED to load:', bgUrl, err);
      }
    );

    // Camera (fija tipo tablero)
    const { width, height } = this._getSize();
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 5000);
    this.camera.position.set(0, 220, 320);
    this.camera.lookAt(0, 0, 0);

    // Lights
    const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 0.9);
    this.scene.add(hemi);

    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(120, 300, 180);
    this.scene.add(dir);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setClearAlpha(0);
    this.renderer.setClearColor(0x000000, 0); // <-- fuerza alpha 0 en el clear
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height);
    this.container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.background = "transparent"; // <-- fuerza CSS del canvas

    // Fondo fijo vía CSS usando la misma URL validada (bgUrl)
    this.container.style.backgroundImage = `url('${bgUrl}')`;
    this.container.style.backgroundSize = "cover";
    this.container.style.backgroundPosition = "center";
    this.container.style.backgroundRepeat = "no-repeat";

    // Interaction setup
    this.raycaster = new THREE.Raycaster();
    this.pointerNdc = new THREE.Vector2();
    this.renderer.domElement.style.touchAction = 'none';
    this.renderer.domElement.addEventListener('pointerdown', this._onPointerDown);
    this.renderer.domElement.addEventListener('dblclick', this._onDoubleClick);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);

    // Piso “sutil” para referencia
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 1.0, metalness: 0.0 }) //Aquí cambia el color de la Hex
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.02;
    this.scene.add(floor);

    // Carga + generación del tablero desde el JSON existente
    this._abort = new AbortController();
    this._loadAndBuildBoard({ signal: this._abort.signal }).catch((err) => {
      // Si se desmonta, es normal que aborte.
      if (err?.name === 'AbortError') return;
      // eslint-disable-next-line no-console
      console.error('[ThreeBoardMode] Failed building board:', err);
    });

    window.addEventListener('resize', this._onResize);
    this._tick();
  }

  unmount() {
    if (!this.isMounted) return;

    // Abortar cargas pendientes
    try {
      this._abort?.abort();
    } catch (_) {}
    this._abort = null;

    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    cancelAnimationFrame(this._raf);

    // Clean up scene objects
    if (this.scene) {
      this.scene.traverse((obj) => {
        // dispose geometries/materials
        if (obj.isMesh) {
          obj.geometry?.dispose?.();
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose?.());
          } else {
            obj.material?.dispose?.();
          }
        }
      });
    }

    // Remove renderer canvas
    if (this.renderer) {
      this.renderer.domElement?.removeEventListener?.('pointerdown', this._onPointerDown);
      this.renderer.domElement?.removeEventListener?.('dblclick', this._onDoubleClick);
      this.renderer.dispose();
      const canvas = this.renderer.domElement;
      if (canvas && canvas.parentElement) canvas.parentElement.removeChild(canvas);
    }

    this.renderer = null;
    this.scene = null;
    this.camera = null;

    this.boardGroup = null;
    this.holes = [];

    this.piecesGroup = null;
    this.pieces = [];
    this.boardCfg = null;
    this.raycaster = null;
    this.pointerNdc = null;
    this.dragState = null;

    // El preview alterna materiales (ok/bad). Solo uno está asignado al mesh a la vez,
    // así que aseguramos liberar ambos.
    if (this.snapPreview) {
      try {
        this.snapPreview.okMat?.dispose?.();
        this.snapPreview.badMat?.dispose?.();
      } catch (_) {}
    }
    this.snapPreview = null;

    // Contadores 3D
    if (this.counter3D) {
      for (const k of ['white', 'black']) {
        const obj = this.counter3D[k];
        if (!obj) continue;
        try {
          obj.texture?.dispose?.();
          obj.sprite?.material?.dispose?.();
        } catch (_) {}
      }
    }
    this.counter3D = null;
  }

  // =====================
  // Internal
  // =====================
  _getSize() {
    const rect = this.container.getBoundingClientRect();
    // fallback por si está oculto en el DOM
    return {
      width: Math.max(1, Math.floor(rect.width || window.innerWidth)),
      height: Math.max(1, Math.floor(rect.height || window.innerHeight)),
    };
  }

  _onResize() {
    if (!this.renderer || !this.camera) return;
    const { width, height } = this._getSize();
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  _tick() {
    this._raf = requestAnimationFrame(() => this._tick());
    if (!this.renderer || !this.scene || !this.camera) return;
    this.renderer.render(this.scene, this.camera);
  }

  // =====================
  // Board build (Paso 3)
  // =====================

  async _loadAndBuildBoard({ signal } = {}) {
    if (!this.scene) return;

    const res = await fetch('/boards/board_default.json', { signal });
    if (!res.ok) throw new Error(`Failed to load board_default.json (${res.status})`);
    const config = await res.json();

    // Si ya se desmontó mientras se cargaba
    if (!this.scene) return;

    this._buildBoardFromConfig(config);

    // Si ya se desmontó mientras se construía
    if (!this.scene) return;

    // Genera pool de piezas desde el JSON existente
    await this._loadAndBuildPieces({ signal });
  }

  async _loadAndBuildPieces({ signal } = {}) {
    if (!this.scene || !this.boardGroup || !this.boardCfg) return;

    const res = await fetch('/pieces/pieces_default.json', { signal });
    if (!res.ok) throw new Error(`Failed to load pieces_default.json (${res.status})`);
    const piecesCfg = await res.json();
    if (!this.scene) return;

    this._buildPiecesFromConfig(piecesCfg);
  }

  _buildBoardFromConfig(config) {
    if (!this.scene) return;

    // Limpia previo
    if (this.boardGroup) {
      this.scene.remove(this.boardGroup);
      this.boardGroup = null;
      this.holes = [];
    }

    const sideLength = config?.hex?.sideLength ?? 50;
    const nodeRadius = config?.nodes?.radius ?? 7;
    const nodeMargin = config?.nodes?.margin ?? 5;
    const radius = config?.generate?.radius ?? 3;

    // Altura del Hex ~ diámetro del Hueco (según tu decisión)
    const hexHeight = nodeRadius * 2;

    this.boardCfg = { sideLength, nodeRadius, nodeMargin, radius, hexHeight };

    const group = new THREE.Group();
    group.name = 'Board3D';

    const hexColor = this._parseHexColor(config?.hex?.fillColor ?? '#1b1b1b', 0x1b1b1b);
    const mat = new THREE.MeshStandardMaterial({
      color: hexColor,
      roughness: 0.85,
      metalness: 0.0,
    });

    // Una sola geometría reutilizable (misma forma/holes para cada celda)
    const hexGeo = this._createHexExtrudeGeometry({
      sideLength,
      nodeRadius,
      nodeMargin,
      height: hexHeight,
    });

    // Generación igual que en Board.js (axial coords)
    for (let q = -radius; q <= radius; q++) {
      for (let r = -radius; r <= radius; r++) {
        if (Math.abs(q + r) <= radius) {
          const { x, z } = this._axialToWorldXZ(q, r, sideLength);
          const cellId = `${q},${r}`;

          const mesh = new THREE.Mesh(hexGeo, mat);
          mesh.castShadow = false;
          mesh.receiveShadow = true;
          mesh.position.set(x, 0, z);
          mesh.userData = { cellId, q, r };
          group.add(mesh);

          // Calcula “Huecos” lógicos (slots) para snap futuro
          const localHolePoints = this._computeHolePoints2D({ sideLength, nodeRadius, nodeMargin });
          for (const hp of localHolePoints) {
            // Después de la rotación, la “cara superior” está en +Y (hexHeight)
            const topY = hexHeight;
            const pos = new THREE.Vector3(x + hp.x, topY, z + hp.y);
            const id = `${cellId}:${hp.type}:${hp.sideIndex ?? 'c'}`;

            this.holes.push({
              id,
              cellId,
              type: hp.type,
              sideIndex: hp.sideIndex,
              position: pos,
              occupied: false,
            });
          }
        }
      }
    }

    // Centrar el tablero en (0,0,0)
    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    group.position.sub(center);

    // Queremos que el tablero “se sienta” sobre el piso, así que lo subimos para que la base no quede bajo 0
    // (Tras centrar, el y-center estará ~hexHeight/2)
    group.position.y += hexHeight / 2;

    // IMPORTANT: Ajustar posiciones de holes al shift aplicado al grupo
    for (const h of this.holes) {
      h.position.add(group.position);
    }

    // Asegura el indicador visual de snap
    this._ensureSnapPreview();

    this.boardGroup = group;
    this.scene.add(group);

    // Re-encuadrar cámara fijo tipo mesa
    this._frameCameraToObject(group);

    // Bounds en XZ (para determinar si soltó “fuera del tablero”)
    const bb = new THREE.Box3().setFromObject(group);
    this.boardBoundsXZ = {
      minX: bb.min.x,
      maxX: bb.max.x,
      minZ: bb.min.z,
      maxZ: bb.max.z,
    };
  }

  // =====================
  // Pieces build (Paso 4)
  // =====================

  _buildPiecesFromConfig(piecesCfg) {
    if (!this.scene || !this.boardCfg) return;

    // Limpia previo
    if (this.piecesGroup) {
      this.scene.remove(this.piecesGroup);
      this.piecesGroup = null;
      this.pieces = [];
    }

    const { nodeRadius, hexHeight } = this.boardCfg;
    const rel = piecesCfg?.scale?.radiusRelativeToNode ?? 1.2;

    // Dimensiones de pieza
    const holeR = nodeRadius;
    const pegR = holeR * 0.88; // tolerancia
    const headR = holeR * rel;
    const headH = holeR * 0.7;
    const pegH = Math.max(hexHeight * 0.85, holeR * 1.2);
    const totalH = pegH + headH;

    // Materiales
    const whiteMat = new THREE.MeshStandardMaterial({
      color: this._parseHexColor(piecesCfg?.types?.white?.fillColor ?? '#f2f2f2', 0xf2f2f2),
      roughness: 0.6,
      metalness: 0.05,
    });
    const blackMat = new THREE.MeshStandardMaterial({
      color: this._parseHexColor(piecesCfg?.types?.black?.fillColor ?? '#1a1a1a', 0x1a1a1a),
      roughness: 0.6,
      metalness: 0.05,
    });

    const group = new THREE.Group();
    group.name = 'Pieces3D';

    const makePiece = (type, mat) => {
      const g = new THREE.Group();

      // Peg (entra en el hueco)
      const peg = new THREE.Mesh(new THREE.CylinderGeometry(pegR, pegR, pegH, 28), mat);
      peg.position.y = pegH / 2;
      peg.castShadow = true;
      peg.receiveShadow = false;
      g.add(peg);

      // Head (cabeza más ancha)
      const head = new THREE.Mesh(new THREE.CylinderGeometry(headR, headR, headH, 32), mat);
      head.position.y = pegH + headH / 2;
      head.castShadow = true;
      head.receiveShadow = false;
      g.add(head);

      g.userData = { kind: 'piece', type };
      return { obj: g, totalH, headH, pegH };
    };

    // Cantidad total de piezas físicas disponibles por color.
    // Mantener 21 en escena nos permite persistir por pieceId y operar modo “stamp”
    // (solo 1 visible en pool según remaining).
    const counts = {
      white: 21,
      black: 21,
    };

    // Posiciones “pool” a los lados del tablero
    const boardBox = this.boardGroup ? new THREE.Box3().setFromObject(this.boardGroup) : new THREE.Box3();
    const size = boardBox.getSize(new THREE.Vector3());
    const leftX = boardBox.min.x - Math.max(80, size.x * 0.15);
    const rightX = boardBox.max.x + Math.max(80, size.x * 0.15);
    const baseY = 0;
    // Pool “stack” (todas las piezas comparten el mismo home por color)
    const poolZMid = (boardBox.min.z + boardBox.max.z) / 2;

    // Contadores 3D (sprites) cerca de cada pool
    this._ensure3DCounters({ leftX, rightX, z: poolZMid, boardSize: size });

    for (let i = 0; i < counts.white; i++) {
      const { obj } = makePiece('white', whiteMat);
      const x = leftX;
      const y = baseY;
      const z = poolZMid;
      obj.position.set(x, y, z);
      group.add(obj);
      const id = `white_${i + 1}`;
      this.pieces.push({ id, type: 'white', mesh: obj, home: new THREE.Vector3(x, y, z), holeId: null });
    }

    for (let i = 0; i < counts.black; i++) {
      const { obj } = makePiece('black', blackMat);
      const x = rightX;
      const y = baseY;
      const z = poolZMid;
      obj.position.set(x, y, z);
      group.add(obj);
      const id = `black_${i + 1}`;
      this.pieces.push({ id, type: 'black', mesh: obj, home: new THREE.Vector3(x, y, z), holeId: null });
    }

    this.piecesGroup = group;
    this.scene.add(group);

    // Aplica placements existentes (venidos del 2D/localStorage)
    this._applyPlacementsToScene(this.initialPlacements);

    // Pool modo “stamp” (solo 1 visible por color)
    this._syncPoolsFromCounts();
  }

  _syncPoolsFromCounts() {
    // Si aún no se han creado piezas, nada.
    if (!this.pieces?.length) return;

    const counts = pieceCountState.getCounts();
    const remainingByType = {
      white: Math.max(0, Math.floor(Number(counts.whiteRemaining) || 0)),
      black: Math.max(0, Math.floor(Number(counts.blackRemaining) || 0)),
    };

    /** @param {'white'|'black'} type */
    const syncOne = (type) => {
      const remaining = remainingByType[type];
      const poolPieces = this.pieces.filter((p) => p.type === type && !p.holeId);

      // Oculta todas las piezas que estén en pool
      for (const p of poolPieces) {
        p.mesh.visible = false;
        // Asegura que sigan “apiladas” en home
        p.mesh.position.copy(p.home);
      }

      // Si hay piezas restantes, muestra solo 1 (la primera disponible)
      if (remaining > 0 && poolPieces.length) {
        poolPieces[0].mesh.visible = true;
      }
    };

    syncOne('white');
    syncOne('black');

    // Actualiza texto del contador 3D
    this._update3DCounters(remainingByType);
  }

  _ensure3DCounters({ leftX, rightX, z, boardSize }) {
    if (!this.scene) return;
    if (this.counter3D) {
      // Asegura posición si el tablero cambió de tamaño
      try {
        const y = 55;
        this.counter3D.white?.sprite?.position?.set(leftX, y, z);
        this.counter3D.black?.sprite?.position?.set(rightX, y, z);
      } catch (_) {}
      return;
    }

    const make = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      const texture = new THREE.CanvasTexture(canvas);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
      const sprite = new THREE.Sprite(mat);
      sprite.renderOrder = 1000;
      return { sprite, canvas, ctx, texture };
    };

    this.counter3D = {
      white: make(),
      black: make(),
    };

    // Posición y escala
    const y = 55;
    this.counter3D.white.sprite.position.set(leftX, y, z);
    this.counter3D.black.sprite.position.set(rightX, y, z);

    const sx = Math.max(50, (boardSize?.x || 300) * 0.14);
    const sy = Math.max(22, (boardSize?.x || 300) * 0.06);
    this.counter3D.white.sprite.scale.set(sx, sy, 1);
    this.counter3D.black.sprite.scale.set(sx, sy, 1);

    this.scene.add(this.counter3D.white.sprite);
    this.scene.add(this.counter3D.black.sprite);

    // Primer render
    const counts = pieceCountState.getCounts();
    this._update3DCounters({
      white: Math.max(0, Math.floor(Number(counts.whiteRemaining) || 0)),
      black: Math.max(0, Math.floor(Number(counts.blackRemaining) || 0)),
    });
  }

  _drawCounter({ ctx, canvas, title, value, isDark }) {
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Fondo semitransparente
    ctx.fillStyle = isDark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.18)';
    const r = 18;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(w, 0, w, h, r);
    ctx.arcTo(w, h, 0, h, r);
    ctx.arcTo(0, h, 0, 0, r);
    ctx.arcTo(0, 0, w, 0, r);
    ctx.closePath();
    ctx.fill();

    // Borde
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Texto
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = 'bold 28px Arial';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, 18, h / 2);

    ctx.font = 'bold 44px Arial';
    const txt = String(value);
    const tw = ctx.measureText(txt).width;
    ctx.fillText(txt, w - 18 - tw, h / 2);
  }

  _update3DCounters(remainingByType) {
    if (!this.counter3D) return;
    try {
      const w = remainingByType?.white;
      const b = remainingByType?.black;
      if (this.counter3D.white) {
        this._drawCounter({ ctx: this.counter3D.white.ctx, canvas: this.counter3D.white.canvas, title: 'BLANCAS', value: w, isDark: false });
        this.counter3D.white.texture.needsUpdate = true;
      }
      if (this.counter3D.black) {
        this._drawCounter({ ctx: this.counter3D.black.ctx, canvas: this.counter3D.black.canvas, title: 'NEGRAS', value: b, isDark: true });
        this.counter3D.black.texture.needsUpdate = true;
      }
    } catch (_) {
      // ignore
    }
  }

  _isInsideBoardXZ(x, z) {
    if (!this.boardBoundsXZ || !this.boardCfg) return false;
    // Margen para que “cerca del borde” aún se considere dentro.
    const pad = (this.boardCfg.nodeRadius ?? 7) * 2.5;
    return (
      x >= this.boardBoundsXZ.minX - pad &&
      x <= this.boardBoundsXZ.maxX + pad &&
      z >= this.boardBoundsXZ.minZ - pad &&
      z <= this.boardBoundsXZ.maxZ + pad
    );
  }

  // =====================
  // Snap preview (Paso 5)
  // =====================

  _ensureSnapPreview() {
    if (!this.scene || !this.boardCfg) return;
    if (this.snapPreview) return;

    const { nodeRadius, hexHeight } = this.boardCfg;
    const inner = Math.max(0.5, nodeRadius * 0.55);
    const outer = Math.max(inner + 0.25, nodeRadius * 0.95);

    const geo = new THREE.RingGeometry(inner, outer, 48);
    // RingGeometry queda en XY; lo acostamos en XZ.
    geo.rotateX(-Math.PI / 2);

    const okMat = new THREE.MeshBasicMaterial({
      color: 0x22ff77,
      transparent: true,
      opacity: 0.75,
      depthTest: false,
    });
    const badMat = new THREE.MeshBasicMaterial({
      color: 0xff3355,
      transparent: true,
      opacity: 0.75,
      depthTest: false,
    });

    const mesh = new THREE.Mesh(geo, okMat);
    mesh.visible = false;
    mesh.position.set(0, hexHeight + 0.25, 0);
    mesh.renderOrder = 999;

    this.scene.add(mesh);
    this.snapPreview = { mesh, okMat, badMat };
  }

  _hideSnapPreview() {
    if (!this.snapPreview) return;
    this.snapPreview.mesh.visible = false;
  }

  _updateSnapPreview(piece) {
    if (!this.boardCfg) return;
    this._ensureSnapPreview();
    if (!this.snapPreview) return;

    const { nodeRadius, hexHeight } = this.boardCfg;
    const threshold = nodeRadius * 2.2;

    // Hueco más cercano (libre u ocupado) para feedback visual
    let best = null;
    let bestD = Infinity;
    for (const h of this.holes) {
      const dx = piece.mesh.position.x - h.position.x;
      const dz = piece.mesh.position.z - h.position.z;
      const d = Math.hypot(dx, dz);
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }

    if (!best || bestD > threshold) {
      this._hideSnapPreview();
      return;
    }

    // Material: verde si está libre, rojo si está ocupado
    this.snapPreview.mesh.material = best.occupied ? this.snapPreview.badMat : this.snapPreview.okMat;
    this.snapPreview.mesh.position.set(best.position.x, hexHeight + 0.25, best.position.z);
    this.snapPreview.mesh.visible = true;
  }

  // =====================
  // Interaction (Paso 4)
  // =====================

  _eventToNdc(ev) {
    if (!this.renderer || !this.pointerNdc) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);
    this.pointerNdc.set(x, y);
    return this.pointerNdc;
  }

  _findPieceByObject(obj) {
    // Subimos hasta encontrar el Group que tiene userData.kind = 'piece'
    let cur = obj;
    while (cur) {
      if (cur.userData?.kind === 'piece') break;
      cur = cur.parent;
    }
    if (!cur) return null;
    return this.pieces.find((p) => p.mesh === cur) || null;
  }

  _onPointerDown(ev) {
    if (!this.scene || !this.camera || !this.raycaster) return;
    if (!this.piecesGroup) return;
    const ndc = this._eventToNdc(ev);
    if (!ndc) return;

    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.piecesGroup.children, true);
    if (!hits.length) return;

    const piece = this._findPieceByObject(hits[0].object);
    if (!piece) return;

    // No permitir agarrar piezas del pool si ya no hay remaining.
    // (Solo se permite mover piezas ya colocadas)
    if (!piece.holeId) {
      const counts = pieceCountState.getCounts();
      const remaining = piece.type === 'white' ? Number(counts.whiteRemaining) : Number(counts.blackRemaining);
      if (!Number.isFinite(remaining) || remaining <= 0) return;
    }

    // Si estaba ocupando un hueco, liberarlo (lo re-ocupamos al soltar si no hace snap a otro)
    const prevHoleId = piece.holeId;
    if (prevHoleId) {
      const hole = this.holes.find((h) => h.id === prevHoleId);
      if (hole) hole.occupied = false;
      piece.holeId = null;
    }

    // Drag plane (paralelo al tablero)
    const dragPlaneY = this._getDragPlaneY();
    const hitPoint = hits[0].point.clone();
    const grabOffset = hitPoint.sub(piece.mesh.position).clone();

    this.dragState = { pieceId: piece.id, grabOffset, dragPlaneY, prevHoleId: prevHoleId || null };

    // Preview inmediato
    this._updateSnapPreview(piece);
    ev.preventDefault?.();
  }

  _onDoubleClick(ev) {
    if (!this.scene || !this.camera || !this.raycaster) return;
    if (!this.piecesGroup) return;
    if (this.dragState) return; // evita conflictos durante drag

    const ndc = this._eventToNdc(ev);
    if (!ndc) return;

    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.piecesGroup.children, true);
    if (!hits.length) return;

    const piece = this._findPieceByObject(hits[0].object);
    if (!piece) return;

    // Solo aplica a piezas colocadas en el tablero
    if (!piece.holeId) return;

    // Libera hueco
    const hole = this.holes.find((h) => h.id === piece.holeId);
    if (hole) hole.occupied = false;

    piece.holeId = null;
    piece.mesh.position.copy(piece.home);

    // Devuelve al pool (contador +1) y persiste
    const counts = pieceCountState.getCounts();
    if (piece.type === 'white') {
      pieceCountState.setCounts({ whiteRemaining: Math.min(21, (counts.whiteRemaining ?? 0) + 1) });
    } else {
      pieceCountState.setCounts({ blackRemaining: Math.min(21, (counts.blackRemaining ?? 0) + 1) });
    }

    // Re-sincroniza pool y contadores
    this._syncPoolsFromCounts();

    ev.preventDefault?.();
  }

  _onPointerMove(ev) {
    if (!this.dragState || !this.scene || !this.camera || !this.raycaster) return;
    const ndc = this._eventToNdc(ev);
    if (!ndc) return;

    const piece = this.pieces.find((p) => p.id === this.dragState.pieceId);
    if (!piece) return;

    this.raycaster.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.dragState.dragPlaneY);
    const out = new THREE.Vector3();
    const ok = this.raycaster.ray.intersectPlane(plane, out);
    if (!ok) return;

    piece.mesh.position.set(out.x - this.dragState.grabOffset.x, this.dragState.dragPlaneY, out.z - this.dragState.grabOffset.z);

    this._updateSnapPreview(piece);
    ev.preventDefault?.();
  }

  _onPointerUp(ev) {
    if (!this.dragState) return;
    const piece = this.pieces.find((p) => p.id === this.dragState.pieceId);
    if (!piece) {
      this.dragState = null;
      this._hideSnapPreview();
      return;
    }

    const prevHoleId = this.dragState.prevHoleId;
    const cameFromPlaced = !!prevHoleId;
    const snapped = this._trySnapPiece(piece);

    if (snapped) {
      // Si venía del pool (no estaba colocado), consume 1 del contador.
      if (!cameFromPlaced) {
        const counts = pieceCountState.getCounts();
        if (piece.type === 'white') {
          pieceCountState.setCounts({ whiteRemaining: Math.max(0, (counts.whiteRemaining ?? 0) - 1) });
        } else {
          pieceCountState.setCounts({ blackRemaining: Math.max(0, (counts.blackRemaining ?? 0) - 1) });
        }
      }
      this._syncPoolsFromCounts();
    } else {
      // No hizo snap.
      if (cameFromPlaced) {
        // Si soltó fuera del tablero, “elimina” del tablero y devuelve al pool (contador +1)
        const inside = this._isInsideBoardXZ(piece.mesh.position.x, piece.mesh.position.z);
        if (!inside) {
          // Devuelve a pool
          piece.mesh.position.copy(piece.home);
          piece.holeId = null;

          const counts = pieceCountState.getCounts();
          if (piece.type === 'white') {
            pieceCountState.setCounts({ whiteRemaining: Math.min(21, (counts.whiteRemaining ?? 0) + 1) });
          } else {
            pieceCountState.setCounts({ blackRemaining: Math.min(21, (counts.blackRemaining ?? 0) + 1) });
          }

          this._syncPoolsFromCounts();
        } else {
          // Si soltó dentro del tablero pero no cerca de hueco, regresa a su hueco anterior
          const hole = this.holes.find((h) => h.id === prevHoleId);
          if (hole) {
            const pegH = this.boardCfg.hexHeight * 0.85; //Aquí checar
            piece.mesh.position.set(hole.position.x, hole.position.y - pegH, hole.position.z);
            hole.occupied = true;
            piece.holeId = hole.id;
          } else {
            piece.mesh.position.copy(piece.home);
          }
        }
      } else {
        // Venía del pool: regresa al pool (no consume)
        piece.mesh.position.copy(piece.home);
        this._syncPoolsFromCounts();
      }
    }

    this.dragState = null;
    this._hideSnapPreview();
    ev.preventDefault?.();
  }

  _getDragPlaneY() {
    // Altura donde “flota” la pieza mientras arrastras.
    // La pieza está modelada con su origen en la base del peg (y=0).
    // Para que no atraviese visualmente el tablero durante el drag,
    // la elevamos un poco.
    const hexHeight = this.boardCfg?.hexHeight ?? 14;
    // Un poco más alto para que se sienta “levantada” y evite colisiones visuales.
    return Math.max(6, hexHeight * 0.55);
  }

  _trySnapPiece(piece) {
    if (!this.boardCfg) return false;
    const { nodeRadius } = this.boardCfg;
    const threshold = nodeRadius * 2.2; // “generoso” como en 2D

    // Buscar hueco libre más cercano (en XZ)
    let best = null;
    let bestD = Infinity;
    for (const h of this.holes) {
      if (h.occupied) continue;
      const dx = piece.mesh.position.x - h.position.x;
      const dz = piece.mesh.position.z - h.position.z;
      const d = Math.hypot(dx, dz);
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }

    if (!best || bestD > threshold) return false;

    // Snap
    // Al “encajar”, la base del peg queda a nivel de la parte superior del Hex (Y del Hueco).
    const pegH = this.boardCfg.hexHeight * 0.85; // mismo cálculo que usas al crear la pieza
    piece.mesh.position.set(best.position.x, best.position.y - pegH, best.position.z);
    best.occupied = true;
    piece.holeId = best.id;
    return true;
  }

  _frameCameraToObject(obj3d) {
    if (!this.camera) return;

    const box = new THREE.Box3().setFromObject(obj3d);
    const size = box.getSize(new THREE.Vector3());
    const maxXZ = Math.max(size.x, size.z);

    // Altura base (igual que antes, para que encuadre bien el tablero)
    const height = Math.max(220, maxXZ * 0.9); //Aquí se cambia el tamaño del tablero

    // Vista casi cenital: 10° de inclinación desde arriba (vertical)
    const tiltDeg = 40; //Aquí se cambia la inclinación del tablero
    const tiltRad = (tiltDeg * Math.PI) / 180;
    const dist = Math.max(1, height * Math.tan(tiltRad));

    this.camera.position.set(0, height, dist);
    this.camera.lookAt(0, -100, 0); //Aquí se cambia para mover el tablero
    this.camera.updateProjectionMatrix();
  }

  _axialToWorldXZ(q, r, sideLength) {
    // igual que Board.js pero en XZ (y arriba)
    const s = sideLength;
    const x = s * (3 / 2) * q;
    const z = s * Math.sqrt(3) * (r + q / 2);
    return { x, z };
  }

  _parseHexColor(str, fallbackInt = 0xffffff) {
    if (typeof str !== 'string') return fallbackInt;
    const m = str.trim().match(/^#?([0-9a-fA-F]{6})$/);
    if (!m) return fallbackInt;
    return parseInt(m[1], 16);
  }

  _createHexExtrudeGeometry({ sideLength, nodeRadius, nodeMargin, height }) {
    // 1) Shape base (hex regular flat-top)
    const verts = this._computeHexVerticesFlatTop2D(0, 0, sideLength);
    const shape = new THREE.Shape();
    shape.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i++) shape.lineTo(verts[i].x, verts[i].y);
    shape.closePath();

    // 2) Holes: 1 centro + 6 laterales
    const holePoints = this._computeHolePoints2D({ sideLength, nodeRadius, nodeMargin });
    for (const hp of holePoints) {
      const hole = new THREE.Path();
      hole.absellipse(hp.x, hp.y, nodeRadius, nodeRadius, 0, Math.PI * 2, false, 0);
      shape.holes.push(hole);
    }

    // 3) Extrude (depth = height)
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: height,
      bevelEnabled: false,
      curveSegments: 32,
    });

    // ExtrudeGeometry extruye en +Z. Rotamos para que la altura sea +Y y el tablero quede en XZ.
    geo.rotateX(-Math.PI / 2);

    // Centro mejor para transformaciones
    geo.computeVertexNormals();
    return geo;
  }

  _computeHexVerticesFlatTop2D(cx, cy, sideLength) {
    const R = sideLength;
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 180) * (60 * i);
      pts.push({ x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle) });
    }
    return pts;
  }

  _computeHolePoints2D({ sideLength, nodeRadius, nodeMargin }) {
    // Replica la lógica de HexCell para alinear sideIndex y distancias
    const verts = this._computeHexVerticesFlatTop2D(0, 0, sideLength);
    const mids = [];
    for (let i = 0; i < 6; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % 6];
      mids.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }

    const apothem = sideLength * (Math.sqrt(3) / 2);
    const offset = apothem - nodeMargin - nodeRadius;

    /** @type {Array<{x:number,y:number,type:'center'|'side',sideIndex:(number|null)}>} */
    const out = [];

    // centro
    out.push({ x: 0, y: 0, type: 'center', sideIndex: null });

    // lados
    for (let i = 0; i < 6; i++) {
      const mid = mids[i];
      const len = Math.hypot(mid.x, mid.y) || 1;
      const dirx = mid.x / len;
      const diry = mid.y / len;
      out.push({
        x: dirx * offset,
        y: diry * offset,
        type: 'side',
        sideIndex: i,
      });
    }

    return out;
  }
}
