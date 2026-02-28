// waterSystem.js
import * as THREE from "three";

/**
 * WaterSimulation
 * --------------
 * GPU heightfield wave simulation (ping-pong render targets).
 * Produces a Float texture where:
 *   R = height
 *   G = velocity
 *   B,A = packed surface normal (as expected by your water vertex shader)
 *
 * Uses RawShaderMaterial simulation shaders.
 * With your lagoonMask-enabled shaders:
 *   - outside lagoon => waves are absorbed (update shader)
 *   - drops on land are ignored (drop shader)
 */
class WaterSimulation {
  constructor({ renderer, loadShader, waterSize, lagoonMaskTexture }) {
    this.renderer = renderer;
    this.loadShader = loadShader;
    this.waterSize = waterSize;
    this.lagoonMaskTexture = lagoonMaskTexture;

    this._camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0, 2000);
    this._geometry = new THREE.PlaneGeometry(2, 2);

    this._targetA = new THREE.WebGLRenderTarget(waterSize, waterSize, { type: THREE.FloatType });
    this._targetB = new THREE.WebGLRenderTarget(waterSize, waterSize, { type: THREE.FloatType });
    this.target = this._targetA;

    this._dropMaterial = null;
    this._updateMaterial = null;
    this._dropMesh = null;
    this._updateMesh = null;
  }

  async init() {
    const vertex = await this.loadShader("simulation/vertex.glsl");
    const dropFrag = await this.loadShader("simulation/drop_fragment.glsl");
    const updateFrag = await this.loadShader("simulation/update_fragment.glsl");

    this._dropMaterial = new THREE.RawShaderMaterial({
      uniforms: {
        center: { value: [0, 0] },
        radius: { value: 0 },
        strength: { value: 0 },
        texture: { value: null },
        lagoonMask: { value: this.lagoonMaskTexture },
      },
      vertexShader: vertex,
      fragmentShader: dropFrag,
    });

    this._updateMaterial = new THREE.RawShaderMaterial({
      uniforms: {
        delta: { value: [1 / 216, 1 / 216] },
        texture: { value: null },
        lagoonMask: { value: this.lagoonMaskTexture },
      },
      vertexShader: vertex,
      fragmentShader: updateFrag,
    });

    this._dropMesh = new THREE.Mesh(this._geometry, this._dropMaterial);
    this._updateMesh = new THREE.Mesh(this._geometry, this._updateMaterial);
  }

  addDrop(x, y, radius, strength) {
    this._dropMaterial.uniforms.center.value = [x, y];
    this._dropMaterial.uniforms.radius.value = radius;
    this._dropMaterial.uniforms.strength.value = strength;
    this._render(this._dropMesh);
  }

  step() {
    this._render(this._updateMesh);
  }

  _render(mesh) {
    const oldTarget = this.target;
    const newTarget = this.target === this._targetA ? this._targetB : this._targetA;

    const oldRT = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(newTarget);

    mesh.material.uniforms.texture.value = oldTarget.texture;
    this.renderer.render(mesh, this._camera);

    this.renderer.setRenderTarget(oldRT);
    this.target = newTarget;
  }
}

/**
 * Water
 * -----
 * The visible water surface mesh.
 * Uses the water heightfield texture from WaterSimulation to displace the surface
 * and compute refraction/reflection.
 *
 * Expects your water shaders to:
 *   - read `uniform sampler2D water`
 *   - read `uniform sampler2D envMap` (refraction render target)
 *   - read `uniform samplerCube skybox`
 *   - read `uniform sampler2D lagoonMask` and discard outside lagoon (optional but recommended)
 */
class Water {
  constructor({
    loadShader,
    waterSize,
    waterPosition,
    waterScale = 1.0,
    skybox,
    light,
    lagoonMaskTexture,
  }) {
    this.loadShader = loadShader;
    this.waterSize = waterSize;

    this.geometry = new THREE.PlaneGeometry(2, 2, waterSize, waterSize);
    this.mesh = null;
    this.material = null;

    this.waterPosition = waterPosition;
    this.waterScale = waterScale;

    this.skybox = skybox;
    this.light = light;
    this.lagoonMaskTexture = lagoonMaskTexture;
  }

  async init() {
    const vertex = await this.loadShader("water/vertex.glsl");
    const fragment = await this.loadShader("water/fragment.glsl");

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        light: { value: this.light },
        water: { value: null },
        envMap: { value: null },
        skybox: { value: this.skybox },

        // lagoon cut (works only if your water shaders use it)
        lagoonMask: { value: this.lagoonMaskTexture },
      },
      vertexShader: vertex,
      fragmentShader: fragment,
    });

    this.material.extensions = { derivatives: true };

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.position.copy(this.waterPosition);
    this.mesh.scale.setScalar(this.waterScale);
  }

  setHeightTexture(tex) {
    this.material.uniforms.water.value = tex;
  }

  setEnvMapTexture(tex) {
    this.material.uniforms.envMap.value = tex;
  }
}

/**
 * EnvironmentMap
 * --------------
 * Renders the underwater scene from the light camera POV into a Float texture.
 * This texture is used by the caustics shader to ray-march intersections.
 */
class EnvironmentMap {
  constructor({ renderer, loadShader, size, lightCamera }) {
    this.renderer = renderer;
    this.loadShader = loadShader;
    this.size = size;
    this.lightCamera = lightCamera;

    this.target = new THREE.WebGLRenderTarget(this.size, this.size, { type: THREE.FloatType });
    this._meshes = [];
    this._material = null;
  }

  async init() {
    const vertex = await this.loadShader("environment_mapping/vertex.glsl");
    const fragment = await this.loadShader("environment_mapping/fragment.glsl");
    this._material = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment });
  }

  setGeometries(geoms) {
    this._meshes = geoms.map((g) => new THREE.Mesh(g, this._material));
  }

  render() {
    const oldRT = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.target);
    this.renderer.setClearColor(new THREE.Color("black"), 0);
    this.renderer.clear();
    for (const mesh of this._meshes) this.renderer.render(mesh, this.lightCamera);
    this.renderer.setRenderTarget(oldRT);
  }
}

/**
 * Caustics
 * --------
 * Computes a caustics intensity texture by launching refracted rays from the water surface
 * and marching them through the EnvironmentMap texture.
 * Produces a Float texture used by the underwater Environment shader.
 *
 * Note: You can later add lagoon masking in caustics shaders too, but it's optional early on.
 */
class Caustics {
  constructor({ renderer, loadShader, waterSize, light, lightCamera, envMapSize }) {
    this.renderer = renderer;
    this.loadShader = loadShader;
    this.waterSize = waterSize;
    this.light = light;
    this.lightCamera = lightCamera;
    this.envMapSize = envMapSize;

    this.target = new THREE.WebGLRenderTarget(waterSize * 3.0, waterSize * 3.0, { type: THREE.FloatType });
    this._waterGeometry = new THREE.PlaneGeometry(2, 2, waterSize, waterSize);
    this._waterMaterial = null;
    this._waterMesh = null;
  }

  async init() {
    const v = await this.loadShader("caustics/water_vertex.glsl");
    const f = await this.loadShader("caustics/water_fragment.glsl");

    this._waterMaterial = new THREE.ShaderMaterial({
      uniforms: {
        light: { value: this.light },
        env: { value: null },
        water: { value: null },
        deltaEnvTexture: { value: 1.0 / this.envMapSize },
      },
      vertexShader: v,
      fragmentShader: f,
      transparent: true,
    });

    // Additive blending for intensity
    this._waterMaterial.blending = THREE.CustomBlending;
    this._waterMaterial.blendEquation = THREE.AddEquation;
    this._waterMaterial.blendSrc = THREE.OneFactor;
    this._waterMaterial.blendDst = THREE.OneFactor;

    // No blending on alpha channel (depth)
    this._waterMaterial.blendEquationAlpha = THREE.AddEquation;
    this._waterMaterial.blendSrcAlpha = THREE.OneFactor;
    this._waterMaterial.blendDstAlpha = THREE.ZeroFactor;

    this._waterMaterial.side = THREE.DoubleSide;
    this._waterMaterial.extensions = { derivatives: true };

    this._waterMesh = new THREE.Mesh(this._waterGeometry, this._waterMaterial);
  }

  setTextures(waterTex, envTex) {
    this._waterMaterial.uniforms.env.value = envTex;
    this._waterMaterial.uniforms.water.value = waterTex;
  }

  render() {
    const oldRT = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.target);
    this.renderer.setClearColor(new THREE.Color("black"), 0);
    this.renderer.clear();
    this.renderer.render(this._waterMesh, this.lightCamera);
    this.renderer.setRenderTarget(oldRT);
  }
}

/**
 * Environment
 * -----------
 * Underwater scene shading pass that applies the caustics texture.
 * Uses your environment shaders.
 */
class Environment {
  constructor({ loadShader, light, lightCamera }) {
    this.loadShader = loadShader;
    this.light = light;
    this.lightCamera = lightCamera;

    this._material = null;
    this._meshes = [];
  }

  async init() {
    const v = await this.loadShader("environment/vertex.glsl");
    const f = await this.loadShader("environment/fragment.glsl");

    this._material = new THREE.ShaderMaterial({
      uniforms: {
        light: { value: this.light },
        caustics: { value: null },
        lightProjectionMatrix: { value: this.lightCamera.projectionMatrix },
        lightViewMatrix: { value: this.lightCamera.matrixWorldInverse },
      },
      vertexShader: v,
      fragmentShader: f,
    });
  }

  setGeometries(geoms) {
    this._meshes = geoms.map((g) => new THREE.Mesh(g, this._material));
  }

  updateCaustics(tex) {
    this._material.uniforms.caustics.value = tex;
  }

  addToScene(scene) {
    for (const mesh of this._meshes) scene.add(mesh);
  }
}

/**
 * createWaterSystem
 * -----------------
 * Small orchestrator that wires the classes together and gives you a tiny API:
 *
 * - step(dt): runs simulation + envMap + caustics at a fixed rate (e.g. 30Hz)
 * - renderRefraction({scene, camera, refractionRT}): renders the scene into envMap for water refraction
 * - addDrop(x, y, radius, strength): convenience to inject ripples
 */
export async function createWaterSystem({
  renderer,
  scene,
  cameraForRefraction, // optional: you can pass camera each call instead
  loadShader,
  skybox,
  lagoonMaskTexture,
  envGeometries,
  waterPosition,
  waterScale = 0.85,
  light = [0, 0, -1],
  lightCamera,
  waterSize = 256,
  envMapSize = 512,
  simHz = 30,
}) {
  const sim = new WaterSimulation({ renderer, loadShader, waterSize, lagoonMaskTexture });
  const water = new Water({
    loadShader,
    waterSize,
    waterPosition,
    waterScale,
    skybox,
    light,
    lagoonMaskTexture,
  });
  const envMap = new EnvironmentMap({ renderer, loadShader, size: envMapSize, lightCamera });
  const caustics = new Caustics({ renderer, loadShader, waterSize, light, lightCamera, envMapSize });
  const env = new Environment({ loadShader, light, lightCamera });

  await Promise.all([sim.init(), water.init(), envMap.init(), caustics.init(), env.init()]);

  envMap.setGeometries(envGeometries);
  env.setGeometries(envGeometries);
  env.addToScene(scene);
  scene.add(water.mesh);

  // Fixed-rate stepping
  let accumulator = 0;
  const stepDt = 1 / simHz;

  return {
    sim,
    water,
    envMap,
    caustics,
    env,

    addDrop: (x, y, radius, strength) => sim.addDrop(x, y, radius, strength),

    /** Run sim + caustics at fixed rate */
    step: (dt) => {
      accumulator += dt;
      while (accumulator >= stepDt) {
        accumulator -= stepDt;

        sim.step();
        const waterTex = sim.target.texture;

        water.setHeightTexture(waterTex);

        envMap.render();
        caustics.setTextures(waterTex, envMap.target.texture);
        caustics.render();
        env.updateCaustics(caustics.target.texture);
      }
    },

    /** Render scene (without water) into refractionRT and pass it to water */
    renderRefraction: ({ scene, camera, refractionRT }) => {
      const oldRT = renderer.getRenderTarget();

      renderer.setRenderTarget(refractionRT);
      renderer.clear();

      water.mesh.visible = false;
      renderer.render(scene, camera);
      water.mesh.visible = true;

      water.setEnvMapTexture(refractionRT.texture);

      renderer.setRenderTarget(oldRT);
    },
  };
}