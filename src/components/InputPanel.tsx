import type { RefObject } from 'react';

/** Native textarea editing retains Chromium undo/redo history. */
export function InputPanel({ hidden, busy, sourceRef, onInput }: { hidden: boolean; busy: boolean; sourceRef: RefObject<HTMLTextAreaElement | null>; onInput: (value: string) => void }) {
  return <section className="panel" id="input-panel" role="tabpanel" aria-labelledby="input-tab" hidden={hidden} inert={hidden}>
    <textarea id="source" ref={sourceRef} spellCheck={false} readOnly={busy} placeholder="在此输入或粘贴文本…" aria-label="待输入文本" aria-describedby="text-count status-message" onInput={event => onInput(event.currentTarget.value)} />
  </section>;
}
