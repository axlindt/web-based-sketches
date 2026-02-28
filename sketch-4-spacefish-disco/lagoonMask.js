import * as THREE from "three";

/* ----------------------------------------------------------
   LAGOON MASK TEXTURE
----------------------------------------------------------

Creates a procedural grayscale mask texture representing
the shape of the lagoon.

White (1.0)  = water (simulation allowed)
Black (0.0)  = land  (waves absorbed / drops ignored)

This texture is used by:
- Water simulation shaders (to block waves outside lagoon)
- Water surface shader (to discard pixels outside lagoon)

The lagoon shape is:
- An ellipse
- Rotated
- Distorted with noise
- Softened at edges using feathering

---------------------------------------------------------- */
export function makeLagoonMaskTexture(
  size = 512,      // texture resolution (square)
  rx = 0.42,       // ellipse X radius in UV space (0..0.5ish)
  ry = 0.30,       // ellipse Y radius
  rotation = 0.20, // ellipse rotation (radians)
  noiseAmp = 0.5,  // shoreline distortion strength
  noiseFreq = 6.0, // noise frequency (detail level)
  feather = 0.015, // soft transition width at shoreline
  seed = 1.234,    // change to generate new lagoon shape
) {
  // Create offscreen canvas
  const c = document.createElement("canvas");
  c.width = c.height = size;

  const ctx = c.getContext("2d");
  const img = ctx.createImageData(size, size);
  const data = img.data;

  /* ----------------------------------------------------------
     Utility: smoothstep
     Produces smooth interpolation between 0 and 1
     Used for feathered shoreline transition.
  ---------------------------------------------------------- */
  const smoothstep = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  /* ----------------------------------------------------------
     Simple coherent noise (sum of sine waves)
     Not true Perlin noise, but good enough for shoreline wobble.
     Output roughly in range [-1, 1]
  ---------------------------------------------------------- */
  const noise2 = (x, y) => {
    const n =
      Math.sin((x * 1.7 + y * 1.3) * noiseFreq + seed) +
      Math.sin((x * -1.1 + y * 1.9) * (noiseFreq * 0.73) + seed * 2.1) +
      Math.sin((x * 2.3 + y * -0.7) * (noiseFreq * 0.51) + seed * 3.7);
    return n / 3;
  };

  // Center of texture in UV space
  const cx = 0.5;
  const cy = 0.5;

  // Precompute rotation matrix
  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);

  /* ----------------------------------------------------------
     Generate texture pixel-by-pixel
  ---------------------------------------------------------- */
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {

      // Convert pixel index to UV space [0,1]
      const u = (i + 0.5) / size;
      const v = (j + 0.5) / size;

      // Center coordinates around (0,0) → [-0.5, 0.5]
      let x = u - cx;
      let y = v - cy;

      // Rotate coordinates (ellipse rotation)
      const xr = x * cosR - y * sinR;
      const yr = x * sinR + y * cosR;

      // Compute normalized ellipse distance
      // r = 1 means exactly on boundary
      const r = Math.sqrt((xr * xr) / (rx * rx) + (yr * yr) / (ry * ry));

      // Add noise distortion to shoreline
      const n = noise2(xr, yr) * noiseAmp;
      const rd = r + n;

      /* ----------------------------------------------------------
         Determine if inside lagoon:
         rd < 1 → inside
         Use smoothstep to feather shoreline.
      ---------------------------------------------------------- */
      const edge0 = 1.0 - feather;
      const edge1 = 1.0 + feather;

      const inside = 1.0 - smoothstep(edge0, edge1, rd);

      // Convert to grayscale value (0–255)
      const g = Math.floor(inside * 255);

      const idx = (j * size + i) * 4;
      data[idx + 0] = g; // R
      data[idx + 1] = g; // G
      data[idx + 2] = g; // B
      data[idx + 3] = 255; // A (fully opaque)
    }
  }

  // Push pixel data to canvas
  ctx.putImageData(img, 0, 0);

  /* ----------------------------------------------------------
     Convert canvas into THREE texture
     - ClampToEdge to avoid wrapping artifacts
     - NoColorSpace because this is data, not color
  ---------------------------------------------------------- */
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;

  return tex;
}