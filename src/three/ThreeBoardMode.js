import * as THREE from 'three';

import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
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
     * Piezas 3D activas (solo colocadas en huecos; sin pool).
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
     * Texturas cargadas para la cara superior de los Hex (aleatorias).
     * @type {THREE.Texture[] | null}
     */
    this.hexTopTextures = null;

     /** @type {LineMaterial | null} */
    this.hexOutlineMat = null;
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

    // Sin pool: ocultar piezas no colocadas
    this._hideUnplacedPieces();
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height);

    // Color space correcto (para que las texturas se vean como el PNG)
    if ('outputColorSpace' in this.renderer) this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    else this.renderer.outputEncoding = THREE.sRGBEncoding;

    // Para que el color no se “cocine” por tone mapping/exposure
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    // CLAVE: fondo transparente (para que se vea el background del contenedor si lo usas)
    this.renderer.setClearColor(0x000000, 0);

    this.container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.background = 'transparent';

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
      new THREE.MeshStandardMaterial({ 
        color: 0x334155,
        roughness: 1.0,
        metalness: 0.0,
        transparent: true,
        opacity: 0.05   // <-- Aquí se puede ajustar entre 0.05 y 0.3 si se quiere más o menos visible
      })
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
    if (this.hexOutlineMat) {
      this.hexOutlineMat.resolution.set(width, height);
    }
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

    // Texturas (cara superior) desde JSON: folder + manifest
    const textureFolder = config?.hex?.textureFolder ?? null;
    const textureList = Array.isArray(config?.hex?.textures) ? config.hex.textures : [];

    // --- Top overlay (SOLO cara superior) ---
    // topGeo se comparte, PERO la textura se clona por hex para poder offset aleatorio
    let topGeo = null;

    if (textureFolder && textureList.length) {
      const base = (import.meta?.env?.BASE_URL ?? '/');
      const folder = textureFolder.startsWith('/') ? textureFolder.slice(1) : textureFolder;
      const loader = new THREE.TextureLoader();

      this.hexTopTextures = textureList
        .filter((name) => typeof name === 'string' && name.trim().length)
        .map((name) => {
          const file = name.startsWith('/') ? name.slice(1) : name;
          const url = `${base.endsWith('/') ? base : base + '/'}${folder}${folder.endsWith('/') ? '' : '/'}${file}`;
          
          const tex = loader.load(url);
          if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
          else tex.encoding = THREE.sRGBEncoding;

          // No configurar wrap/repeat/mipmaps aquí.
          // Aquí solo dejamos la textura "limpia" y hacemos calidad.
          tex.wrapS = THREE.ClampToEdgeWrapping;
          tex.wrapT = THREE.ClampToEdgeWrapping;

          tex.generateMipmaps = true;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.magFilter = THREE.LinearFilter;

          if (this.renderer?.capabilities?.getMaxAnisotropy) {
            tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
          }

          tex.needsUpdate = true;

          // Mejora fuerte en ángulos
          if (this.renderer?.capabilities?.getMaxAnisotropy) {
            tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
          }

          return tex;
        });

      if (this.hexTopTextures.length) {
        // Shape del hex (CON holes, para no tapar los Huecos)
        const vertsTop = this._computeHexVerticesFlatTop2D(0, 0, sideLength);
        const topShape = new THREE.Shape();
        topShape.moveTo(vertsTop[0].x, vertsTop[0].y);
        for (let i = 1; i < vertsTop.length; i++) topShape.lineTo(vertsTop[i].x, vertsTop[i].y);
        topShape.closePath();

        // Misma distribución de Huecos que el Hex superior
        const holePointsTop = this._computeHolePoints2D({ sideLength, nodeRadius, nodeMargin });
        for (const hp of holePointsTop) {
          const hole = new THREE.Path();
          hole.absellipse(hp.x, hp.y, nodeRadius, nodeRadius, 0, Math.PI * 2, false, 0);
          topShape.holes.push(hole);
        }

        // ShapeGeometry viene en XY; la rotamos para que quede en XZ.
        topGeo = new THREE.ShapeGeometry(topShape);
        topGeo.rotateX(-Math.PI / 2);

        // NORMALIZAR UVs (0..1) para que el PNG se vea fiel (sin estirarse/rararse)
        topGeo.computeBoundingBox();
        const bbTop = topGeo.boundingBox;
        if (bbTop) {
          const minX = bbTop.min.x, maxX = bbTop.max.x;
          const minZ = bbTop.min.z, maxZ = bbTop.max.z;

          const dx = Math.max(1e-6, maxX - minX);
          const dz = Math.max(1e-6, maxZ - minZ);

          const pos = topGeo.attributes.position;
          const uvs = new Float32Array(pos.count * 2);

          for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const z = pos.getZ(i);
            uvs[i * 2 + 0] = (x - minX) / dx; // U
            uvs[i * 2 + 1] = (z - minZ) / dz; // V
          }

          topGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
          topGeo.attributes.uv.needsUpdate = true;
        }

        topGeo.computeVertexNormals();
      }
    } else {
      this.hexTopTextures = null;
    }

    const outlineWidth3D = config?.hex?.outlineWidth3D ?? 2;
    const strokeColor = this._parseHexColor(config?.hex?.strokeColor ?? '#ffffff', 0xffffff);

    // Material Line2 (grosor real)
    this.hexOutlineMat = new LineMaterial({
      color: strokeColor,
      linewidth: outlineWidth3D, // en pixeles
    });

    // resolution inicial
    const w = this.container?.clientWidth ?? window.innerWidth;
    const h = this.container?.clientHeight ?? window.innerHeight;
    this.hexOutlineMat.resolution.set(w, h);

    // Geometría de contorno (HEX exterior). La reutilizamos para todas las celdas.
    const outlineVerts2D = this._computeHexVerticesFlatTop2D(0, 0, sideLength);
    const yOutline = hexHeight + 0.002; // un pelín arriba para evitar z-fighting con la tapa
    const outlinePositions = [];
    for (let i = 0; i < outlineVerts2D.length; i++) {
      outlinePositions.push(outlineVerts2D[i].x, yOutline, outlineVerts2D[i].y);
    }
    // cerrar loop repitiendo el primero
    outlinePositions.push(outlineVerts2D[0].x, yOutline, outlineVerts2D[0].y);

    const outlineGeo = new LineGeometry();
    outlineGeo.setPositions(outlinePositions);

    const baseHexColor = this._parseHexColor(
      config?.hex?.baseFillColor ?? '#151e2b',
      0x151e2b
    );
    const baseMat = new THREE.MeshStandardMaterial({
      color: baseHexColor,
      roughness: 0.85,
      metalness: 0.0,
    });

    // Una sola geometría reutilizable (capa superior CON Huecos)
    const hexGeo = this._createHexExtrudeGeometry({
      sideLength,
      nodeRadius,
      nodeMargin,
      height: hexHeight,
      withHoles: true,
    });

    // Capa base SIN Huecos (2x altura)
    const baseHeight = hexHeight * 2;
    const baseGeo = this._createHexExtrudeGeometry({
      sideLength,
      nodeRadius,
      nodeMargin,
      height: baseHeight,
      withHoles: false,
    });

    // Generación igual que en Board.js (axial coords)
    for (let q = -radius; q <= radius; q++) {
      for (let r = -radius; r <= radius; r++) {
        if (Math.abs(q + r) <= radius) {
          const { x, z } = this._axialToWorldXZ(q, r, sideLength);
          const cellId = `${q},${r}`;

          // Base (debajo, sólida)
          const baseMesh = new THREE.Mesh(baseGeo, baseMat);
          baseMesh.castShadow = false;
          baseMesh.receiveShadow = true;
          baseMesh.position.set(x, -baseHeight - 0.001, z); // evita z-fighting con el Hex superior
          baseMesh.userData = { cellId, q, r, isBase: true };
          group.add(baseMesh);

          // Hex superior (con Huecos)
          const mesh = new THREE.Mesh(hexGeo, mat);
          mesh.castShadow = false;
          mesh.receiveShadow = true;
          mesh.position.set(x, 0, z);
          mesh.userData = { cellId, q, r };
          group.add(mesh);

          // Textura aleatoria SOLO en la cara superior (overlay)
          if (topGeo && this.hexTopTextures && this.hexTopTextures.length) {
            const idx = Math.floor(Math.random() * this.hexTopTextures.length);

            // CLAVE: clonamos textura para poder offset distinto por Hex
            const srcTex = this.hexTopTextures[idx];
            const tex = srcTex.clone();
            tex.needsUpdate = true;

            // FIEL al PNG: sin zoom/recorte, sin offset aleatorio
            tex.wrapS = THREE.ClampToEdgeWrapping;
            tex.wrapT = THREE.ClampToEdgeWrapping;
            tex.repeat.set(1, 1);
            tex.offset.set(0, 0);

            // --- Quitar granulado (mipmaps + anisotropy) ---
            tex.generateMipmaps = true;
            tex.minFilter = THREE.LinearMipmapLinearFilter;
            tex.magFilter = THREE.LinearFilter;

            if (this.renderer?.capabilities?.getMaxAnisotropy) {
              tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
            }

            tex.needsUpdate = true;

            // Material unlit => colores casi iguales al PNG
            // Polygon offset para evitar “rayado” por z-fighting/precision en depth
            const topMat = new THREE.MeshBasicMaterial({
              map: tex,
              polygonOffset: true,
              polygonOffsetFactor: -2,
              polygonOffsetUnits: -2,
            });

            const topMesh = new THREE.Mesh(topGeo, topMat);
            topMesh.castShadow = false;
            topMesh.receiveShadow = false;

            // La ponemos apenas arriba de la tapa del hex para evitar z-fighting
            topMesh.position.set(x, hexHeight + 0.12, z);
            topMesh.userData = { cellId, q, r, isTopTexture: true, textureIndex: idx };
            group.add(topMesh);
          }

          // Outline SOLO para Hex superior
          const outline = new Line2(outlineGeo, this.hexOutlineMat);
          outline.computeLineDistances();
          outline.position.set(x, 0, z);
          outline.userData = { cellId, q, r, isOutline: true };
          group.add(outline);

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
              sideIndex: hp.sideIndex ?? null,
              position: pos,
            });
          }
        }
      }
    }

    // Centrar el tablero en (0,0,0) SOLO en XZ (dejamos Y tal cual para que el pedestal baje)
    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    group.position.x -= center.x;
    group.position.z -= center.z;

    // IMPORTANT: Ajustar posiciones de holes al shift aplicado al grupo (solo XZ)
    for (const h of this.holes) {
      h.position.x += group.position.x;
      h.position.z += group.position.z;
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

    // NUEVO: pieza "bw" (cabeza mitad negra / mitad blanca)
    const makePieceBW = () => {
      const g = new THREE.Group();

      // Peg (entra en el hueco) — neutro/oscuro para que no “pelee” con la cabeza
      const peg = new THREE.Mesh(new THREE.CylinderGeometry(pegR, pegR, pegH, 28), blackMat);
      peg.position.y = pegH / 2;
      peg.castShadow = true;
      peg.receiveShadow = false;
      g.add(peg);

      // Head mitad negra / mitad blanca (2 semicilindros)
      const headGeoA = new THREE.CylinderGeometry(headR, headR, headH, 32, 1, false, 0, Math.PI);
      const headGeoB = new THREE.CylinderGeometry(headR, headR, headH, 32, 1, false, Math.PI, Math.PI);

      const headA = new THREE.Mesh(headGeoA, blackMat);
      headA.position.y = pegH + headH / 2;
      headA.castShadow = true;
      headA.receiveShadow = false;

      const headB = new THREE.Mesh(headGeoB, whiteMat);
      headB.position.y = pegH + headH / 2;
      headB.castShadow = true;
      headB.receiveShadow = false;

      g.add(headA);
      g.add(headB);

      g.userData = { kind: 'piece', type: 'bw' };
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

    // NUEVO: crear 1 pieza bw y colocarla al inicio en el Hueco central del Hex central
    {
      const { obj } = makePieceBW();
      const id = 'bw_1';

      const centerHole = this.holes.find((h) => h.id === '0,0:center:c');
      if (centerHole && !centerHole.occupied) {
        obj.position.set(centerHole.position.x, centerHole.position.y - pegH, centerHole.position.z);
        centerHole.occupied = true;
        group.add(obj);

        this.pieces.push({
          id,
          type: 'bw',
          mesh: obj,
          home: new THREE.Vector3(obj.position.x, obj.position.y, obj.position.z),
          holeId: centerHole.id,
        });
      } else {
        // Fallback ultra seguro (no debería pasar): la deja “guardada” fuera del tablero
        const x = 0;
        const y = baseY;
        const z = poolZMid;
        obj.position.set(x, y, z);
        group.add(obj);

        this.pieces.push({ id, type: 'bw', mesh: obj, home: new THREE.Vector3(x, y, z), holeId: null });
      }
    }

    this.piecesGroup = group;

    this.piecesGroup = group;
    this.scene.add(group);

    // Aplica placements existentes (venidos del 2D/localStorage)
    this._applyPlacementsToScene(this.initialPlacements);

    // Sin pool: ocultar piezas no colocadas
    this._hideUnplacedPieces();
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

  // ============================
  // Sin pool: visibilidad piezas
  // ============================

  /**
   * Oculta (y “resetea” a home) todas las piezas que NO estén colocadas en un Hueco.
   * - white/black: solo visibles si tienen holeId.
   * - bw: siempre visible (aunque por algún fallback su holeId sea null).
   *
   * Nota: la selección por raycaster ya ignora meshes invisibles.
   */
  _hideUnplacedPieces() {
    if (!this.pieces?.length) return;

    for (const p of this.pieces) {
      const isBW = p.type === 'bw' || p.id === 'bw_1';
      const placed = !!p.holeId;
      const shouldShow = isBW || placed;

      if (!p.mesh) continue;

      p.mesh.visible = shouldShow;

      // Si no está colocada, la “guardamos” en home (fuera del tablero).
      if (!shouldShow && p.home) {
        p.mesh.position.copy(p.home);
      }
    }
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
    // Sin pool: solo se puede agarrar piezas ya colocadas (o bw).
    if (!piece.holeId && piece.type !== 'bw') return;

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
    // Sin pool: desactivado (antes devolvía piezas al pool).
    return;
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

    if (!snapped) {
      // Sin pool: si no hace snap, regresa al último hueco válido (si existe).
      if (cameFromPlaced) {
        const hole = this.holes.find((h) => h.id === prevHoleId);
        if (hole) {
          const pegH = this.boardCfg.hexHeight * 0.85;
          piece.mesh.position.set(hole.position.x, hole.position.y - pegH, hole.position.z);
          hole.occupied = true;
          piece.holeId = hole.id;
          piece.mesh.visible = true;
        } else {
          piece.mesh.position.copy(piece.home);
          piece.holeId = null;
        }
      } else {
        // (No debería ocurrir porque no permitimos agarrar piezas de pool), pero fallback seguro.
        piece.mesh.position.copy(piece.home);
        piece.holeId = null;
      }
    }

    // Oculta piezas no colocadas (sin pool)
    this._hideUnplacedPieces();

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
    const height = Math.max(220, maxXZ * 1); //Aquí se cambia el tamaño del tablero

    // Vista casi cenital: 10° de inclinación desde arriba (vertical)
    const tiltDeg = 40; //Aquí se cambia la inclinación del tablero
    const tiltRad = (tiltDeg * Math.PI) / 180;
    const dist = Math.max(1, height * Math.tan(tiltRad));

    this.camera.position.set(0, height, dist);
    this.camera.lookAt(0, -50, 0); //Aquí se cambia para mover el tablero
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

  _createHexExtrudeGeometry({ sideLength, nodeRadius, nodeMargin, height, withHoles = true }) {
    // 1) Shape base (hex regular flat-top)
    const verts = this._computeHexVerticesFlatTop2D(0, 0, sideLength);
    const shape = new THREE.Shape();
    shape.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i++) shape.lineTo(verts[i].x, verts[i].y);
    shape.closePath();

    // 2) Holes: 1 centro + 6 laterales (opcional)
    if (withHoles) {
      const holePoints = this._computeHolePoints2D({ sideLength, nodeRadius, nodeMargin });
      for (const hp of holePoints) {
        const hole = new THREE.Path();
        hole.absellipse(hp.x, hp.y, nodeRadius, nodeRadius, 0, Math.PI * 2, false, 0);
        shape.holes.push(hole);
      }
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
