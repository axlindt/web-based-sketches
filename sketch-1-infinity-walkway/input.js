import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";

/** Create wheel-driven movement and mouse-look controls (Pointer Lock). */
export function createInput({ camera, domElement }) {
  const controls = new PointerLockControls(camera, domElement);

  // Travel is unbounded; wrapping happens in render step
  let travelRaw = 0;
  let travelSmooth = 0;

  const WHEEL_SENSITIVITY = 0.018; // bigger = faster
  const DAMPING = 0.08;            // bigger = snappier smoothing

  /** Accumulate wheel delta into “virtual travel” (no scrollbar). */
  function onWheel(e) {
    e.preventDefault();
    travelRaw += e.deltaY * WHEEL_SENSITIVITY;
  }

  /** Enable mouse-look when user clicks the canvas. */
  function onClick() {
    controls.lock();
  }

  window.addEventListener("wheel", onWheel, { passive: false });
  domElement.addEventListener("click", onClick);

  /** Smooth travel so motion feels like walking. */
  function update(dt) {
    const alpha = 1 - Math.pow(1 - DAMPING, dt * 60);
    travelSmooth += (travelRaw - travelSmooth) * alpha;
  }

  return {
    controls,
    update,
    get travelSmooth() {
      return travelSmooth;
    },
  };
}
