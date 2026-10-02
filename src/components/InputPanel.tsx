import type { RefObject } from 'react';

/** Native textarea editing retains Chromium undo/redo history. */
export function InputPanel({ hidden, busy, text, sourceRef, onInput }: { hidden: boolean; busy: boolean; text: string; sourceRef: RefObject<HTMLTextAreaElement | null>; onInput: (value: string) => void }) {
  const count = Array.from(text.replace(/\r\n?/g, '\n')).length;
  return <section className="panel" id="input-panel" role="tabpanel" aria-labelledby="input-tab" hidden={hidden} inert={hidden}>
    <textarea id="source" ref={sourceRef} spellCheck={false} readOnly={busy} placeholder="在此输入或粘贴文本…" aria-label="待输入文本" aria-describedby="text-count text-note" onInput={event => onInput(event.currentTarget.value)} />
    <div className="editor-meta"><span id="text-count">{count} 个字符</span><span id="text-note" title="Enter 可能提交命令或表单，Tab 可能切换输入控件。">保留空格与换行 · Enter / Tab 按目标程序处理</span></div>
  </section>;
}
