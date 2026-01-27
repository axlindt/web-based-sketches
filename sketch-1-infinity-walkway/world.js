import * as THREE from "three";
import { pathOffsetX } from "./path.js";

/** Editable: 3 zones × 4 strong dot colors each. */
const ZONE_COLOR_PALETTES = [
  // Zone 1 — red / pink
  [0xff2f55, 0xff1fd2, 0xff6aa9, 0xd000ff],
  // Zone 2 — orange / yellow
  [0xff7a00, 0xffb300, 0xff4d00, 0xffd84a],
  // Zone 3 — blue / green
  [0x00e5ff, 0x00ff9c, 0x0066ff, 0x00c2a8],
];

/** Build a curved ribbon mesh (used for walkway). */
function makeRibbon({ width, length, step, y, mat }) {
  const segs = Math.floor(length / step);
  const half = width / 2;

  const pos = new Float32Array(segs * 6 * 3);
  const nrm = new Float32Array(segs * 6 * 3);

  let p = 0;
  for (let i = 0; i < segs; i++) {
    const s0 = i * step, s1 = (i + 1) * step;
    const z0 = -s0, z1 = -s1;
    const cx0 = pathOffsetX(s0), cx1 = pathOffsetX(s1);

    const x0L = cx0 - half, x0R = cx0 + half;
    const x1L = cx1 - half, x1R = cx1 + half;

    const v = [
      x0L, y, z0,  x0R, y, z0,  x1R, y, z1,
      x0L, y, z0,  x1R, y, z1,  x1L, y, z1,
    ];
    pos.set(v, p);

    // flat up normals
    for (let k = 0; k < 6; k++) {
      const ni = (p / 3 + k) * 3;
      nrm[ni + 0] = 0; nrm[ni + 1] = 1; nrm[ni + 2] = 0;
    }
    p += 18;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  return new THREE.Mesh(geo, mat);
}

/** Build a thin glowing edge strip along a curved path (one side). */
function makeEdgeStrip({ side, walkwayW, stripW, length, step, y, mat }) {
  const segs = Math.floor(length / step);
  const half = walkwayW / 2;
  const edgeOffset = half + 0.02;

  const pos = new Float32Array(segs * 6 * 3);
  let p = 0;

  for (let i = 0; i < segs; i++) {
    const s0 = i * step, s1 = (i + 1) * step;
    const z0 = -s0, z1 = -s1;
    const cx0 = pathOffsetX(s0), cx1 = pathOffsetX(s1);

    const x0A = cx0 + side * edgeOffset;
    const x0B = x0A + side * stripW;
    const x1A = cx1 + side * edgeOffset;
    const x1B = x1A + side * stripW;

    const v = [
      x0A, y, z0,  x0B, y, z0,  x1B, y, z1,
      x0A, y, z0,  x1B, y, z1,  x1A, y, z1,
    ];
    pos.set(v, p);
    p += 18;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.edgeMaterial = mat;
  return mesh;
}

/** Generate evenly spaced directions on a unit sphere (Fibonacci). */
function fibonacciDirs(n) {
  const out = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const t = golden * i;
    out.push(new THREE.Vector3(Math.cos(t) * r, y, Math.sin(t) * r));
  }
  return out;
}

/** Create a “lantern” sphere: dark body + circular dot meshes. */
function makeLanternSphere({ baseGeo, baseMat, dotGeo, dotMat, radius, dotDirs, dotScale, dotOffset }) {
  const s = new THREE.Mesh(baseGeo, baseMat);
  s.scale.setScalar(radius);
  s.rotation.set(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2);

  for (const d of dotDirs) {
    const dot = new THREE.Mesh(dotGeo, dotMat);
    dot.position.copy(d).multiplyScalar(dotOffset);
    dot.scale.setScalar(dotScale);
    s.add(dot);
  }
  return s;
}

/** Pick a side offset away from the walkway so nothing blocks the path. */
function offPathX({ centerX, minLat, maxLat }) {
  const side = Math.random() < 0.5 ? -1 : 1;
  const mag = THREE.MathUtils.lerp(minLat, maxLat, Math.random());
  return centerX + side * mag;
}

/** Animate edge emissive for a subtle pulse. */
function pulseEdges(edgeMats, time, baseIntensity) {
  const pulse = Math.sin(time * 1.2) * 0.8;
  for (const m of edgeMats) m.emissiveIntensity = baseIntensity + pulse;
}

/** Animate bobbing + spin for objects inside a group. */
function animateGroup(group, time, dt) {
  for (const o of group.children) {
    const u = o.userData;
    if (!u) continue;
    o.position.y = u.baseY + Math.sin(time * u.speed + u.phase) * 0.12;
    o.rotation.y += dt * u.spin;
  }
}

/** Build the looping world: walkway + glowing edges + zone sphere fields. */
export function createWorld({ scene }) {
  const world = new THREE.Group();
  scene.add(world);

  // Layout
  const ZONE_COUNT = 3;
  const ZONE_LEN = 90;
  const segmentLength = ZONE_COUNT * ZONE_LEN;

  // Keep scene black
  scene.background.set(0x000000);
  scene.fog.color.set(0x000000);
  scene.fog.near = 6;
  scene.fog.far = 40;

  // Walkway + edges
  const WALKWAY_W = 2.6;
  const WALKWAY_COLOR = 0x07070c;
  const EDGE_W = 0.03;
  const EDGE_Y = 0.055;
  const EDGE_INT = 6.0;

  // Sphere placement
  const SAFE_MARGIN = 1.2;
  const MIN_LAT = WALKWAY_W / 2 + SAFE_MARGIN;
  const MAX_LAT = 46;
  const Y_MIN = -13.0;
  const Y_MAX = 22.0;

  // Sphere count + size
  const BALLS_PER_ZONE = 840;
  const R_MIN = 0.1;
  const R_MAX = 1.6;

  // Dot layout
  const DOT_COUNT = 8;
  const DOT_SCALE = 0.26;
  const DOT_OFFSET = 1.015;

  // Geometry detail
  const BASE_SEG = 18;
  const DOT_SEG = 12;

  // Build zone groups
  const zoneGroups = Array.from({ length: ZONE_COUNT }, () => {
    const g = new THREE.Group();
    world.add(g);
    return g;
  });

  // Shared materials
  const walkwayMat = new THREE.MeshStandardMaterial({
    color: WALKWAY_COLOR,
    roughness: 1.0,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });

  const edgeMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: EDGE_INT,
    roughness: 0.2,
    metalness: 0.0,
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide,
  });

  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x05050a,
    roughness: 0.45,
    metalness: 0.02,
  });

  const zoneDotMats = ZONE_COLOR_PALETTES.map((palette) =>
    palette.map(
      (hex) =>
        new THREE.MeshStandardMaterial({
          color: hex,
          emissive: new THREE.Color(hex),
          emissiveIntensity: 4.8,
          roughness: 0.25,
          metalness: 0.0,
        })
    )
  );

  // Shared geometries + dot dirs
  const baseGeo = new THREE.SphereGeometry(1, BASE_SEG, BASE_SEG);
  const dotGeo = new THREE.SphereGeometry(1, DOT_SEG, DOT_SEG);
  const dotDirs = fibonacciDirs(DOT_COUNT);

  // Walkway + edges across 2 copies
  const geoLen = segmentLength * 2;
  const step = 1.0;

  world.add(makeRibbon({ width: WALKWAY_W, length: geoLen, step, y: 0, mat: walkwayMat }));

  const edgeLeft = makeEdgeStrip({ side: -1, walkwayW: WALKWAY_W, stripW: EDGE_W, length: geoLen, step, y: EDGE_Y, mat: edgeMat.clone() });
  const edgeRight = makeEdgeStrip({ side:  1, walkwayW: WALKWAY_W, stripW: EDGE_W, length: geoLen, step, y: EDGE_Y, mat: edgeMat.clone() });
  world.add(edgeLeft);
  world.add(edgeRight);

  const edgeMats = [edgeLeft.userData.edgeMaterial, edgeRight.userData.edgeMaterial];

  // Build spheres (2 copies for seamless loop)
  for (let copy = 0; copy < 2; copy++) {
    const sOffset = copy * segmentLength;

    for (let zi = 0; zi < ZONE_COUNT; zi++) {
      const sStart = zi * ZONE_LEN + sOffset;
      const sEnd = (zi + 1) * ZONE_LEN + sOffset;

      for (let i = 0; i < BALLS_PER_ZONE; i++) {
        const s = THREE.MathUtils.lerp(sStart, sEnd, Math.random());
        const cx = pathOffsetX(s);

        // more spheres down low
        const uY = Math.random();
        const biasedLow = 1 - Math.pow(uY, 2.6);
        const y = THREE.MathUtils.lerp(Y_MIN, Y_MAX, biasedLow);

        const x = offPathX({ centerX: cx, minLat: MIN_LAT, maxLat: MAX_LAT });
        const z = -s;

        // biased radius: many small, few big
        const u = Math.random();
        const biased = u * u;
        const radius = R_MIN + biased * (R_MAX - R_MIN);

        const dotMat = zoneDotMats[zi][(Math.random() * zoneDotMats[zi].length) | 0];

        const sphere = makeLanternSphere({
          baseGeo,
          baseMat,
          dotGeo,
          dotMat,
          radius,
          dotDirs,
          dotScale: DOT_SCALE,
          dotOffset: DOT_OFFSET,
        });

        sphere.position.set(x, y, z);
        sphere.userData = {
          baseY: y,
          phase: Math.random() * Math.PI * 2,
          speed: 0.2 + Math.random() * 1.0,
          spin: (Math.random() - 0.5) * 0.45,
        };

        zoneGroups[zi].add(sphere);
      }
    }
  }

  // Start in zone 0
  zoneGroups.forEach((g, i) => (g.visible = i === 0));
  world.userData.currentZi = 0;

  /** Keep zones isolated + keep background black + pulse edges. */
  function updateZoneAndMood({ wrapped, time, scene, moodLight }) {
    scene.background.set(0x000000);
    scene.fog.color.set(0x000000);
    scene.fog.near = 6;
    scene.fog.far = 40;

    moodLight.color.set(0xffffff);
    moodLight.position.set(0, 4, -8);
    moodLight.intensity = 0.9;

    const zi = Math.floor(wrapped / ZONE_LEN) % ZONE_COUNT;
    zoneGroups.forEach((g, i) => (g.visible = i === zi));
    world.userData.currentZi = zi;

    pulseEdges(edgeMats, time, EDGE_INT);
  }

  /** Animate spheres only in the current zone. */
  function animateBalls({ time, dt }) {
    const zi = world.userData.currentZi ?? 0;
    animateGroup(zoneGroups[zi], time, dt);
  }

  return { world, segmentLength, updateZoneAndMood, animateBalls };
}
