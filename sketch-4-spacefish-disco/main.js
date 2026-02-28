// main.js
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createWaterSystem } from "./waterSystem.js";
import { makeLagoonMaskTexture } from "./lagoonMask.js";
import { makePixelStarCubeTexture } from "./skybox.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { bindRipples } from "./inputRipples.js";

/* ----------------------------------------------------------
   SHADER LOADING
---------------------------------------------------------- */
const BASE = import.meta.env.BASE_URL;
const shaderUrl = (relPath) => `${BASE}shaders/${relPath}`;
async function loadShader(relPath) {
  const url = shaderUrl(relPath);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load shader: ${url}`);
  return await res.text();
}

/* ----------------------------------------------------------
   CONFIG
---------------------------------------------------------- */
const CONFIG = {
  water: {
    position: new THREE.Vector3(0, 0, 0.8),
    scale: 0.85,
    size: 256,
    envMapSize: 512,
    simHz: 30,
  },
  skybox: {
    size: 1024,
    seed: 7,
    starDensity: 0.0038,
    bigStarChance: 0.4,
    tintChance: 0.25,
    edgeDark: 0.85,
  },
  fish: {
    glb: `${import.meta.env.BASE_URL}assets/bumplefish.glb`,
    count: 10,
    scaleMin: 0.085,
    scaleMax: 0.115,
    // outer orbit radius per fish (before outer*1.45)
    radiusMin: 0.65,
    radiusMax: 0.70,
    speedMin: 0.12,
    speedMax: 0.30,
    bobAmpMin: 0.015,
    bobAmpMax: 0.045,
    bobSpeedMin: 1.2,
    bobSpeedMax: 2.7,
  },
  pull: {
    releaseDelay: 4.0, // seconds after last ripple
    pullInSpeed: 1.0,  // inward
    releaseSpeed: 0.35 // outward
  },
  ripples: {
    clamp: 1,
    radius: 0.03,
    strength: 0.01,
    seedDrops: 2,
    seedRadius: 0.035,
    seedStrength: 0.008,
  },
  glowRocks: {
    rockDistance: 0.8,
    rockRadius: 0.045,
    glowSize: 2.0,
    glowAmp: 0.25,
    glowOpacity: 0.25,
    glowOpacityAmp: 0.35,
    speed: 1.0,
    phase: 0,
  },
};

/* ----------------------------------------------------------
   BASIC SETUP
---------------------------------------------------------- */
const canvas = document.getElementById("canvasThree");
const scene = new THREE.Scene();

const renderer = setupRenderer(canvas);
const { camera, controls } = setupCameraControls(canvas);

setupLights(scene);
const refractionRT = setupRefractionTarget();
setupResize(renderer, camera, refractionRT);

/* ----------------------------------------------------------
   CONSTANTS
---------------------------------------------------------- */
const lagoonMaskTexture = makeLagoonMaskTexture();
const skybox = makePixelStarCubeTexture(CONFIG.skybox);
scene.background = skybox;

const light = [0.0, 0.0, -1.0];
const lightCamera = new THREE.OrthographicCamera(-1.2, 1.2, 1.2, -1.2, 0.0, 2.0);
lightCamera.position.set(0.0, 0.0, 1.5);
lightCamera.lookAt(0, 0, 0);

/* ----------------------------------------------------------
   AUDIO — start muted, play on unmute
---------------------------------------------------------- */

let audio;
let isMuted = true;
let muteBtn = null;

function setupAudio() {
  const audioUrl = `${BASE}assets/dance.wav`;

  audio = new Audio(audioUrl);
  audio.loop = true;
  audio.volume = 0.7;

  // Start muted by default
  audio.muted = true;

  // Try to start playback silently (some browsers allow, some won't)
  audio.play().catch(() => {
    // It's okay if this fails — we'll start on the first unmute click
  });
}

function createMuteButton() {
  muteBtn = document.createElement("button");
  muteBtn.id = "muteBtn";
  muteBtn.innerText = "🔇"; // starts muted

  Object.assign(muteBtn.style, {
    position: "fixed",
    top: "24px",
    right: "24px",
    zIndex: "50",

    fontSize: "28px",          // ⬆ bigger icon
    padding: "14px 20px",      // ⬆ bigger button
    border: "none",
    borderRadius: "14px",
    cursor: "pointer",

    background: "rgb(6,10,26)",
    color: "white",
    backdropFilter: "blur(8px)",

    boxShadow: "0 0 20px rgba(255,255,255,0.25)",  // subtle glow
  });

  muteBtn.onclick = async () => {
    isMuted = !isMuted;
    audio.muted = isMuted;

    if (!isMuted) {
      // IMPORTANT: ensure playback actually starts on user gesture
      try {
        await audio.play();
      } catch (e) {
        console.warn("Audio play() failed:", e);
      }
    }

    muteBtn.innerText = isMuted ? "🔇" : "🔊";
  };

  document.body.appendChild(muteBtn);
}

/* ----------------------------------------------------------
   ENVIRONMENT GEOMETRY + GLOW ROCKS
---------------------------------------------------------- */
const envGeometries = [];
const glowRocks = [];

setupEnvironment(scene, envGeometries, glowRocks);

/* ----------------------------------------------------------
   FISH (school)
---------------------------------------------------------- */
const gltfLoader = new GLTFLoader();
const fishes = [];

/* ----------------------------------------------------------
   FISH PULL STATE (driven by ripple creation)
---------------------------------------------------------- */
let centerPullTarget = 0;
let centerPull = 0;
let releaseTimer = 0;

function triggerFishPull() {
  centerPullTarget = 1;
  releaseTimer = CONFIG.pull.releaseDelay;
}

/* ----------------------------------------------------------
   WATER SYSTEM
---------------------------------------------------------- */
let waterSystem = null;

/* ----------------------------------------------------------
   INIT
---------------------------------------------------------- */
async function init() {
  waterSystem = await createWaterSystem({
    renderer,
    scene,
    loadShader,
    skybox,
    lagoonMaskTexture,
    envGeometries,
    waterPosition: CONFIG.water.position,
    waterScale: CONFIG.water.scale,
    light,
    lightCamera,
    waterSize: CONFIG.water.size,
    envMapSize: CONFIG.water.envMapSize,
    simHz: CONFIG.water.simHz,
  });

  seedRipples(waterSystem);

  await loadFishGLB({
    loader: gltfLoader,
    url: CONFIG.fish.glb,
    count: CONFIG.fish.count,
    scene,
    fishes,
  });

  bindRipples({
    canvas,
    camera,
    waterPositionZ: CONFIG.water.position.z,
    addDrop: (x, y, r, s) => {
      waterSystem.addDrop(x, y, r, s);
      triggerFishPull();
    },
    clamp: CONFIG.ripples.clamp,
    radius: CONFIG.ripples.radius,
    strength: CONFIG.ripples.strength,
  });

  setupAudio();
  createMuteButton();

  animate();
}

/* ----------------------------------------------------------
   LOOP
---------------------------------------------------------- */
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  if (!waterSystem) return;

  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;

  // 1) Fish animation clips
  for (const f of fishes) f.mixer?.update(dt);

  // 2) Update ripple-driven pull state
  stepPull(dt);

  // 3) Glowy rocks pulse
  stepGlowRocks(glowRocks, t);

  // 4) Fish movement (orbit / steering)
  stepFishSchool(fishes, t, dt);

  // 5) Water sim + caustics
  waterSystem.step(dt);

  // 6) Refraction RT
  waterSystem.renderRefraction({ scene, camera, refractionRT });

  // 7) Final render
  renderer.setRenderTarget(null);
  renderer.clear();
  renderer.render(scene, camera);

  controls.update();
}

/* ----------------------------------------------------------
   HELPERS
---------------------------------------------------------- */
function setupRenderer(canvas) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true });
  r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  r.autoClear = false;

  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.1;

  return r;
}

function setupCameraControls(canvas) {
  const camera = new THREE.PerspectiveCamera(70, 1, 0.01, 100);
  camera.position.set(-1.4, -1.4, 1.2);
  camera.up.set(0, 0, 1);
  scene.add(camera);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0, 0.55);
  controls.enableDamping = true;

  return { camera, controls };
}

function setupLights(scene) {
  const hemi = new THREE.HemisphereLight(0xdff4ff, 0x101820, 0.55);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(0, 0, 3);
  sun.target.position.set(0, 0, 0);
  scene.add(sun);
  scene.add(sun.target);
}

function setupRefractionTarget() {
  const rt = new THREE.WebGLRenderTarget(512, 512);
  rt.texture.minFilter = THREE.LinearFilter;
  rt.texture.magFilter = THREE.LinearFilter;
  rt.texture.wrapS = THREE.ClampToEdgeWrapping;
  rt.texture.wrapT = THREE.ClampToEdgeWrapping;
  return rt;
}

function setupResize(renderer, camera, refractionRT) {
  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    const rt = Math.min(1536, Math.max(512, Math.floor(Math.min(w, h) * 1.15)));
    refractionRT.setSize(rt, rt);
  }
  window.addEventListener("resize", resize);
  resize();
}

function seedRipples(waterSystem) {
  for (let i = 0; i < CONFIG.ripples.seedDrops; i++) {
    waterSystem.addDrop(
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      CONFIG.ripples.seedRadius,
      CONFIG.ripples.seedStrength
    );
  }
}

function setupEnvironment(scene, envGeometries, glowRocks) {
  // floor (caustics receiver)
  envGeometries.push(new THREE.PlaneGeometry(2, 2, 1, 1));

  // glow rocks (4 quadrants, same size)
  const d = CONFIG.glowRocks.rockDistance;
  const positions = [
    new THREE.Vector3( d,  d, 0.0),
    new THREE.Vector3(-d,  d, 0.0),
    new THREE.Vector3(-d, -d, 0.0),
    new THREE.Vector3( d, -d, 0.0),
  ];

  for (const pos of positions) {
    addWhiteGlowyRock({
      scene,
      envGeometries,
      glowRocks,
      position: pos,
      radius: CONFIG.glowRocks.rockRadius,
      detail: 2,
      glowSize: CONFIG.glowRocks.glowSize,
      glowAmp: CONFIG.glowRocks.glowAmp,
      glowOpacity: CONFIG.glowRocks.glowOpacity,
      glowOpacityAmp: CONFIG.glowRocks.glowOpacityAmp,
      speed: CONFIG.glowRocks.speed,
      phase: CONFIG.glowRocks.phase,
    });
  }
}

function addWhiteGlowyRock({
  scene,
  envGeometries,
  glowRocks,
  position,
  radius = 0.06,
  detail = 2,
  glowSize = 1.35,
  glowAmp = 0.25,
  glowOpacity = 0.25,
  glowOpacityAmp = 0.35,
  speed = 1.0,
  phase = 0,
} = {}) {
  // geometry used by caustics/env shader
  const rockGeo = new THREE.IcosahedronGeometry(radius, detail);
  rockGeo.translate(position.x, position.y, position.z);
  envGeometries.push(rockGeo);

  // visible glow shell
  const shellGeo = new THREE.IcosahedronGeometry(radius, detail);
  const shellMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: glowOpacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const shell = new THREE.Mesh(shellGeo, shellMat);
  shell.position.copy(position);
  shell.scale.setScalar(glowSize);
  scene.add(shell);

  glowRocks.push({
    shell,
    baseScale: glowSize,
    ampScale: glowAmp,
    baseOpacity: glowOpacity,
    ampOpacity: glowOpacityAmp,
    speed,
    phase,
  });
}

async function loadFishGLB({ loader, url, count, scene, fishes }) {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        const template = gltf.scene;
        const clips = gltf.animations || [];

        for (let i = 0; i < count; i++) {
          const root = template.clone(true);

          const s = CONFIG.fish.scaleMin + Math.random() * (CONFIG.fish.scaleMax - CONFIG.fish.scaleMin);
          root.scale.setScalar(s);
          root.rotation.x = Math.PI / 2;

          const mixer = new THREE.AnimationMixer(root);
          if (clips.length > 0) {
            const action = mixer.clipAction(clips[0]);
            action.play();
            action.time = Math.random() * action.getClip().duration;
          }

          const params = {
            phase: Math.random() * Math.PI * 2,
            speed: CONFIG.fish.speedMin + Math.random() * (CONFIG.fish.speedMax - CONFIG.fish.speedMin),
            radius: CONFIG.fish.radiusMin + Math.random() * (CONFIG.fish.radiusMax - CONFIG.fish.radiusMin),
            radius2: 0.10 + Math.random() * 0.18,
            bobAmp: CONFIG.fish.bobAmpMin + Math.random() * (CONFIG.fish.bobAmpMax - CONFIG.fish.bobAmpMin),
            bobSpeed: CONFIG.fish.bobSpeedMin + Math.random() * (CONFIG.fish.bobSpeedMax - CONFIG.fish.bobSpeedMin),
            turnLerp: 0.12 + Math.random() * 0.10,
          };

          root.position.set(0, 0, 0.18);
          scene.add(root);
          fishes.push({ root, mixer, params });
        }

        resolve();
      },
      undefined,
      reject
    );
  });
}

function stepPull(dt) {
  if (releaseTimer > 0) {
    releaseTimer -= dt;
    if (releaseTimer <= 0) centerPullTarget = 0;
  }

  const { pullInSpeed, releaseSpeed } = CONFIG.pull;

  if (centerPullTarget > centerPull) {
    centerPull += (centerPullTarget - centerPull) * (1 - Math.exp(-pullInSpeed * dt));
  } else {
    centerPull += (centerPullTarget - centerPull) * (1 - Math.exp(-releaseSpeed * dt));
  }
}

function stepGlowRocks(glowRocks, t) {
  for (const g of glowRocks) {
    const p = 0.5 + 0.5 * Math.sin(t * g.speed + g.phase);
    g.shell.scale.setScalar(g.baseScale + g.ampScale * p);
    g.shell.material.opacity = g.baseOpacity + g.ampOpacity * p;
  }
}

function stepFishSchool(fishes, t, dt) {
  for (const f of fishes) {
    const p = f.params;

    const tt = t * p.speed + p.phase;

    const outer = p.radius * 1.45;
    const inner = outer * 0.15;
    const r = outer * (1 - centerPull) + inner * centerPull;

    const wob = p.radius2 * Math.sin(tt * 1.7 + p.phase * 1.3);

    const x = (r + wob) * Math.cos(tt);
    const y = (r - wob) * Math.sin(tt * 1.12);
    const z = 0.18 + p.bobAmp * Math.sin(t * p.bobSpeed + p.phase);

    f.root.position.set(x, y, z);

    const dx = -(r + wob) * Math.sin(tt) * p.speed;
    const dy = (r - wob) * Math.cos(tt * 1.12) * (p.speed * 1.12);

    const desired = Math.atan2(dy, dx);
    f.root.rotation.z += (desired - f.root.rotation.z) * p.turnLerp;
  }
}

init().catch((err) => {
  console.error(err);
  alert(err.message);
});