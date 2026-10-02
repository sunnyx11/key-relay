import { defaults, type DraftSettings, type Settings } from '../bridge';

/** Settings fields keep invalid drafts visible and show errors beside their controls. */
export function SettingsPanel({ hidden, busy, settings, shortcutError, onChange }: { hidden: boolean; busy: boolean; settings: DraftSettings; shortcutError: string | null; onChange: (value: DraftSettings) => void }) {
  return <section className="panel" id="settings-panel" role="tabpanel" aria-labelledby="settings-tab" hidden={hidden} inert={hidden}>
    <div className="settings-heading"><h2>输入设置</h2><button className="button" disabled={busy} onClick={() => onChange(defaults)}>恢复默认</button></div>
    <NumberSetting id="delay" label="等待时间" note="按钮启动前等待 1～60 秒" unit="秒" min={1} max={60} value={settings.delaySeconds} disabled={busy} error="请输入 1～60 秒的整数。" onChange={value => onChange({ ...settings, delaySeconds: value })} />
    <div className="setting-row">
      <div className="setting-copy"><label htmlFor="shortcut">快捷键</label><p id="shortcut-note">选定输入位置，松开组合键后开始</p></div>
      <select id="shortcut" value={settings.shortcut} disabled={busy} aria-describedby="shortcut-note shortcut-error" onChange={event => onChange({ ...settings, shortcut: event.target.value as Settings['shortcut'] })}>
        {(['F8', 'F9', 'F10'] as const).map(key => <option value={key} key={key}>Ctrl + Alt + {key}</option>)}
      </select>
      {shortcutError && <p className="setting-error" id="shortcut-error" role="alert">{shortcutError}</p>}
    </div>
    <NumberSetting id="interval" label="字符间隔" note="10～1,000 毫秒，数值越大输入越慢" unit="毫秒" min={10} max={1000} value={settings.intervalMs} disabled={busy} error="请输入 10～1,000 毫秒的整数。" onChange={value => onChange({ ...settings, intervalMs: value })} />
    <p className="setting-note">输入期间，鼠标移动继续；鼠标按下或键盘按键停止。</p>
  </section>;
}
function NumberSetting({ id, label, note, unit, min, max, value, disabled, error, onChange }: { id: string; label: string; note: string; unit: string; min: number; max: number; value: number | null; disabled: boolean; error: string; onChange: (value: number | null) => void }) {
  const invalid = value === null || !Number.isInteger(value) || value < min || value > max;
  return <div className="setting-row">
    <div className="setting-copy"><label htmlFor={id}>{label}</label><p id={`${id}-note`}>{note}</p></div>
    <div className="setting-value"><input id={id} type="number" min={min} max={max} step="1" value={value ?? ''} required disabled={disabled} aria-invalid={invalid} aria-describedby={`${id}-note ${id}-unit${invalid ? ` ${id}-error` : ''}`} onChange={event => onChange(Number.isNaN(event.currentTarget.valueAsNumber) ? null : event.currentTarget.valueAsNumber)} /><span id={`${id}-unit`}>{unit}</span></div>
    {invalid && <p className="setting-error" id={`${id}-error`} role="alert">{error}</p>}
  </div>;
}
