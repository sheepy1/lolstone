// 对局层插的等待：对手"思考"的间隔（spec 5.8）。
import type { AnimModule } from './types';
import { tl } from './util';

export const aiThinking: AnimModule<'ai_thinking'> = (e, { scene }) => {
  const t = tl();
  t.call(() => {
    scene.thinking.visible = true;
  });
  t.to({}, { duration: e.seconds });
  t.call(() => {
    scene.thinking.visible = false;
  });
  return { tl: t };
};
