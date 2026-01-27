import * as THREE from "three";
import { createInput } from "./input.js";
import { createWorld } from "./world.js";
import { pathOffsetX } from "./path.js";

/** Modulo that works for negative numbers. */
export function mod(n, m) {
  return ((n % m) + m) % m;
}

/** Create renderer bound to an existing canvas. */
function createRenderer(canvas) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true });
  r.setSize(window.innerWidth, window.innerHeight);
  r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  // nicer glow-ish response
  r.outputColorSpace = THREE.SRGBColorSpace;
  return r;
}

/** Create the main scene with black background + fog. */
function createScene() {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x000000);
  s.fog = new THREE.Fog(0x000000, 6, 40);
  return s;
}

/** Create camera used for first-person walking. */
function createCamera() {
  const c = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 900);
  c.position.set(0, 1.7, 6);
  return c;
}

/** Create lights (neutral; zones are only color by spheres). */
function createLights(scene) {
  scene.add(new THREE.AmbientLight(0xffffff, 0.22));

  const key = new THREE.DirectionalLight(0xffffff, 0.55);
  key.position.set(12, 18, 10);
  scene.add(key);

  const mood = new THREE.PointLight(0xffffff, 0.9, 140);
  mood.position.set(0, 4, -8);
  scene.add(mood);

  return { mood };
}

/** Camera-locked star background (never walked through, never scrolls). */
function createStarDome({ scene, count = 2000, radius = 420 }) {
  const positions = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    // uniform random direction
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);

    const x = Math.sin(phi) * Math.cos(theta);
    const y = Math.cos(phi);
    const z = Math.sin(phi) * Math.sin(theta);

    positions[i * 3 + 0] = x * radius;
    positions[i * 3 + 1] = y * radius;
    positions[i * 3 + 2] = z * radius;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.computeBoundingSphere();

  const mat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 1.2,
    sizeAttenuation: false,
    depthTest: true,   // spheres occlude stars
    depthWrite: false, // stars never block anything
    transparent: true,
    opacity: 0.9,
    fog: false,        // stars ignore fog 
  });

  const stars = new THREE.Points(geo, mat);
  stars.renderOrder = -100;
  stars.frustumCulled = false; 
  scene.add(stars);

  return stars;
}

/* ------------------ BOOT ------------------ */

const canvas = document.getElementById("canvasThree");
const renderer = createRenderer(canvas);
const scene = createScene();
const camera = createCamera();
const { mood } = createLights(scene);

// Stars: static universe background
const starDome = createStarDome({ scene });

// Input: wheel travel + mouse look
const input = createInput({ camera, domElement: renderer.domElement });

// World: walkway + zones + spheres
const worldState = createWorld({ scene });

const clock = new THREE.Clock();

function animate() {
  const dt = clock.getDelta();
  const t = clock.elapsedTime;

  input.update(dt);

  const wrapped = mod(input.travelSmooth, worldState.segmentLength);

  // move looped world under camera
  worldState.world.position.z = wrapped;

  // curved path feel
  worldState.world.position.x = -pathOffsetX(wrapped);

  // lock stars to camera so you never “move through” them
  starDome.position.copy(camera.position);

  worldState.updateZoneAndMood({ wrapped, time: t, scene, moodLight: mood });
  worldState.animateBalls({ time: t, dt });

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});
