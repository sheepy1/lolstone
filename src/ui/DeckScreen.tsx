// 卡组编辑页（spec 5.1、第 7 节 M5）：卡组列表和编辑两个视图。主菜单的"我的卡组"进来。
// 列表：四套预组（只读，可复制）和自组卡组，新建、改名、复制、删除（删除要确认）。
// 编辑：左边卡池（按职业、费用、类型筛选，关键字搜索），右边当前卡组（按费用排、张数、30 张进度、法力曲线、问题提示）。
// 点卡加入，点卡组里的卡移除；不合规则时提示原因。悬停显示大卡和关键词说明。改动要点"保存"才写进存档。
// 键盘：Tab 在区域间移动；卡池网格和卡组列表里用方向键，Enter 加入或移除；"/" 跳到搜索框；Esc 返回上一层。
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { AppShell } from '../app/shell';
import { setUi, useUi } from '../app/store';
import { loadingArtUrl } from '../assets/manifest';
import { playSfx } from '../audio';
import { getCard, getHeroClass, type CardDef, type HeroClass } from '../engine';
import { KEYWORD_HELP } from '../presentation/keywordText';
import { CardThumb } from './CardThumb';
import { ConfirmDialog, NewDeckDialog, RenameDialog } from './DeckDialogs';
import {
  addProblem,
  clearDroppedNotice,
  countOf,
  createDeck,
  DECK_SIZE,
  deckProblems,
  deckRows,
  defaultDeckName,
  deleteDeck,
  getDeck,
  isPlayable,
  isPreset,
  loadDecks,
  manaCurve,
  MAX_COPIES,
  onDecksChange,
  poolFor,
  presetDeck,
  renameDeck,
  saveDeckCards,
  type SavedDeck,
} from './decks';
import { MenuBackdrop, Stage } from './hextech';
import { RadioGroup } from './RadioGroup';

const HERO_CLASSES: HeroClass[] = ['demacia', 'noxus', 'ionia', 'freljord'];
const hover = () => playSfx('ui.hover');

function useDecks() {
  const [, bump] = useState(0);
  useEffect(() => onDecksChange(() => bump((n) => n + 1)), []);
  return loadDecks();
}

export function DeckScreen({ app }: { app: AppShell }) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="hx-screen dk-screen">
      <MenuBackdrop />
      {editing ? <DeckEditor deckId={editing} onBack={() => setEditing(null)} onOpen={setEditing} /> : <DeckList app={app} onEdit={setEditing} />}
    </div>
  );
}

// ---------- 列表 ----------

type Dialog = { kind: 'new' } | { kind: 'rename'; deck: SavedDeck } | { kind: 'delete'; deck: SavedDeck } | null;

function DeckList({ app, onEdit }: { app: AppShell; onEdit: (id: string) => void }) {
  const { decks, dropped } = useDecks();
  const menuClass = useUi((s) => s.menu.humanClass);
  const presets = HERO_CLASSES.map(presetDeck);
  const all = [...presets, ...decks];
  const [selected, setSelected] = useState<string>(() => decks[0]?.id ?? presets[0]!.id);
  const [dialog, setDialog] = useState<Dialog>(null);
  const sel = all.find((d) => d.id === selected) ?? presets[0]!;
  const root = useRef<HTMLDivElement>(null);
  void app;

  // 进列表、关掉弹窗后，焦点回到选中的卡组上（弹窗开着时不抢弹窗的焦点）
  useEffect(() => {
    if (!dialog) root.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus({ preventScroll: true });
  }, [dialog]);

  const back = () => {
    playSfx('ui.click');
    setUi({ screen: 'menu' });
  };
  const copy = (d: SavedDeck) => {
    playSfx('ui.button');
    const n = createDeck(d.heroClass, isPreset(d.id) ? defaultDeckName(d.heroClass) : `${d.name} 副本`, d.cards);
    setSelected(n.id);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (dialog) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      back();
    }
  };

  const tile = (d: SavedDeck, checked: boolean, props: Record<string, unknown>) => {
    const problems = deckProblems(d.cards, d.heroClass);
    const ok = problems.length === 0;
    return (
      <button
        key={d.id}
        className={`dk-tile region-${d.heroClass} ${checked ? 'on' : ''}`}
        {...props}
        onDoubleClick={() => onEdit(d.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            playSfx('ui.button');
            onEdit(d.id);
          } else (props.onKeyDown as (e: KeyboardEvent<HTMLElement>) => void)(e);
        }}
      >
        <span className="dk-tile-art" style={{ backgroundImage: `url(${loadingArtUrl(getHeroClass(d.heroClass).champion)})` }} />
        <span className="dk-tile-class">{getHeroClass(d.heroClass).name}</span>
        {isPreset(d.id) && <span className="dk-tile-lock">只读</span>}
        <span className="dk-tile-name">{d.name}</span>
        <span className={`dk-tile-status ${ok ? 'ok' : 'warn'}`}>
          {d.cards.length}/{DECK_SIZE} · {ok ? '可以开局' : problems[0]}
        </span>
      </button>
    );
  };

  return (
    <div ref={root} onKeyDown={onKeyDown}>
      <Stage>
        <button className="hx-btn dk-back" onClick={back} onPointerEnter={hover}>
          ← 主菜单
        </button>
        <div className="dk-title">我的卡组</div>
        <button
          className="hx-cta dk-new"
          onPointerEnter={hover}
          onClick={() => {
            playSfx('ui.click');
            setDialog({ kind: 'new' });
          }}
        >
          <span className="hx-cta-text">新建卡组</span>
        </button>

        {dropped.length > 0 && (
          <div className="dk-notice" role="status">
            <span>
              有卡已经不在卡池里，读档时移除了：
              {dropped.map((d) => `「${d.deck}」${d.ids.length} 张（${d.ids.join('、')}）`).join('；')}
            </span>
            <button className="hx-btn dk-notice-close" onClick={clearDroppedNotice}>
              知道了
            </button>
          </div>
        )}

        <div className={`dk-list ${dropped.length > 0 ? 'with-notice' : ''}`}>
          <RadioGroup
            label="卡组"
            items={all.map((d) => d.id)}
            value={sel.id}
            onChange={(id) => {
              playSfx('ui.click');
              setSelected(id);
            }}
            render={(id, checked, props) => {
              const d = all.find((x) => x.id === id)!;
              const isFirstSaved = decks[0]?.id === id;
              return [
                id === presets[0]!.id ? <div key="h1" className="dk-group-label">预组卡组 · 只读，可以复制后修改</div> : null,
                isFirstSaved ? <div key="h2" className="dk-group-label">自组卡组</div> : null,
                tile(d, checked, props as unknown as Record<string, unknown>),
              ];
            }}
          />
          {decks.length === 0 && (
            <>
              <div className="dk-group-label">自组卡组</div>
              <div className="dk-empty">还没有自组卡组。点右上角"新建卡组"，或者选一套预组点"复制"，在它的基础上改。</div>
            </>
          )}
        </div>

        <div className="hx-panel dk-actions">
          <span className="dk-actions-name">
            {sel.name}
            <span className="dk-actions-sub">{isPlayable(sel) ? '可以用来开局' : deckProblems(sel.cards, sel.heroClass)[0]}</span>
          </span>
          <button
            className="hx-btn"
            onPointerEnter={hover}
            onClick={() => {
              playSfx('ui.button');
              onEdit(sel.id);
            }}
          >
            {isPreset(sel.id) ? '查看' : '编辑'}
          </button>
          <button className="hx-btn" disabled={isPreset(sel.id)} onPointerEnter={hover} onClick={() => setDialog({ kind: 'rename', deck: sel })}>
            改名
          </button>
          <button className="hx-btn" onPointerEnter={hover} onClick={() => copy(sel)}>
            复制
          </button>
          <button className="hx-btn dk-danger" disabled={isPreset(sel.id)} onPointerEnter={hover} onClick={() => setDialog({ kind: 'delete', deck: sel })}>
            删除
          </button>
        </div>
        <div className="dk-hint">
          <kbd>←</kbd>
          <kbd>→</kbd> 选择 · <kbd>Enter</kbd> 打开 · <kbd>Tab</kbd> 到操作按钮 · <kbd>Esc</kbd> 回主菜单
        </div>
      </Stage>

      {dialog?.kind === 'new' && (
        <NewDeckDialog
          initialClass={menuClass}
          onCancel={() => setDialog(null)}
          onCreate={(cls, name) => {
            playSfx('ui.button');
            const d = createDeck(cls, name);
            setDialog(null);
            onEdit(d.id);
          }}
        />
      )}
      {dialog?.kind === 'rename' && (
        <RenameDialog
          name={dialog.deck.name}
          onCancel={() => setDialog(null)}
          onRename={(name) => {
            playSfx('ui.button');
            renameDeck(dialog.deck.id, name);
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title="删除卡组"
          text={`删除「${dialog.deck.name}」？删除后不能恢复。`}
          onCancel={() => setDialog(null)}
          actions={[
            {
              label: '删除',
              danger: true,
              onClick: () => {
                playSfx('ui.button');
                deleteDeck(dialog.deck.id);
                setUi((s) => (s.menu.humanDeck === dialog.deck.id ? { menu: { ...s.menu, humanDeck: null } } : {}));
                setSelected(presets[0]!.id);
                setDialog(null);
              },
            },
          ]}
        />
      )}
    </div>
  );
}

// ---------- 编辑 ----------

type ClassFilter = 'all' | 'class' | 'neutral';
type TypeFilter = 'all' | 'minion' | 'spell';
const COSTS = ['all', '0', '1', '2', '3', '4', '5', '6', '7'] as const;
type CostFilter = (typeof COSTS)[number];
const GRID_COLS = 6;
const THUMB_W = 172;

function matches(def: CardDef, heroClass: HeroClass, cls: ClassFilter, type: TypeFilter, cost: CostFilter, q: string): boolean {
  if (cls === 'class' && def.class !== heroClass) return false;
  if (cls === 'neutral' && def.class !== 'neutral') return false;
  if (type !== 'all' && def.type !== type) return false;
  if (cost !== 'all' && (cost === '7' ? def.cost < 7 : def.cost !== Number(cost))) return false;
  if (q && !def.name.includes(q) && !def.text.includes(q)) return false;
  return true;
}

type Preview = { cardId: string; x: number; y: number } | null;

function DeckEditor({ deckId, onBack, onOpen }: { deckId: string; onBack: () => void; onOpen: (id: string) => void }) {
  const saved = isPreset(deckId) ? presetDeck(deckId.slice(7) as HeroClass) : getDeck(deckId);
  const readOnly = isPreset(deckId);
  const heroClass = saved?.heroClass ?? 'demacia';
  const [cards, setCards] = useState<string[]>(() => [...(saved?.cards ?? [])]);
  const [cls, setCls] = useState<ClassFilter>('all');
  const [type, setType] = useState<TypeFilter>('all');
  const [cost, setCost] = useState<CostFilter>('all');
  const [q, setQ] = useState('');
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);
  const [preview, setPreview] = useState<Preview>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [gridFocus, setGridFocus] = useState(0);
  const [rowFocus, setRowFocus] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const pool = useMemo(() => poolFor(heroClass), [heroClass]);
  const shown = pool.filter((d) => matches(d, heroClass, cls, type, cost, q.trim()));
  const rows = deckRows(cards);
  const curve = manaCurve(cards);
  const problems = deckProblems(cards, heroClass);
  const dirty = !readOnly && !!saved && cards.join() !== saved.cards.join();

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    gridRef.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus({ preventScroll: true });
  }, []);

  if (!saved) {
    return (
      <Stage>
        <div className="dk-title">这套卡组不存在了</div>
        <button className="hx-btn dk-back" onClick={onBack}>
          ← 卡组列表
        </button>
      </Stage>
    );
  }

  const say = (text: string) => setToast((t) => ({ text, n: (t?.n ?? 0) + 1 }));

  const add = (id: string) => {
    if (readOnly) {
      playSfx('ui.cancel');
      return say('预组卡组只读，复制一份再改');
    }
    const p = addProblem(cards, heroClass, id);
    if (p) {
      playSfx('ui.cancel');
      return say(p);
    }
    playSfx('ui.drop');
    setCards([...cards, id]);
  };
  const remove = (id: string) => {
    if (readOnly) {
      playSfx('ui.cancel');
      return say('预组卡组只读，复制一份再改');
    }
    const i = cards.lastIndexOf(id);
    if (i < 0) return;
    playSfx('ui.pickup');
    setCards([...cards.slice(0, i), ...cards.slice(i + 1)]);
  };
  const save = () => {
    if (!dirty) return;
    playSfx('ui.button');
    saveDeckCards(deckId, cards);
    say(problems.length === 0 ? '已保存，可以用来开局' : `已保存。${problems[0]}，还不能用来开局`);
  };
  const leave = () => {
    if (dirty) return setConfirmLeave(true);
    playSfx('ui.click');
    onBack();
  };
  const copyPreset = () => {
    playSfx('ui.button');
    const d = createDeck(heroClass, defaultDeckName(heroClass), cards);
    onOpen(d.id);
  };

  // 悬停预览：大卡放在被悬停元素旁边（右边放不下就放左边），坐标换算到 1920×1080 舞台里
  const showPreview = (cardId: string, el: HTMLElement) => {
    const stage = stageRef.current?.closest('.hx-stage') as HTMLElement | null;
    if (!stage) return;
    const s = stage.getBoundingClientRect();
    const scale = s.width / 1920;
    const r = el.getBoundingClientRect();
    const left = (r.left - s.left) / scale;
    const right = (r.right - s.left) / scale;
    const top = (r.top - s.top) / scale;
    const W = 330;
    const x = right + 16 + W < 1900 ? right + 16 : left - 16 - W;
    const y = Math.max(20, Math.min(1080 - 640, top - 60));
    setPreview({ cardId, x, y });
  };

  const onGridKey = (e: KeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: GRID_COLS, ArrowUp: -GRID_COLS }[e.key];
    if (step === undefined || shown.length === 0) return;
    e.preventDefault();
    const next = Math.max(0, Math.min(shown.length - 1, gridFocus + step));
    setGridFocus(next);
    const el = gridRef.current?.querySelectorAll<HTMLElement>('.dk-pool-card')[next];
    el?.focus();
    el?.scrollIntoView({ block: 'nearest' });
  };
  const onListKey = (e: KeyboardEvent) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      const r = rows[rowFocus];
      if (r) remove(r.def.id);
      return;
    }
    if (step === undefined || rows.length === 0) return;
    e.preventDefault();
    const next = Math.max(0, Math.min(rows.length - 1, rowFocus + step));
    setRowFocus(next);
    listRef.current?.querySelectorAll<HTMLElement>('.dk-row')[next]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (confirmLeave) return;
    const typing = (e.target as HTMLElement).tagName === 'INPUT';
    if (e.key === 'Escape') {
      e.preventDefault();
      if (typing && q) setQ('');
      else leave();
    } else if (e.key === '/' && !typing) {
      e.preventDefault();
      searchRef.current?.focus();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      save();
    }
  };

  const maxBar = Math.max(6, ...curve);
  const focusIndex = Math.min(gridFocus, Math.max(0, shown.length - 1));
  const rowIndex = Math.min(rowFocus, Math.max(0, rows.length - 1));

  return (
    <div onKeyDown={onKeyDown}>
      <Stage>
        <div ref={stageRef} className={`dk-editor region-${heroClass}`}>
          <button className="hx-btn dk-back" onClick={leave} onPointerEnter={hover}>
            ← 卡组列表
          </button>
          <div className="dk-ed-title">
            <span className="dk-ed-class">{getHeroClass(heroClass).name}</span>
            {saved.name}
            {readOnly ? <span className="dk-ed-state">只读</span> : dirty ? <span className="dk-ed-state warn">未保存</span> : <span className="dk-ed-state ok">已保存</span>}
          </div>
          {readOnly ? (
            <button className="hx-cta dk-save" onClick={copyPreset} onPointerEnter={hover}>
              <span className="hx-cta-text">复制并修改</span>
            </button>
          ) : (
            <button className="hx-cta dk-save" disabled={!dirty} onClick={save} onPointerEnter={hover}>
              <span className="hx-cta-text">保存</span>
            </button>
          )}

          {/* 卡池 */}
          <div className="hx-panel dk-pool">
            <div className="dk-filters">
              <RadioGroup
                label="职业"
                items={['all', 'class', 'neutral'] as ClassFilter[]}
                value={cls}
                onChange={(v) => {
                  playSfx('ui.click');
                  setCls(v);
                  setGridFocus(0);
                }}
                render={(id, checked, props) => (
                  <button key={id} className={`dk-chip ${checked ? 'on' : ''}`} {...props}>
                    {id === 'all' ? '全部' : id === 'class' ? getHeroClass(heroClass).name : '中立'}
                  </button>
                )}
              />
              <span className="dk-filter-gap" />
              <RadioGroup
                label="类型"
                items={['all', 'minion', 'spell'] as TypeFilter[]}
                value={type}
                onChange={(v) => {
                  playSfx('ui.click');
                  setType(v);
                  setGridFocus(0);
                }}
                render={(id, checked, props) => (
                  <button key={id} className={`dk-chip ${checked ? 'on' : ''}`} {...props}>
                    {id === 'all' ? '全部类型' : id === 'minion' ? '随从' : '法术'}
                  </button>
                )}
              />
              <input
                ref={searchRef}
                className="dk-search"
                value={q}
                placeholder="搜索卡名或描述（按 / ）"
                aria-label="搜索卡名或描述"
                onChange={(e) => {
                  setQ(e.target.value);
                  setGridFocus(0);
                }}
              />
            </div>
            <div className="dk-filters">
              <span className="dk-filter-label">费用</span>
              <RadioGroup
                label="费用"
                items={COSTS}
                value={cost}
                onChange={(v) => {
                  playSfx('ui.click');
                  setCost(v);
                  setGridFocus(0);
                }}
                render={(id, checked, props) => (
                  <button key={id} className={`dk-chip dk-cost-chip ${checked ? 'on' : ''}`} {...props}>
                    {id === 'all' ? '全部' : id === '7' ? '7+' : id}
                  </button>
                )}
              />
              <span className="dk-pool-count">{shown.length} 张</span>
            </div>
            <div className="dk-grid" ref={gridRef} onKeyDown={onGridKey} role="grid" aria-label="卡池" onScroll={() => setPreview(null)}>
              {shown.map((d, i) => {
                const n = countOf(cards, d.id);
                const problem = readOnly ? null : addProblem(cards, heroClass, d.id);
                return (
                  <button
                    key={d.id}
                    className={`dk-pool-card ${problem ? 'blocked' : ''} ${n > 0 ? 'in-deck' : ''}`}
                    tabIndex={i === focusIndex ? 0 : -1}
                    aria-label={`${d.name}，${d.cost} 费${n > 0 ? `，卡组里有 ${n} 张` : ''}${problem ? `，${problem}` : ''}`}
                    onClick={() => add(d.id)}
                    onFocus={(e) => {
                      setGridFocus(i);
                      showPreview(d.id, e.currentTarget);
                    }}
                    onBlur={() => setPreview(null)}
                    onPointerEnter={(e) => {
                      hover();
                      showPreview(d.id, e.currentTarget);
                    }}
                    onPointerLeave={() => setPreview(null)}
                  >
                    <CardThumb cardId={d.id} width={THUMB_W} />
                    {n > 0 && (
                      <span className={`dk-count ${n >= MAX_COPIES ? 'full' : ''}`}>
                        {n}/{MAX_COPIES}
                      </span>
                    )}
                  </button>
                );
              })}
              {shown.length === 0 && <div className="dk-empty">没有符合条件的卡</div>}
            </div>
          </div>

          {/* 当前卡组 */}
          <div className="hx-panel dk-deck">
            <div className="dk-progress">
              <span className={`dk-progress-num ${cards.length === DECK_SIZE ? 'full' : ''}`}>
                {cards.length}
                <small> / {DECK_SIZE}</small>
              </span>
              <div className="dk-progress-track">
                <div className="dk-progress-fill" style={{ width: `${(Math.min(cards.length, DECK_SIZE) / DECK_SIZE) * 100}%` }} />
              </div>
            </div>
            <div className="dk-curve" aria-label="法力曲线">
              {curve.map((n, i) => (
                <div key={i} className="dk-curve-col">
                  <span className="dk-curve-n">{n || ''}</span>
                  <span className="dk-curve-bar" style={{ height: `${(n / maxBar) * 100}%` }} />
                  <span className="dk-curve-cost">{i === 7 ? '7+' : i}</span>
                </div>
              ))}
            </div>
            <div className="dk-rows" ref={listRef} onKeyDown={onListKey} role="list" aria-label="当前卡组" onScroll={() => setPreview(null)}>
              {rows.map((r, i) => (
                <button
                  key={r.def.id}
                  className={`dk-row region-${r.def.class}`}
                  tabIndex={i === rowIndex ? 0 : -1}
                  aria-label={`${r.def.name} ${r.count} 张，按 Enter 移除一张`}
                  onClick={() => remove(r.def.id)}
                  onFocus={(e) => {
                    setRowFocus(i);
                    showPreview(r.def.id, e.currentTarget);
                  }}
                  onBlur={() => setPreview(null)}
                  onPointerEnter={(e) => {
                    hover();
                    showPreview(r.def.id, e.currentTarget);
                  }}
                  onPointerLeave={() => setPreview(null)}
                >
                  <span className="dk-row-cost">{r.def.cost}</span>
                  <span className="dk-row-name">{r.def.name}</span>
                  <span className={`dk-row-n ${r.count >= MAX_COPIES ? 'full' : ''}`}>×{r.count}</span>
                </button>
              ))}
              {rows.length === 0 && <div className="dk-empty small">点左边的卡加进卡组</div>}
            </div>
            <div className={`dk-problems ${problems.length === 0 ? 'ok' : ''}`} aria-live="polite">
              {problems.length === 0 ? '卡组合规，可以用来开局' : problems.slice(0, 2).join('；')}
            </div>
          </div>

          {toast && (
            <div key={toast.n} className="dk-toast" role="alert">
              {toast.text}
            </div>
          )}

          {preview && <CardPreview {...preview} />}
          <div className="dk-hint editor">
            点卡加入 · 点右边的卡移除 · <kbd>/</kbd> 搜索 · 方向键在卡池和卡组里移动 · <kbd>Delete</kbd> 移除 · <kbd>Esc</kbd> 返回
          </div>
        </div>
      </Stage>

      {confirmLeave && (
        <ConfirmDialog
          title="有未保存的修改"
          text="离开前要保存这套卡组的修改吗？"
          onCancel={() => setConfirmLeave(false)}
          actions={[
            {
              label: '放弃修改',
              danger: true,
              onClick: () => {
                playSfx('ui.click');
                onBack();
              },
            },
            {
              label: '保存并返回',
              onClick: () => {
                playSfx('ui.button');
                saveDeckCards(deckId, cards);
                onBack();
              },
            },
          ]}
        />
      )}
    </div>
  );
}

function CardPreview({ cardId, x, y }: { cardId: string; x: number; y: number }) {
  const def = getCard(cardId);
  const help = Object.entries(KEYWORD_HELP).filter(([k]) => def.text.includes(k));
  return (
    <div className="dk-preview" style={{ left: x, top: y }} aria-hidden>
      <CardThumb cardId={cardId} width={330} text />
      {help.length > 0 && (
        <div className="dk-preview-help">
          {help.map(([k, v]) => (
            <div key={k}>
              <b>{k}</b>：{v}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
