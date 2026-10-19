// 导演（spec 5.8）：事件队列与调度。
// 事件按到达顺序串行播放；同一批（一次 applyAction 的返回值，或对局层插的一个事件）里相邻且 group 相同的
// 事件合成一步，一步里的事件并行播放。每播完一步，显示局面推进到这一步之后，所以显示局面落后于真实局面，
// 动画播完才追上。怎么播由注入的 StepPlayer 决定，导演本身不依赖 GSAP 和 Pixi，能在 Node 里测试。
import type { PresentationEvent } from './events';
import { reduceView, type ViewState } from './viewState';

// 一步：同一批里相邻、group 相同的事件。
export type Step = {
  batch: number;
  group: number;
  events: PresentationEvent[];
};

// 播放一步。before 是这一步之前的显示局面，after[i] 是推进完第 i 个事件之后的显示局面。
// 返回的 Promise 完成就是这一步播完。
export type StepPlayer = (step: Step, before: ViewState, after: ViewState[]) => Promise<void>;

export type DirectorListener = (d: Director) => void;

export function splitSteps(batch: number, events: readonly PresentationEvent[]): Step[] {
  const steps: Step[] = [];
  for (const e of events) {
    const last = steps[steps.length - 1];
    if (last && last.group === e.group) last.events.push(e);
    else steps.push({ batch, group: e.group, events: [e] });
  }
  return steps;
}

export class Director {
  private queue: Step[] = [];
  private view: ViewState;
  private running = false;
  private nextBatch = 1;
  private listeners = new Set<DirectorListener>();
  private idleWaiters: (() => void)[] = [];
  // 播放出错时记下来，不让一个动画模块的错误卡住整局
  readonly errors: unknown[] = [];

  constructor(
    initial: ViewState,
    private readonly player: StepPlayer,
  ) {
    this.view = initial;
  }

  // 玩家看到的局面。
  get displayed(): ViewState {
    return this.view;
  }

  // 队列里还有没播完的事件。为 true 时显示局面还没追上真实局面，输入要锁定（spec 6.6）。
  get busy(): boolean {
    return this.running || this.queue.length > 0;
  }

  // 放进一批事件。一批是一次 applyAction 返回的全部事件，或对局层自己插的事件。
  enqueue(events: readonly PresentationEvent[]): void {
    if (events.length === 0) return;
    this.queue.push(...splitSteps(this.nextBatch++, events));
    this.notify();
    void this.pump();
  }

  // 队列播空时完成。
  whenIdle(): Promise<void> {
    if (!this.busy) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  // 显示局面推进、忙闲变化时通知。
  subscribe(fn: DirectorListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn(this);
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    while (this.queue.length > 0) {
      const step = this.queue.shift()!;
      const before = this.view;
      const after: ViewState[] = [];
      let v = before;
      for (const e of step.events) {
        v = reduceView(v, e);
        after.push(v);
      }
      try {
        await this.player(step, before, after);
      } catch (err) {
        this.errors.push(err);
        console.error('[director] step failed', step, err);
      }
      this.view = v;
      this.notify();
    }
    this.running = false;
    this.notify();
    for (const w of this.idleWaiters.splice(0)) w();
  }
}
