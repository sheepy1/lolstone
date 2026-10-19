// 疲劳（m4-storyboard E05，1200ms）：一张疲劳牌（牌背加"疲劳"和伤害数）从牌库飞到中央放大（350ms 落），停 300ms，
// 再变暗缩小着消散（200ms 飘）。伤害本身是紧接着的 damage 事件（E24，战斗那一路做）。
// 声音：flow.fatigue（低沉钟声）在展示 t=0。
import * as THREE from 'three';
import { Text } from 'troika-three-text';
import { playSfx } from '../../audio';
import { cardFontUrl } from '../../assets/manifest';
import { HIDDEN_CARD_ID } from '../../engine';
import type { CardView } from '../../scene/cardView';
import { dispose } from '../../scene/dispose';
import { above, deckSlot, showcaseSlot } from '../layout';
import type { AnimModule } from './types';
import { syncTo, tl, toSlot } from './util';

export const FATIGUE = { show: 0.35, hold: 0.3, fade: 0.2 };

function label(text: string, size: number, color: number, y: number): Text {
  const t = new Text();
  t.font = cardFontUrl();
  t.text = text;
  t.fontSize = size;
  t.anchorX = 'center';
  t.anchorY = 'middle';
  t.color = color;
  t.outlineWidth = '6%';
  t.outlineColor = 0x000000;
  t.position.set(0, y, 0.06);
  t.sync();
  return t;
}

export const fatigue: AnimModule<'fatigue'> = (e, { scene, after }) => {
  const t = tl();
  const P = FATIGUE;
  const p = scene.place(e.side);
  const holder: { card: CardView | null } = { card: null };
  t.call(() => {
    const deck = deckSlot(p);
    playSfx('flow.fatigue', { pan: scene.panAt(deck.pos) });
    const c = scene.makeCard(-1000 - e.amount, HIDDEN_CARD_ID, { ...deck, pos: above(deck.pos, 0.6) });
    c.body.add(label('疲劳', 0.34, 0xd8c0ff, 0.45), label(String(e.amount), 0.9, 0xff5a5a, -0.25));
    holder.card = c;
    toSlot(c, showcaseSlot(), P.show, 'power2.out');
  });
  t.to({}, { duration: P.show + P.hold });
  t.call(() => {
    const c = holder.card;
    if (!c) return;
    const st = { k: 1 };
    // 消散（飘的消失段）：缩小、上浮，卡背变暗
    c.body.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !(o instanceof Text) && m.material) m.material = (m.material as THREE.Material).clone();
    });
    const y0 = c.position.y;
    t.to(st, {
      k: 0,
      duration: P.fade,
      ease: 'power1.in',
      onUpdate: () => {
        c.scale.setScalar(1.7 * (0.6 + 0.4 * st.k));
        c.position.y = y0 + (1 - st.k) * 0.5;
        c.body.traverse((o) => {
          const m = o as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
          if (m.isMesh && !(o instanceof Text) && m.material?.color) m.material.color.setScalar(st.k);
        });
      },
      onComplete: () => dispose(c),
    });
  });
  t.to({}, { duration: P.fade });
  t.add(syncTo(scene, after, 0.1));
  return { tl: t, tail: 0.1 };
};
