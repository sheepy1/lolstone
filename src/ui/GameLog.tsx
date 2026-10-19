// 对局日志（spec 5.2）：藏在右侧，默认收起，调试 AI 时拉出来。
import { useEffect, useRef } from 'react';
import { setUi, useUi } from '../app/store';

export function GameLog() {
  const open = useUi((s) => s.logOpen);
  const log = useUi((s) => s.log);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) end.current?.scrollIntoView({ block: 'end' });
  }, [open, log]);
  return (
    <div className={`game-log ${open ? 'open' : ''}`}>
      <button className="log-toggle" onClick={() => setUi({ logOpen: !open })}>
        {open ? '收起日志 ▶' : '◀ 日志'}
      </button>
      {open && (
        <div className="log-body">
          {log.map((line, i) => (
            <div key={i} className={line.startsWith('——') ? 'log-turn' : 'log-line'}>
              {line}
            </div>
          ))}
          <div ref={end} />
        </div>
      )}
    </div>
  );
}
