import { nextTick, onBeforeUnmount, onMounted, type Ref } from "vue";

type Gsap = typeof import("gsap")["gsap"];
type GsapContext = ReturnType<Gsap["context"]>;
type GsapTweenTarget = Parameters<Gsap["from"]>[0];
type GsapTweenVars = NonNullable<Parameters<Gsap["from"]>[1]>;

export type GsapAnimationScope = Ref<HTMLElement | null>;

let gsapPromise: Promise<Gsap> | undefined;

export async function loadGsap(): Promise<Gsap> {
  gsapPromise ??= import("gsap").then((module) => module.gsap);
  return gsapPromise;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Runs GSAP inside a component-owned scope and reverts every tween on unmount.
 * Keep component usage declarative: pass a root element, query only inside it,
 * and animate transform/opacity properties so the dashboard remains cheap to keep open.
 */
export function useGsapScope(scope: GsapAnimationScope, animate: (element: HTMLElement, gsap: Gsap) => void) {
  let context: GsapContext | undefined;
  let runId = 0;

  function cleanup(): void {
    context?.revert();
    context = undefined;
  }

  async function run(): Promise<void> {
    if (prefersReducedMotion()) return;
    const currentRunId = ++runId;
    await nextTick();
    const element = scope.value;
    if (!element) return;
    const gsap = await loadGsap();
    if (currentRunId !== runId || !scope.value) return;
    cleanup();
    context = gsap.context(() => animate(element, gsap), element);
  }

  onMounted(() => {
    void run();
  });

  onBeforeUnmount(cleanup);

  return { run, cleanup };
}

export function animateSubtleEntrance(gsap: Gsap, targets: GsapTweenTarget, options: GsapTweenVars = {}): void {
  if (isEmptyTargetList(targets)) return;
  gsap.from(targets, {
    y: 10,
    autoAlpha: 0,
    duration: 0.32,
    ease: "power2.out",
    stagger: 0.035,
    clearProps: "transform,opacity,visibility",
    ...options
  });
}

function isEmptyTargetList(targets: GsapTweenTarget): boolean {
  if (!targets) return true;
  if (Array.isArray(targets)) return targets.length === 0;
  if (typeof NodeList !== "undefined" && targets instanceof NodeList) return targets.length === 0;
  if (typeof HTMLCollection !== "undefined" && targets instanceof HTMLCollection) return targets.length === 0;
  return false;
}
