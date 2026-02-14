import * as THREE from 'three';

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

    /**
     * Huecos (slots) generados por el tablero 3D.
     * Cada elemento representa un “Hueco” lógico del juego.
     *
     * @type {Array<{ id: string, cellId: string, type: 'center'|'side', sideIndex: (number|null), position: THREE.Vector3, occupied: boolean }>} */
    this.holes = [];

    /** @type {AbortController | null} */
    this._abort = null;
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

      piece.mesh.position.set(hole.position.x, 0, hole.position.z);
      hole.occupied = true;
      piece.holeId = hole.id;
    }
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
    this.scene.background = new THREE.Color(0x0f0f10);

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
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height);
    this.container.appendChild(this.renderer.domElement);

    // Interaction setup
    this.raycaster = new THREE.Raycaster();
    this.pointerNdc = new THREE.Vector2();
    this.renderer.domElement.style.touchAction = 'none';
    this.renderer.domElement.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);

    // Piso “sutil” para referencia
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 1.0, metalness: 0.0 })
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

    const counts = {
      white: piecesCfg?.types?.white?.count ?? 21,
      black: piecesCfg?.types?.black?.count ?? 21,
    };

    // Posiciones “pool” a los lados del tablero
    const boardBox = this.boardGroup ? new THREE.Box3().setFromObject(this.boardGroup) : new THREE.Box3();
    const size = boardBox.getSize(new THREE.Vector3());
    const leftX = boardBox.min.x - Math.max(80, size.x * 0.15);
    const rightX = boardBox.max.x + Math.max(80, size.x * 0.15);
    const baseY = 0;
    const poolZStart = boardBox.min.z;
    const poolZEnd = boardBox.max.z;
    const lanes = 7;
    const dz = (poolZEnd - poolZStart) / Math.max(1, lanes - 1);

    let idxW = 0;
    for (let i = 0; i < counts.white; i++) {
      const { obj } = makePiece('white', whiteMat);
      const z = poolZStart + (idxW % lanes) * dz;
      const x = leftX;
      const y = baseY;
      obj.position.set(x, y, z);
      group.add(obj);
      const id = `white_${i + 1}`;
      this.pieces.push({ id, type: 'white', mesh: obj, home: new THREE.Vector3(x, y, z), holeId: null });
      idxW++;
    }

    let idxB = 0;
    for (let i = 0; i < counts.black; i++) {
      const { obj } = makePiece('black', blackMat);
      const z = poolZStart + (idxB % lanes) * dz;
      const x = rightX;
      const y = baseY;
      obj.position.set(x, y, z);
      group.add(obj);
      const id = `black_${i + 1}`;
      this.pieces.push({ id, type: 'black', mesh: obj, home: new THREE.Vector3(x, y, z), holeId: null });
      idxB++;
    }

    this.piecesGroup = group;
    this.scene.add(group);

    // Aplica placements existentes (venidos del 2D/localStorage)
    this._applyPlacementsToScene(this.initialPlacements);
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

    const snapped = this._trySnapPiece(piece);
    if (!snapped) {
      // Si venía de un Hueco, regresa a ese hueco (no pierde estado). Si venía del pool, regresa al pool.
      const prevHoleId = this.dragState.prevHoleId;
      if (prevHoleId) {
        const hole = this.holes.find((h) => h.id === prevHoleId);
        if (hole) {
          piece.mesh.position.set(hole.position.x, 0, hole.position.z);
          hole.occupied = true;
          piece.holeId = hole.id;
        } else {
          piece.mesh.position.copy(piece.home);
        }
      } else {
        piece.mesh.position.copy(piece.home);
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
    // Al “encajar”, la base del peg queda a nivel de la base del tablero (y=0)
    // para que el peg atraviese el hex y la cabeza quede arriba.
    piece.mesh.position.set(best.position.x, 0, best.position.z);
    best.occupied = true;
    piece.holeId = best.id;
    return true;
  }

  _frameCameraToObject(obj3d) {
    if (!this.camera) return;

    const box = new THREE.Box3().setFromObject(obj3d);
    const size = box.getSize(new THREE.Vector3());
    const maxXZ = Math.max(size.x, size.z);

    // Cámara fija inclinada (tipo “juego de mesa”)
    const dist = Math.max(320, maxXZ * 1.25);
    const height = Math.max(220, maxXZ * 0.9);

    this.camera.position.set(0, height, dist);
    this.camera.lookAt(0, 0, 0);
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
