/** GSAP is loaded lazily, as its own chunk, and only when Liquid Glass motion is on.
 * It is never part of the first-screen bundle. */

type Gsap = typeof import("gsap").gsap;

let instance: Gsap | null = null;
let loading: Promise<Gsap> | null = null;

export function loadGsap(): Promise<Gsap> {
  if (instance) return Promise.resolve(instance);
  loading ??= import("gsap").then((m) => (instance = m.gsap));
  return loading;
}

/** The loaded instance, or null if it isn't there yet (callers then skip the animation). */
export function gsapNow(): Gsap | null {
  return instance;
}
