// 棋盘上的小部件：法力条、牌库、结束回合按钮、棋盘背景。占位图形，M4 换素材。
import gsap from 'gsap';
import { Container, Graphics, Text } from 'pixi.js';
import type { ManaSnapshot } from '../engine';
import { MANA_CELL, RIVER_Y, STAGE_H, STAGE_W } from '../presentation/layout';
import { COLORS, FONT_CN, FONT_NUM } from './theme';

function label(text: string, size: number, fill = 0xffffff, font = FONT_CN): Text {
  const t = new Text({ text, style: { fontFamily: font, fontSize: size, fill, fontWeight: '700', stroke: { color: 0x000000, width: 4 } } });
  t.anchor.set(0.5);
  t.resolution = 2;
  return t;
}

// 棋盘：俯视的峡谷占位版。上下两块草地，中间一条河道。
export class BoardView extends Container {
  constructor() {
    super();
    const g = new Graphics();
    g.rect(0, 0, STAGE_W, STAGE_H).fill(COLORS.boardEdge);
    g.roundRect(200, 110, STAGE_W - 400, STAGE_H - 220, 40).fill(COLORS.boardGround);
    g.roundRect(330, 330, STAGE_W - 660, 160, 30).fill({ color: COLORS.lane, alpha: 0.6 });
    g.roundRect(330, 590, STAGE_W - 660, 160, 30).fill({ color: COLORS.lane, alpha: 0.6 });
    g.rect(200, RIVER_Y - 26, STAGE_W - 400, 52).fill(COLORS.river);
    g.rect(200, RIVER_Y - 4, STAGE_W - 400, 8).fill({ color: COLORS.riverLight, alpha: 0.6 });
    this.addChild(g);
    // 河面反光，缓慢移动（spec 5.2 的环境动画占位）
    const shine = new Graphics().rect(-80, RIVER_Y - 22, 160, 44).fill({ color: 0xffffff, alpha: 0.07 });
    shine.x = 200;
    this.addChild(shine);
    gsap.to(shine, { x: STAGE_W - 200, duration: 14, repeat: -1, ease: 'none' });
  }
}

// 法力条：10 格。可用的亮，用掉的暗，临时法力另一种颜色。
export class ManaBarView extends Container {
  private cells = new Graphics();
  private text = label('', 26, 0xffffff, FONT_NUM);
  readonly flash = new Graphics();

  constructor() {
    super();
    this.text.position.set(-36, 0);
    this.flash.rect(-4, -16, MANA_CELL * 10 + 8, 32).fill(0xffffff);
    this.flash.alpha = 0;
    this.addChild(this.cells, this.text, this.flash);
  }

  set(m: ManaSnapshot): void {
    const g = this.cells.clear();
    for (let i = 0; i < 10; i++) {
      const x = i * MANA_CELL;
      const pts = [x + 6, -14, x + MANA_CELL - 4, -14, x + MANA_CELL - 10, 14, x, 14];
      let color: number = COLORS.manaEmpty;
      let alpha = 0.5;
      if (i < m.current) {
        // 法力药水给的临时法力在最后几格
        color = i >= m.current - m.temp ? COLORS.manaTemp : COLORS.mana;
        alpha = 1;
      } else if (i < m.max) {
        color = COLORS.manaEmpty;
        alpha = 1;
      }
      g.poly(pts).fill({ color, alpha }).stroke({ width: 2, color: 0x0a1020, alpha: 0.9 });
    }
    this.text.text = `${m.current}/${m.max}`;
  }
}

// 牌库：一叠卡背，厚度随剩余张数变。悬停显示张数。
export class DeckView extends Container {
  private stack = new Graphics();
  private countText = label('', 26);
  private tip = new Container();

  constructor() {
    super();
    this.countText.position.set(0, 0);
    const tipBg = new Graphics().roundRect(-70, -24, 140, 48, 10).fill({ color: 0x000000, alpha: 0.8 });
    this.tip.addChild(tipBg, this.countText);
    this.tip.position.set(-150, 0);
    this.tip.visible = false;
    this.addChild(this.stack, this.tip);
    this.eventMode = 'static';
    this.on('pointerover', () => (this.tip.visible = true));
    this.on('pointerout', () => (this.tip.visible = false));
  }

  set(count: number, fatigue: number): void {
    const g = this.stack.clear();
    const layers = Math.ceil(count / 3);
    for (let i = 0; i < Math.max(1, layers); i++) {
      g.roundRect(-46 - i, -64 - i * 2, 92, 128, 8)
        .fill(count === 0 ? 0x202020 : COLORS.cardBack)
        .stroke({ width: 2, color: count === 0 ? 0x404040 : COLORS.hexGold });
    }
    this.countText.text = count > 0 ? `牌库 ${count} 张` : `牌库空 疲劳${fatigue}`;
  }
}

// 结束回合按钮：海克斯风格的菱形按钮。我方回合亮起并缓慢脉动，对方回合变暗显示"对方回合"。
export class EndTurnButton extends Container {
  private bg = new Graphics();
  private text = label('结束回合', 30);
  private pulse: gsap.core.Tween | null = null;
  private mode: 'mine' | 'theirs' | 'off' = 'off';

  constructor(onClick: () => void) {
    super();
    this.addChild(this.bg, this.text);
    this.eventMode = 'static';
    this.on('pointertap', (e) => {
      e.stopPropagation();
      if (this.mode === 'mine') onClick();
    });
    this.setMode('off', false);
  }

  // mine：我方回合；ready 为 true 时没有可做的事了，按钮更亮提醒。
  setMode(mode: 'mine' | 'theirs' | 'off', ready: boolean): void {
    this.mode = mode;
    const g = this.bg.clear();
    const w = 190;
    const h = 74;
    const color = mode === 'mine' ? (ready ? 0x2fbf4f : 0xc8aa6e) : 0x3a3a3a;
    g.poly([-w / 2, 0, -w / 2 + 26, -h / 2, w / 2 - 26, -h / 2, w / 2, 0, w / 2 - 26, h / 2, -w / 2 + 26, h / 2])
      .fill(color)
      .stroke({ width: 4, color: 0x1a1a1a });
    this.text.text = mode === 'theirs' ? '对方回合' : '结束回合';
    this.text.style.fill = mode === 'mine' ? 0xffffff : 0x9a9a9a;
    this.cursor = mode === 'mine' ? 'pointer' : 'default';
    if (mode === 'mine' && !this.pulse) {
      this.pulse = gsap.to(this.scale, { x: 1.05, y: 1.05, duration: 0.9, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    } else if (mode !== 'mine' && this.pulse) {
      this.pulse.kill();
      this.pulse = null;
      this.scale.set(1);
    }
  }
}

// 对方思考中的提示。
export class ThinkingView extends Container {
  constructor() {
    super();
    const bg = new Graphics().roundRect(-90, -22, 180, 44, 22).fill({ color: 0x000000, alpha: 0.65 });
    this.addChild(bg, label('对方思考中…', 22, 0xe0e0e0));
    this.visible = false;
  }
}
