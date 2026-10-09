import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';
import icon from '../../src-tauri/icons/icon.svg';
import license from '../../LICENSE?raw';
import { UpdatePanel } from './UpdatePanel';
import type { useUpdates } from '../useUpdates';

const links = [
  { label: '项目主页', url: 'https://github.com/sunnyx11/key-relay' },
  { label: '使用说明', url: 'https://github.com/sunnyx11/key-relay#readme' },
  { label: '问题反馈', url: 'https://github.com/sunnyx11/key-relay/issues' },
];

/** Show application metadata, system-handled support links and the bundled MIT license. */
export function AboutPanel({ hidden, updates, beforeInstall }: { hidden: boolean; updates: ReturnType<typeof useUpdates>; beforeInstall: () => Promise<void> }) {
  const [version, setVersion] = useState('');
  const [versionError, setVersionError] = useState(false);
  const [versionAttempt, setVersionAttempt] = useState(0);
  const [linkError, setLinkError] = useState('');
  const [showLicense, setShowLicense] = useState(false);
  const licenseButton = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    void getVersion()
      .then(value => { if (!disposed) setVersion(value); })
      .catch(() => { if (!disposed) setVersionError(true); });
    return () => { disposed = true; };
  }, [versionAttempt]);

  const open = async (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const { href, textContent } = event.currentTarget;
    setLinkError('');
    try { await openUrl(href); }
    catch { setLinkError(`打开失败：${textContent}。请检查系统默认应用后重试。`); }
  };
  const changeView = (value: boolean) => {
    flushSync(() => setShowLicense(value));
    if (content.current) content.current.scrollTop = 0;
    (value ? backButton : licenseButton).current?.focus();
  };

  return <section className="panel about-panel" id="about-panel" role="tabpanel" aria-labelledby="about-tab" hidden={hidden} inert={hidden}>
    <div className="about-content" ref={content}>
      {showLicense ? <>
        <div className="license-heading"><h2>MIT 许可证</h2><button className="button" ref={backButton} onClick={() => changeView(false)}>返回关于</button></div>
        <pre className="license-text" aria-label="MIT 许可证全文">{license}</pre>
      </> : <>
        <div className="about-heading">
          <img src={icon} width="48" height="48" alt="" />
          <div><h2>Key Relay</h2><p className="about-version">{version ? `版本 ${version} · Windows 64 位` : versionError ? 'Windows 64 位' : '正在读取版本…'}</p></div>
        </div>
        {versionError && <div className="about-version-error"><p role="alert">读取版本失败，请重试。</p><button className="button" onClick={() => { setVersionError(false); setVersionAttempt(value => value + 1); }}>重试读取版本</button></div>}
        <p className="about-description">将准备好的文本作为键盘输入发送到目标位置，适用于限制剪贴板粘贴的远程桌面会话。</p>
        <UpdatePanel updates={updates} hidden={hidden} beforeInstall={beforeInstall} open={open} />
        <div className="about-support">
          <nav aria-label="项目支持">{links.map(link => <a key={link.url} href={link.url} onClick={event => { void open(event); }}>{link.label}</a>)}</nav>
          <p className="about-contact"><span>联系邮箱</span><a href="mailto:hkhl888@foxmail.com" onClick={event => { void open(event); }}>hkhl888@foxmail.com</a></p>
          {linkError && <p className="about-error" role="alert">{linkError}</p>}
        </div>
        <div className="about-legal"><span>© 2026 sunnyx11</span><button className="button" ref={licenseButton} onClick={() => changeView(true)}>MIT 许可证</button></div>
      </>}
    </div>
  </section>;
}
