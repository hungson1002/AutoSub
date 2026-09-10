import { useState } from 'react';
import { DouyinSearch } from './DouyinSearch';
import { DouyinTools } from './DouyinTools';
export function DouyinWorkspace({ onAdd }: { onAdd: (urls: string[]) => void }) {
  const [tab, setTab] = useState('search');
  return <><nav className="douyin-workspace-tabs" aria-label="Chức năng Douyin"><button className="button ghost" aria-pressed={tab === 'search'} onClick={() => setTab('search')}>Tìm video</button><button className="button ghost" aria-pressed={tab === 'tools'} onClick={() => setTab('tools')}>Dữ liệu & tương tác</button></nav><div hidden={tab !== 'search'}><DouyinSearch onAdd={onAdd} /></div><div hidden={tab !== 'tools'}><DouyinTools onAdd={onAdd} /></div></>;
}
