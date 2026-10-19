// 销毁 3D 物件和它们占的显存。
// 几何体、材质、贴图默认归物件自己，物件销毁时一起释放；多个物件、多局之间共用的（模块级常量、卡面缓存）
// 用 shared() 标记，不释放。漏标会让共用资源被提前释放；漏释放会让每局都留一份显存，连开多局后页面崩溃。
import gsap from 'gsap';
import type * as THREE from 'three';

type HasUserData = { userData: Record<string, unknown> };

export function shared<T extends HasUserData>(x: T): T {
  x.userData.shared = true;
  return x;
}

const isShared = (x: HasUserData | null | undefined) => !x || x.userData.shared === true;

// 停掉一棵物件树上的全部动画。不用 killTweensOf：它对每个目标都扫一遍全部活着的补间，满场同时死亡时
// 一帧光这一项就要 5 到 9ms。这里反过来，把树上的目标放进集合，全部补间只扫一遍
function killTree(o: THREE.Object3D): void {
  const targets = new Set<object>();
  o.traverse((c) => {
    targets.add(c);
    targets.add(c.position);
    targets.add(c.rotation);
    targets.add(c.scale);
  });
  for (const t of gsap.globalTimeline.getChildren(true, true, false) as gsap.core.Tween[]) {
    if (t.targets().some((x) => targets.has(x as object))) t.kill();
  }
}


// 释放贴图；canvas 贴图顺手把 canvas 缩成 0×0。canvas 的像素内存不在 JS 堆里，垃圾回收按堆的压力触发，
// 飘字、横幅、血条这类一次性 canvas 只靠回收会越积越多，连续自动对局几分钟后页面就崩了。
export function releaseTexture(t: THREE.Texture): void {
  t.dispose();
  const img = t.image as { width?: number; height?: number; getContext?: unknown } | null;
  if (img && typeof img.getContext === 'function') {
    img.width = 0;
    img.height = 0;
  }
}

// 材质上挂的全部贴图（map、normalMap、emissiveMap、envMap……按属性值找，不列名字，免得漏）。
// 着色器 uniform 里的贴图不算：troika 文字的材质在 uniform 里放着全局的 SDF 字体图集，那是共用的
function texturesOf(m: THREE.Material): THREE.Texture[] {
  return Object.values(m).filter((v): v is THREE.Texture => !!v && (v as THREE.Texture).isTexture === true);
}

// 释放一棵物件树里不共用的几何体、材质、贴图和灯光的阴影贴图（不改场景结构）。
// 漏释放的后果是每局留一份：原来只放 map、emissiveMap、alphaMap 三种贴图，水面的法线贴图每局漏一张；
// 投影的方向光不调 dispose，2048×2048 的阴影深度贴图每局漏一张（约 16 MB 显存）
export function releaseGpu(root: THREE.Object3D): void {
  root.traverse((o) => {
    if ((o as THREE.Light).isLight) (o as THREE.Light).dispose();
    const mesh = o as THREE.Mesh | THREE.Sprite | THREE.Points;
    const geo = (mesh as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (geo && !isShared(geo)) geo.dispose();
    const mat = (mesh as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      if (isShared(m)) continue;
      for (const t of texturesOf(m)) if (!isShared(t)) releaseTexture(t);
      m.dispose();
    }
  });
}

export function dispose(obj: THREE.Object3D): void {
  killTree(obj);
  obj.removeFromParent();
  releaseGpu(obj);
}

// 缩小消失后销毁（3D 物件共用材质，不能靠改透明度淡出）。
export function fadeOutAndDispose(obj: THREE.Object3D, duration = 0.2): void {
  gsap.killTweensOf(obj.scale);
  gsap.to(obj.scale, { x: 0.01, y: 0.01, z: 0.01, duration, ease: 'power2.in', onComplete: () => dispose(obj) });
}
