// 悬停在场上随从的关键词小图标上时，找出是哪个关键词（spec 5.4"悬停显示说明"）。
// 输入（interaction.ts）只认到随从这一级，这里另外对图标那一排做一次射线检测，按交点的 uv 查是第几个图标。
// 说明文字和悬停随从时的关键词面板是同一份（HoverCard.tsx 用 KEYWORD_HELP），悬停的那个排在最前、高亮。
import * as THREE from 'three';
import { KEYWORD_NAMES } from '../presentation/keywordText';
import type { Keyword } from '../engine';
import type { TableScene } from './table';

// 图标那一排的 key（关键词，加法术伤害、沉默）对应 KEYWORD_HELP 里的词条名
export function keywordHelpName(key: string): string {
  if (key === 'spell_damage') return '法术伤害';
  if (key === 'silence') return '沉默';
  return KEYWORD_NAMES[key as Keyword] ?? key;
}

export class KeywordHover {
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private current: string | null = null;

  constructor(
    private readonly scene: TableScene,
    private readonly onChange: (helpName: string | null) => void,
  ) {
    window.addEventListener('pointermove', this.onMove);
  }

  private readonly onMove = (e: PointerEvent): void => {
    const canvas = this.scene.stage.canvas;
    const r = canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.scene.stage.camera);
    let found: string | null = null;
    for (const m of this.scene.minions.values()) {
      if (!m.visible || !m.iconPlane.visible) continue;
      const hit = this.ray.intersectObject(m.iconPlane, false)[0];
      const key = hit?.uv ? m.keywordAtUv(hit.uv.x) : null;
      if (key) {
        found = keywordHelpName(key);
        break;
      }
    }
    if (found === this.current) return;
    this.current = found;
    this.onChange(found);
  };

  destroy(): void {
    window.removeEventListener('pointermove', this.onMove);
  }
}
