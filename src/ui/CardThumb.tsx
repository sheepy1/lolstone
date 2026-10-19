// 2D 卡面（卡组编辑页用）：底图就是对局里 3D 卡牌用的那张 canvas 贴图（scene/canvasArt.ts 的 cardFaceTexture：边框、原画、
// 费用六边形、名字横幅、文本框），画进一个 DOM canvas；费用、名字、攻击生命和正文在 3D 里是 SDF 文字叠上去的，这里用 DOM 叠，
// 位置按贴图 512×716 的坐标换成百分比。原画稍后才加载好时贴图会重画（texture.version 增加），这里定时看一眼，变了就重画。
import { useEffect, useRef } from 'react';
import { getCard } from '../engine';
import { cardFaceTexture } from '../scene/canvasArt';

const FACE_W = 512;
const FACE_H = 716;

const redraws = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
function watch(fn: () => void): () => void {
  redraws.add(fn);
  timer ??= setInterval(() => redraws.forEach((f) => f()), 300);
  return () => {
    redraws.delete(fn);
    if (redraws.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const pct = (v: number, of: number) => `${(v / of) * 100}%`;

export function CardThumb({ cardId, width, text = false }: { cardId: string; width: number; text?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const def = getCard(cardId);
  const height = Math.round((width * FACE_H) / FACE_W);
  // 舞台按窗口缩放，再乘设备像素比；画布分辨率按 1.5 倍宽留余量，缩小时也清楚
  const backing = Math.round(width * Math.min(2, (globalThis.devicePixelRatio || 1) * 1.5));

  useEffect(() => {
    const tex = cardFaceTexture(cardId);
    let drawn = -1;
    const draw = () => {
      const c = ref.current;
      if (!c || tex.version === drawn) return;
      drawn = tex.version;
      const g = c.getContext('2d');
      if (!g) return;
      g.clearRect(0, 0, c.width, c.height);
      g.drawImage(tex.image as HTMLCanvasElement, 0, 0, c.width, c.height);
    };
    draw();
    return watch(draw);
  }, [cardId]);

  const darkText = def.class === 'demacia'; // 德玛西亚的文本框是浅色底
  const f = (k: number) => `${Math.round(width * k * 10) / 10}px`;
  return (
    <span className={`ct region-${def.class}`} style={{ width, height }}>
      <canvas ref={ref} width={backing} height={Math.round((backing * FACE_H) / FACE_W)} className="ct-face" />
      <span className="ct-cost" style={{ left: pct(70, FACE_W), top: pct(70, FACE_H), fontSize: f(0.12) }}>
        {def.cost}
      </span>
      <span className="ct-name" style={{ top: pct(431.8, FACE_H), fontSize: f(def.name.length > 6 ? 0.066 : 0.082) }}>
        {def.name}
      </span>
      {text && (
        <span
          className={`ct-text ${darkText ? 'dark' : ''}`}
          style={{ left: pct(48, FACE_W), top: pct(474.8, FACE_H), width: pct(416, FACE_W), height: pct(181.2 - 30, FACE_H), fontSize: f(0.05) }}
        >
          {def.text}
        </span>
      )}
      {def.type === 'minion' && (
        <>
          <span className="ct-stat" style={{ left: pct(72, FACE_W), top: pct(644, FACE_H), fontSize: f(0.11) }}>
            {def.attack}
          </span>
          <span className="ct-stat" style={{ left: pct(440, FACE_W), top: pct(644, FACE_H), fontSize: f(0.11) }}>
            {def.health}
          </span>
        </>
      )}
    </span>
  );
}
