import type * as Three from "three";

export function disposeSceneResources(scene: Three.Scene | undefined, renderer: Three.WebGLRenderer | undefined): void {
  scene?.traverse((object) => {
    const disposable = object as Three.Object3D & {
      geometry?: { dispose?: () => void };
      material?: Three.Material | Three.Material[];
    };
    disposable.geometry?.dispose?.();
    const material = disposable.material;
    if (Array.isArray(material)) material.forEach(disposeMaterial);
    else if (material) disposeMaterial(material);
  });
  renderer?.dispose();
}

function disposeMaterial(material: Three.Material): void {
  const maybeMapped = material as Three.Material & { map?: { dispose?: () => void } };
  maybeMapped.map?.dispose?.();
  material.dispose();
}
