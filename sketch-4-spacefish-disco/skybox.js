import * as THREE from "three";

/* ----------------------------------------------------------
   PIXEL STAR SKYBOX (Procedural Cubemap)
----------------------------------------------------------

Generates a cube texture with:

- Deep blue space background
- Many small stars
- Some larger “sparkle” stars
- Optional subtle blue/purple tint
- Darkened edges to reduce visible cube seams

The texture is created procedurally using canvas
and returned as a THREE.CubeTexture.

This is used for:
- scene.background
- water reflection (samplerCube skybox)

---------------------------------------------------------- */
export function makePixelStarCubeTexture({
  size = 256,            // resolution per cube face
  seed = 42,             // controls random star layout
  base = [6, 10, 26],    // deep blue background RGB
  starDensity = 0.022,   // overall star frequency
  bigStarChance = 0.10,  // chance a star becomes a sparkle
  tintChance = 0.22,     // chance star gets blue/purple tint
  edgeDark = 0.75,       // how dark cube edges are (reduce seams)
} = {}) {

  /* ----------------------------------------------------------
     Utility helpers
  ---------------------------------------------------------- */

  // Clamp value to 0..1
  const clamp01 = (t) => Math.max(0, Math.min(1, t));

  // Smooth interpolation (used for vignette)
  const smoothstep = (a, b, x) => {
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  };

  // Deterministic pseudo-random hash function
  // Ensures stars are stable and repeatable per seed
  const hash = (a, b, c) => {
    const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7 + seed * 0.123) * 43758.5453;
    return s - Math.floor(s);
  };

  /* ----------------------------------------------------------
     Convert cube face + UV → direction vector

     This ensures stars align across cube face borders,
     reducing visible seams.
  ---------------------------------------------------------- */
  function faceDir(face, u, v) {
    switch (face) {
      case 0: return new THREE.Vector3( 1,  v, -u); // +X
      case 1: return new THREE.Vector3(-1,  v,  u); // -X
      case 2: return new THREE.Vector3( u,  1, -v); // +Y
      case 3: return new THREE.Vector3( u, -1,  v); // -Y
      case 4: return new THREE.Vector3( u,  v,  1); // +Z
      case 5: return new THREE.Vector3(-u,  v, -1); // -Z
      default: return new THREE.Vector3(0, 0, 1);
    }
  }

  /* ----------------------------------------------------------
     Generate one cube face
  ---------------------------------------------------------- */
  function makeFaceCanvas(faceIndex) {
    const c = document.createElement("canvas");
    c.width = c.height = size;

    const ctx = c.getContext("2d");
    const img = ctx.createImageData(size, size);
    const d = img.data;

    const [br, bg, bb] = base;

    // Helper: safely brighten a pixel
    const addPixel = (ii, jj, addR, addG, addB) => {
      if (ii < 0 || ii >= size || jj < 0 || jj >= size) return;
      const k = (jj * size + ii) * 4;
      d[k + 0] = Math.min(255, d[k + 0] + addR);
      d[k + 1] = Math.min(255, d[k + 1] + addG);
      d[k + 2] = Math.min(255, d[k + 2] + addB);
    };

    /* ----------------------------------------------------------
       Loop over every pixel of this cube face
    ---------------------------------------------------------- */
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {

        // Convert pixel to [-1,1] range
        const u = (i + 0.5) / size * 2 - 1;
        const v = (j + 0.5) / size * 2 - 1;

        /* ----------------------------------------------------------
           Edge darkening (vignette)
           Reduces visible cube edges and keeps space darker at borders
        ---------------------------------------------------------- */
        const r2 = Math.sqrt(u * u + v * v);
        const r = clamp01(r2 / 1.4142);
        const vignette = 1.0 - smoothstep(0.60, 1.0, r);
        const edgeFade = (1.0 - edgeDark) + edgeDark * vignette;

        const k = (j * size + i) * 4;
        d[k + 0] = Math.floor(br * edgeFade);
        d[k + 1] = Math.floor(bg * edgeFade);
        d[k + 2] = Math.floor(bb * edgeFade);
        d[k + 3] = 255;

        /* ----------------------------------------------------------
           Compute 3D direction so stars match across cube faces
        ---------------------------------------------------------- */
        const dir = faceDir(faceIndex, u, v).normalize();
        const x = dir.x, y = dir.y, z = dir.z;

        // Star placement
        const h = hash(x * 220.0, y * 220.0, z * 220.0);

        if (h < starDensity) {

          // Star brightness (biased toward small/dim stars)
          const h2 = hash(x * 970.0 + 1, y * 970.0 + 2, z * 970.0 + 3);
          const bright = 90 + Math.floor(165 * Math.pow(h2, 0.18));

          let sr = bright, sg = bright, sb = bright;

          /* ----------------------------------------------------------
             Optional subtle tint (blue/purple variation)
          ---------------------------------------------------------- */
          const ht = hash(x * 1500.0 + 9, y * 1500.0 + 10, z * 1500.0 + 11);
          if (ht < tintChance) {
            const mode = hash(x * 1600.0 + 21, y * 1600.0 + 22, z * 1600.0 + 23);
            if (mode < 0.5) {
              // bluish
              sr = Math.floor(bright * 0.80);
              sg = Math.floor(bright * 0.92);
              sb = bright;
            } else {
              // purplish
              sr = Math.floor(bright * 0.92);
              sg = Math.floor(bright * 0.80);
              sb = bright;
            }
          }

          // Base star pixel
          addPixel(i, j, sr, sg, sb);

          /* ----------------------------------------------------------
             Some stars become larger “sparkles”
          ---------------------------------------------------------- */
          const hs = hash(x * 800.0 + 31, y * 800.0 + 37, z * 800.0 + 41);
          if (hs < bigStarChance) {

            const a = Math.floor(bright * 0.35);

            // Cross shape
            addPixel(i - 1, j, a, a, a);
            addPixel(i + 1, j, a, a, a);
            addPixel(i, j - 1, a, a, a);
            addPixel(i, j + 1, a, a, a);

            // Optional diagonals
            const hd = hash(x * 900.0 + 51, y * 900.0 + 57, z * 900.0 + 59);
            if (hd < 0.35) {
              const b = Math.floor(bright * 0.22);
              addPixel(i - 1, j - 1, b, b, b);
              addPixel(i + 1, j - 1, b, b, b);
              addPixel(i - 1, j + 1, b, b, b);
              addPixel(i + 1, j + 1, b, b, b);
            }
          }
        }
      }
    }

    ctx.putImageData(img, 0, 0);
    return c;
  }

  /* ----------------------------------------------------------
     Build cube texture from 6 faces
  ---------------------------------------------------------- */
  const faces = [
    makeFaceCanvas(0),
    makeFaceCanvas(1),
    makeFaceCanvas(2),
    makeFaceCanvas(3),
    makeFaceCanvas(4),
    makeFaceCanvas(5),
  ];

  const cube = new THREE.CubeTexture(faces);
  cube.colorSpace = THREE.SRGBColorSpace;
  cube.needsUpdate = true;

  // Keep crisp pixel look
  cube.generateMipmaps = false;
  cube.minFilter = THREE.NearestFilter;
  cube.magFilter = THREE.NearestFilter;

  return cube;
}