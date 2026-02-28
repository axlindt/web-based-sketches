// inputRipples.js
import * as THREE from "three";

/**
 * Binds pointer input to create ripples by raycasting onto a plane.
 *
 * Usage:
 *   const unbind = bindRipples({
 *     canvas,
 *     camera,
 *     waterPositionZ: waterPosition.z,
 *     addDrop: (x,y,r,s) => waterSystem.addDrop(x,y,r,s),
 *   });
 *
 * Call unbind() if you ever need to remove listeners.
 */
export function bindRipples({
  canvas,
  camera,
  waterPositionZ,
  addDrop,
  clamp = 1,
  radius = 0.03,
  strength = 0.01,
}) {
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  const waterPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -waterPositionZ);

  let dragging = false;

  const onDown = () => (dragging = true);
  const onUp = () => (dragging = false);

  const onMove = (e) => {
    if (!dragging) return;

    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(waterPlane, hit)) return;

    hit.x = THREE.MathUtils.clamp(hit.x, -clamp, clamp);
    hit.y = THREE.MathUtils.clamp(hit.y, -clamp, clamp);

    addDrop(hit.x, hit.y, radius, strength);
  };

  canvas.addEventListener("pointerdown", onDown);
  window.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointermove", onMove);

  // return cleanup
  return () => {
    canvas.removeEventListener("pointerdown", onDown);
    window.removeEventListener("pointerup", onUp);
    canvas.removeEventListener("pointermove", onMove);
  };
}