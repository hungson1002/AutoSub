import { useState } from 'react';
import { DouyinSearch } from './DouyinSearch';
import { DouyinTools } from './DouyinTools';
import type { AppSettings, AIProvider } from '../types';
export function DouyinWorkspace({ onAdd, settings, providers }: { onAdd: (urls: string[]) => void; settings: AppSettings; providers: AIProvider[] }) {
  const [tab, setTab] = useState('search');
  return <><nav className="douyin-workspace-tabs" aria-label="Chức năng Douyin"><button className="button ghost" aria-pressed={tab === 'search'} onClick={() => setTab('search')}>Tìm video</button><button className="button ghost" aria-pressed={tab === 'tools'} onClick={() => setTab('tools')}>Dữ liệu & tương tác</button></nav><div hidden={tab !== 'search'}><DouyinSearch onAdd={onAdd} settings={settings} providers={providers} /></div><div hidden={tab !== 'tools'}><DouyinTools onAdd={onAdd} /></div></>;
}
