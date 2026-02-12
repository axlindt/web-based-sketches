// world.js
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export function startEndlessMountains() {
  // ---------- renderer ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";
  document.body.appendChild(renderer.domElement);

  // ---------- scene ----------
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9aa0a6);
  scene.fog = new THREE.Fog(0x9aa0a6, 350, 3000);

  // ---------- camera ----------
  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    12000
  );
  camera.position.set(0, 260, 520);

  // ---------- controls ----------
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 120, 0);
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 80;
  controls.maxDistance = 2200;

  // ---------- lighting ----------
  const hemi = new THREE.HemisphereLight(0xe9f2ff, 0x2a2a2a, 0.75);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(650, 950, 350);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -1600;
  sun.shadow.camera.right = 1600;
  sun.shadow.camera.top = 1600;
  sun.shadow.camera.bottom = -1600;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 5200;
  sun.shadow.bias = -0.00015;
  scene.add(sun);

  // ---------- params ----------
  const SEED = 1337;

  const TILE_SIZE = 900;
  const RES = 200;
  const RING = 1; // 3x3 tiles

  const HEIGHT = 700;
  const BASE = -140;
  const SKIRT_DROP = 1600;

  // Sea
  const SEA_LEVEL = -40;
  const SEA_SIZE = 16000;
  const SEA_OPACITY = 0.96;

  // Terrain material (gray)
  const terrainMat = new THREE.MeshStandardMaterial({
    color: 0x6b7076,
    roughness: 1.0,
    metalness: 0.0,
  });

  // -----------------------------------------
  // Deterministic noise (no libs)
  // -----------------------------------------
  function hash2(i, j) {
    let h = i * 374761393 + j * 668265263 + SEED * 1442695041;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) / 4294967296;
  }
  const smoothstep = (t) => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;

  function valueNoise(x, y) {
    const xi = Math.floor(x),
      yi = Math.floor(y);
    const xf = x - xi,
      yf = y - yi;

    const v00 = hash2(xi, yi);
    const v10 = hash2(xi + 1, yi);
    const v01 = hash2(xi, yi + 1);
    const v11 = hash2(xi + 1, yi + 1);

    const u = smoothstep(xf);
    const v = smoothstep(yf);

    return lerp(lerp(v00, v10, u), lerp(v01, v11, u), v);
  }

  function fbm(x, y, octaves = 6, lac = 2.0, gain = 0.52) {
    let amp = 1.0,
      freq = 1.0,
      sum = 0.0,
      norm = 0.0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * (valueNoise(x * freq, y * freq) * 2 - 1);
      norm += amp;
      amp *= gain;
      freq *= lac;
    }
    return sum / norm; // ~[-1,1]
  }

  // ridged multifractal-ish
  const ridge = (n) => {
    n = 1.0 - Math.abs(n);
    return n * n;
  };

  function ridgedFbm(x, y, octaves = 7) {
    let amp = 1.0,
      freq = 1.0,
      sum = 0.0,
      norm = 0.0;
    for (let o = 0; o < octaves; o++) {
      const n = fbm(x * freq, y * freq, 1);
      sum += amp * ridge(n);
      norm += amp;
      amp *= 0.55;
      freq *= 2.05;
    }
    return sum / norm; // ~[0..1]
  }

  // Height function in world coords (x,z)
  function heightAt(x, z) {
    // lower => bigger features
    const s = 0.00115;

    const chain = ridgedFbm(x * s, z * s, 7);

    // directional strata to sharpen ridge lines
    const wx = x * 0.00105 + z * 0.0006;
    const wz = z * 0.0012 - x * 0.00045;
    const strata = ridgedFbm(wx * 1.75, wz * 1.75, 5);

    const m = chain * 0.8 + strata * 0.2;
    const shaped = Math.pow(m, 2.7); // steeper peaks

    return BASE + shaped * HEIGHT;
  }

  // -----------------------------------------
  // Ocean (follows camera)
  // -----------------------------------------
  const seaGeo = new THREE.PlaneGeometry(SEA_SIZE, SEA_SIZE, 220, 220);
  seaGeo.rotateX(-Math.PI / 2);

  const seaPos = seaGeo.attributes.position;
  const seaBase = new Float32Array(seaPos.count);
  for (let i = 0; i < seaPos.count; i++) seaBase[i] = seaPos.getY(i);

  const seaMat = new THREE.MeshStandardMaterial({
    color: 0x2f4e67,
    roughness: 0.25,
    metalness: 0.05,
    transparent: true,
    opacity: SEA_OPACITY,
  });

  const sea = new THREE.Mesh(seaGeo, seaMat);
  sea.position.y = SEA_LEVEL;
  sea.receiveShadow = true;
  scene.add(sea);

  // -----------------------------------------
  // Endless terrain tiles + skirts (hide underside)
  // -----------------------------------------
  function buildSkirtFromPlaneGeometry(planeGeo) {
    const skirtGeo = new THREE.BufferGeometry();
    const verts = [];
    const normals = [];

    function addWall(a, b) {
      const a2 = new THREE.Vector3(a.x, a.y - SKIRT_DROP, a.z);
      const b2 = new THREE.Vector3(b.x, b.y - SKIRT_DROP, b.z);

      verts.push(
        a.x, a.y, a.z,
        b.x, b.y, b.z,
        b2.x, b2.y, b2.z,

        a.x, a.y, a.z,
        b2.x, b2.y, b2.z,
        a2.x, a2.y, a2.z
      );

      const edge = new THREE.Vector3().subVectors(b, a);
      const up = new THREE.Vector3(0, 1, 0);
      const n = new THREE.Vector3().crossVectors(edge, up).normalize();
      for (let i = 0; i < 6; i++) normals.push(n.x, n.y, n.z);
    }

    const side = RES + 1;
    const pos = planeGeo.attributes.position;

    const get = (ix, iz) => {
      const idx = iz * side + ix;
      return new THREE.Vector3(pos.getX(idx), pos.getY(idx), pos.getZ(idx));
    };

    for (let ix = 0; ix < RES; ix++) addWall(get(ix, 0), get(ix + 1, 0));
    for (let ix = 0; ix < RES; ix++) addWall(get(ix + 1, RES), get(ix, RES));
    for (let iz = 0; iz < RES; iz++) addWall(get(0, iz + 1), get(0, iz));
    for (let iz = 0; iz < RES; iz++) addWall(get(RES, iz), get(RES, iz + 1));

    skirtGeo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    skirtGeo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    skirtGeo.computeBoundingSphere();

    const skirtMat = new THREE.MeshStandardMaterial({
      color: 0x585c61,
      roughness: 1.0,
      metalness: 0.0,
    });

    const skirtMesh = new THREE.Mesh(skirtGeo, skirtMat);
    skirtMesh.receiveShadow = true;
    return skirtMesh;
  }

  function buildTile(tileX, tileZ) {
    const geo = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE, RES, RES);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;

    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i);
      const lz = pos.getZ(i);
      const wx = lx + tileX * TILE_SIZE;
      const wz = lz + tileZ * TILE_SIZE;

      const y = Math.max(heightAt(wx, wz), SEA_LEVEL - 12);
      pos.setY(i, y);
    }

    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, terrainMat);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.position.set(tileX * TILE_SIZE, 0, tileZ * TILE_SIZE);
    mesh.add(buildSkirtFromPlaneGeometry(geo));

    return mesh;
  }

  const tiles = [];
  for (let z = -RING; z <= RING; z++) {
    for (let x = -RING; x <= RING; x++) {
      const tile = buildTile(x, z);
      scene.add(tile);
      tiles.push({ mesh: tile, gx: x, gz: z });
    }
  }

  function updateTilesAndSea() {
    const cx = Math.floor(camera.position.x / TILE_SIZE);
    const cz = Math.floor(camera.position.z / TILE_SIZE);

    for (const t of tiles) {
      const dx = t.gx - cx;
      const dz = t.gz - cz;

      if (dx > RING) t.gx -= 2 * RING + 1;
      if (dx < -RING) t.gx += 2 * RING + 1;
      if (dz > RING) t.gz -= 2 * RING + 1;
      if (dz < -RING) t.gz += 2 * RING + 1;

      t.mesh.position.x = t.gx * TILE_SIZE;
      t.mesh.position.z = t.gz * TILE_SIZE;
    }

    sea.position.x = camera.position.x;
    sea.position.z = camera.position.z;
  }

  // -----------------------------------------
  // Clouds (whiter + fluffier)
  // -----------------------------------------
  const clouds = new THREE.Group();
  scene.add(clouds);

  const cloudMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveIntensity: 0.22,
    roughness: 1.0,
    metalness: 0.0,
    transparent: true,
    opacity: 0.30,
    depthWrite: false,
  });

  function makeCloud() {
    const g = new THREE.Group();
    const puffCount = 8 + Math.floor(Math.random() * 8);

    for (let i = 0; i < puffCount; i++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), cloudMat);

      const s = THREE.MathUtils.randFloat(24, 66);
      const squash = THREE.MathUtils.randFloat(0.35, 0.62);
      puff.scale.set(s, s * squash, s);

      puff.position.set(
        THREE.MathUtils.randFloat(-55, 55),
        THREE.MathUtils.randFloat(-18, 16),
        THREE.MathUtils.randFloat(-45, 45)
      );

      g.add(puff);
    }

    const overall = THREE.MathUtils.randFloat(0.85, 1.55);
    g.scale.set(overall, overall, overall);
    return g;
  }

  const cloudData = [];
  for (let i = 0; i < 30; i++) {
    const c = makeCloud();
    c.position.set(
      THREE.MathUtils.randFloat(-900, 900),
      THREE.MathUtils.randFloat(300, 560),
      THREE.MathUtils.randFloat(-900, 900)
    );
    c.rotation.y = Math.random() * Math.PI * 2;
    clouds.add(c);

    cloudData.push({
      mesh: c,
      speed: THREE.MathUtils.randFloat(0.12, 0.35),     // slower
      phase: Math.random() * 1000,
      radius: THREE.MathUtils.randFloat(900, 1250),
      height: THREE.MathUtils.randFloat(320, 560),
    });
  }

  // -----------------------------------------
  // Paragliders (smaller + slower, matching color scheme)
  // -----------------------------------------
  function buildParaglider(color = 0xff5a5f) {
    const g = new THREE.Group();

    // smaller canopy
    const canopy = new THREE.Mesh(
      new THREE.TorusGeometry(16, 3.0, 10, 28, Math.PI * 1.12),
      new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.0 })
    );
    canopy.rotation.x = Math.PI * 0.5;
    canopy.rotation.z = Math.PI * 0.14;
    canopy.castShadow = true;
    g.add(canopy);

    // shorter lines
    const lines = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 20, 6, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x1f1f1f, roughness: 1.0 })
    );
    lines.position.y = -14;
    lines.castShadow = true;
    g.add(lines);

    // smaller pilot
    const pilot = new THREE.Mesh(
      new THREE.SphereGeometry(3.4, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0x1f1f1f, roughness: 1.0 })
    );
    pilot.position.y = -25;
    pilot.castShadow = true;
    g.add(pilot);

    return g;
  }

  const gliderAnchor = new THREE.Vector3(0, 0, 0);

  // palette: blue / purple / red / pink
  const gliders = [
    { mesh: buildParaglider(0x2d6bff), r: 460, speed: 0.12, phase: 0.0, lift: 200 },
    { mesh: buildParaglider(0x7a4dff), r: 620, speed: 0.09, phase: 1.7, lift: 250 },
    { mesh: buildParaglider(0xff3b54), r: 380, speed: 0.14, phase: 3.2, lift: 180 },
    { mesh: buildParaglider(0xff4fd8), r: 720, speed: 0.07, phase: 2.4, lift: 280 },
  ];
  for (const g of gliders) scene.add(g.mesh);

  // -----------------------------------------
  // Lighthouse (1/4 size, red/white stripes + rotating beacon)
  // -----------------------------------------
  function makeStripeTexture() {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 256;
    const ctx = c.getContext("2d");

    const stripes = 8; // number of horizontal bands
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 2 === 0 ? "#ffffff" : "#d61f2a";
      ctx.fillRect(0, (i * c.height) / stripes, c.width, c.height / stripes);
    }

    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    tex.needsUpdate = true;
    return tex;
  }

  const lighthouse = new THREE.Group();
  scene.add(lighthouse);

  // place it near sea level so it feels coastal
  const lighthouseXZ = new THREE.Vector3(260, 0, -220);
  const lighthouseY = heightAt(lighthouseXZ.x, lighthouseXZ.z);
  lighthouse.position.set(lighthouseXZ.x, lighthouseY, lighthouseXZ.z);

  const stripeTex = makeStripeTexture();

  const towerMat = new THREE.MeshStandardMaterial({
    map: stripeTex,
    roughness: 0.9,
    metalness: 0.0,
  });

  // 1/4 size of old one: height ~40 instead of 160
  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(3.5, 5.5, 40, 18, 1),
    towerMat
  );
  tower.position.y = 20;
  tower.castShadow = true;
  tower.receiveShadow = true;
  lighthouse.add(tower);

  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(6, 6, 6, 18),
    new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 1.0 })
  );
  cap.position.y = 43;
  cap.castShadow = true;
  lighthouse.add(cap);

  // Lantern glass (subtle glow)
  const lantern = new THREE.Mesh(
    new THREE.CylinderGeometry(3.2, 3.2, 4.8, 16),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xfff2cc,
      emissiveIntensity: 0.55,
      roughness: 0.35,
      transparent: true,
      opacity: 0.35,
    })
  );
  lantern.position.y = 48;
  lighthouse.add(lantern);

  // Rotating spotlight beam
  const beaconPivot = new THREE.Group();
  beaconPivot.position.y = 48;
  lighthouse.add(beaconPivot);

  const beacon = new THREE.SpotLight(
    0xfff2cc,
    2.2,                 // lower intensity (smaller lighthouse)
    2200,
    THREE.MathUtils.degToRad(18),
    0.45,
    1.4
  );
  beacon.position.set(0, 0, 0);
  beacon.castShadow = false;
  beaconPivot.add(beacon);
  beaconPivot.add(beacon.target);

  // Aim slightly downward toward sea
  beacon.target.position.set(0, -30, -400);

  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(1.1, 12, 10),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xfff2cc,
      emissiveIntensity: 1.2,
      roughness: 0.2,
    })
  );
  bulb.position.y = 48;
  lighthouse.add(bulb);

  // -----------------------------------------
  // Animation loop
  // -----------------------------------------
  const clock = new THREE.Clock();

  function animate() {
    const t = clock.getElapsedTime();

    updateTilesAndSea();

    // subtle sun drift
    sun.position.x = 650 + Math.sin(t * 0.05) * 160;
    sun.position.z = 350 + Math.cos(t * 0.05) * 140;

    // ocean waves (subtle)
    for (let i = 0; i < seaPos.count; i++) {
      const x = seaPos.getX(i);
      const z = seaPos.getZ(i);
      const wave =
        Math.sin(t * 0.6 + x * 0.004) * 2.2 +
        Math.cos(t * 0.55 + z * 0.0035) * 1.8;
      seaPos.setY(i, seaBase[i] + wave);
    }
    seaPos.needsUpdate = true;
    seaGeo.computeVertexNormals();

    // clouds: drift around origin
    for (const c of cloudData) {
      const m = c.mesh;
      const tt = t * c.speed + c.phase;
      m.position.x = Math.sin(tt * 0.23) * c.radius;
      m.position.z = Math.cos(tt * 0.19) * c.radius;
      m.position.y = c.height + Math.sin(tt * 0.41) * 35;
      m.rotation.y += 0.0008;
    }

    // gliders: circle around fixed anchor
    for (const g of gliders) {
      const a = t * g.speed + g.phase;

      const px = gliderAnchor.x + Math.cos(a) * g.r;
      const pz = gliderAnchor.z + Math.sin(a) * g.r;
      const py =
        heightAt(px, pz) +
        g.lift +
        Math.sin(t * 0.65 + g.phase) * 10;

      g.mesh.position.set(px, py, pz);

      g.mesh.rotation.y = -a + Math.PI * 0.5;
      g.mesh.rotation.z = Math.sin(t * 0.9 + g.phase) * 0.06;
      g.mesh.rotation.x = Math.sin(t * 0.55 + g.phase) * 0.04;
    }

    // lighthouse beacon rotation
    beaconPivot.rotation.y = t * 0.7;

    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  animate();

  // ---------- resize ----------
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  });
}
