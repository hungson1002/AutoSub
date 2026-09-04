import { useEffect, useMemo, useState } from 'react';
import { Check, FileVideo, HardDrive, LoaderCircle, RefreshCw, Search, ShieldCheck, Trash2 } from '../components/Icons';
import { Modal } from '../components/Modal';
import { api, friendlyErrorMessage, type StorageItem, type StorageSnapshot } from '../lib/api';

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / (1024 ** index)).toFixed(index < 2 ? 0 : index === 2 ? 1 : 2)} ${units[index]}`;
};

const statusLabel = (status?: string) => ({
  completed: 'Hoàn tất', completed_with_errors: 'Có lỗi', failed: 'Thất bại', cancelled: 'Đã hủy',
  queued: 'Đang chờ', running: 'Đang chạy', paused: 'Tạm dừng', planning: 'Lên kịch bản',
  generating: 'Đang tạo', composing: 'Đang ghép', rendering: 'Đang xuất',
}[status || ''] || 'Đã lưu');

export function StoragePage({ onNotice }: { onNotice: (message: string, kind?: 'success' | 'error') => void }) {
  const [snapshot, setSnapshot] = useState<StorageSnapshot>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmMode, setConfirmMode] = useState<'delete' | 'cleanup'>();

  const load = async (signal?: AbortSignal) => {
    setLoading(true);
    try { setSnapshot(await api.inspectStorage(signal)); }
    catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) onNotice(friendlyErrorMessage(error, 'Không thể đọc dung lượng AutoSub.'), 'error');
    } finally { if (!signal?.aborted) setLoading(false); }
  };

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, []);

  const allItems = useMemo(() => snapshot?.categories.flatMap((category) => category.items) || [], [snapshot]);
  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('vi');
    return allItems.filter((item) => (categoryId === 'all' || item.categoryId === categoryId) && (!normalized || `${item.displayName} ${item.detail}`.toLocaleLowerCase('vi').includes(normalized)));
  }, [allItems, categoryId, query]);
  const selectedItems = allItems.filter((item) => selected.has(item.id) && item.canDelete);
  const selectableVisible = visibleItems.filter((item) => item.canDelete);
  const allVisibleSelected = selectableVisible.length > 0 && selectableVisible.every((item) => selected.has(item.id));
  const selectedBytes = selectedItems.reduce((sum, item) => sum + item.sizeBytes, 0);

  const toggle = (item: StorageItem) => {
    if (!item.canDelete) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
      return next;
    });
  };

  const toggleVisible = () => setSelected((current) => {
    const next = new Set(current);
    if (allVisibleSelected) selectableVisible.forEach((item) => next.delete(item.id));
    else selectableVisible.forEach((item) => next.add(item.id));
    return next;
  });

  const removeSelected = async () => {
    if (!selectedItems.length) return;
    setBusy(true);
    try {
      const result = await api.deleteStorageItems(selectedItems.map(({ categoryId: category, name }) => ({ categoryId: category, name })));
      setSelected(new Set());
      setConfirmMode(undefined);
      await load();
      if (result.deletedCount) onNotice(`Đã xóa ${result.deletedCount} mục, giải phóng ${formatBytes(result.freedBytes)}.`, 'success');
      if (result.errors.length) onNotice(`${result.errors.length} mục không thể xóa vì đang được sử dụng hoặc đã thay đổi.`, 'error');
    } catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể xóa dữ liệu đã chọn.'), 'error'); }
    finally { setBusy(false); }
  };

  const cleanup = async () => {
    setBusy(true);
    try {
      const result = await api.cleanupTemporaryFiles();
      setConfirmMode(undefined);
      await load();
      onNotice(`Đã dọn ${result.removedFiles} file tạm, giải phóng ${formatBytes(result.freedBytes)}.`, 'success');
    } catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể dọn file tạm.'), 'error'); }
    finally { setBusy(false); }
  };

  return <div className="page storage-page">
    <Modal open={Boolean(confirmMode)} title={confirmMode === 'cleanup' ? 'Dọn file tạm?' : `Xóa ${selectedItems.length} mục đã chọn?`} eyebrow="XÁC NHẬN XÓA" onClose={() => !busy && setConfirmMode(undefined)}>
      <div className="storage-confirm">
        <div className="storage-confirm-icon"><Trash2 size={20} /></div>
        <p>{confirmMode === 'cleanup' ? 'AutoSub sẽ xóa cache và file xử lý trung gian có thể tạo lại. File nguồn và kết quả hoàn chỉnh vẫn được giữ.' : `Thao tác này sẽ giải phóng khoảng ${formatBytes(selectedBytes)}. Các file đã xóa không thể khôi phục trong AutoSub.`}</p>
      </div>
      <div className="modal-actions">
        <button className="button ghost" disabled={busy} onClick={() => setConfirmMode(undefined)}>Giữ lại</button>
        <button className="button danger" disabled={busy} onClick={() => void (confirmMode === 'cleanup' ? cleanup() : removeSelected())}>{busy ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />} {busy ? 'Đang xóa…' : 'Xóa dữ liệu'}</button>
      </div>
    </Modal>

    <header className="page-header storage-header">
      <div><div className="eyebrow">LOCAL STORAGE</div><h1>Tệp & <span>dung lượng</span></h1><p>Xem đúng nơi AutoSub đang chiếm chỗ và xóa nhiều kết quả cũ trong một lần.</p></div>
      <div className="header-actions">
        <button className="button ghost" disabled={loading} onClick={() => void load()}><RefreshCw className={loading ? 'spin' : ''} size={15} /> Quét lại</button>
        <button className="button ghost" disabled={loading} onClick={() => setConfirmMode('cleanup')}><Trash2 size={15} /> Dọn file tạm</button>
      </div>
    </header>

    {loading && !snapshot ? <section className="storage-loading" aria-live="polite"><LoaderCircle className="spin" size={22} /><strong>Đang đo dung lượng trên máy…</strong><span>Thư mục lớn có thể mất vài giây.</span></section> : snapshot && <>
      <section className="storage-overview">
        <div className="storage-total-card"><span><HardDrive size={18} /> AutoSub đang dùng</span><strong>{formatBytes(snapshot.totalBytes)}</strong><small>{snapshot.itemCount} mục có thể quản lý · quét lúc {new Date(snapshot.scannedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</small></div>
        <div className="storage-breakdown-card">
          <div className="storage-breakdown-head"><span>Dữ liệu theo chức năng</span><strong>{formatBytes(snapshot.managedBytes)}</strong></div>
          <div className="storage-meter" aria-label="Tỷ lệ dung lượng theo chức năng">{snapshot.categories.filter((category) => category.sizeBytes > 0).map((category, index) => <i key={category.id} style={{ width: `${category.sizeBytes / Math.max(1, snapshot.totalBytes) * 100}%`, background: ['#ff8a45', '#8f84ff', '#55b8f3', '#5ed7a2', '#e26d83'][index % 5] }} title={`${category.label}: ${formatBytes(category.sizeBytes)}`} />)}</div>
          <small><ShieldCheck size={13} /> {formatBytes(snapshot.otherBytes)} còn lại là model, công cụ và dữ liệu hệ thống — trang này không xóa nhầm chúng.</small>
        </div>
      </section>

      <section className="storage-browser">
        <div className="storage-toolbar">
          <div className="storage-tabs" role="tablist" aria-label="Lọc loại dữ liệu"><button role="tab" aria-selected={categoryId === 'all'} className={categoryId === 'all' ? 'active' : ''} onClick={() => setCategoryId('all')}>Tất cả <em>{allItems.length}</em></button>{snapshot.categories.filter((category) => category.items.length > 0).map((category) => <button role="tab" aria-selected={categoryId === category.id} title={category.description} key={category.id} className={categoryId === category.id ? 'active' : ''} onClick={() => setCategoryId(category.id)}>{category.label} <em>{category.items.length}</em></button>)}</div>
          <label className="storage-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm tên file hoặc job…" aria-label="Tìm file đã lưu" /></label>
        </div>
        <div className="storage-selection-bar">
          <label><input type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} disabled={!selectableVisible.length} /> Chọn các mục đang hiển thị</label>
          <span>{selectedItems.length ? `${selectedItems.length} mục · ${formatBytes(selectedBytes)}` : 'Chọn một hoặc nhiều mục để xóa'}</span>
          <button className="button small danger" disabled={!selectedItems.length} onClick={() => setConfirmMode('delete')}><Trash2 size={14} /> Xóa đã chọn</button>
        </div>
        <div className="storage-table" role="table" aria-label="Các tệp AutoSub đã lưu">
          <div className="storage-table-head" role="row"><span /><span>Tên dữ liệu</span><span>Loại</span><span>Dung lượng</span><span>Cập nhật</span><span /></div>
          {visibleItems.map((item) => {
            const category = snapshot.categories.find((entry) => entry.id === item.categoryId)!;
            return <div className={`storage-row ${selected.has(item.id) ? 'selected' : ''}`} role="row" key={item.id}>
              <label className="storage-check"><input type="checkbox" checked={selected.has(item.id)} disabled={!item.canDelete} onChange={() => toggle(item)} aria-label={`Chọn ${item.displayName}`} /></label>
              <div className="storage-file"><span><FileVideo size={16} /></span><div><strong title={item.displayName}>{item.displayName}</strong><small title={item.detail}>{item.detail} · {item.fileCount} file</small></div></div>
              <div className="storage-kind"><strong>{category.label}</strong><small className={item.canDelete ? '' : 'active'}>{statusLabel(item.status)}</small></div>
              <strong className="storage-size">{formatBytes(item.sizeBytes)}</strong>
              <time>{new Date(item.modifiedAt).toLocaleDateString('vi-VN')}</time>
              <button className="icon-button danger-icon" disabled={!item.canDelete} title={item.canDelete ? 'Xóa mục này' : item.deleteBlockedReason} aria-label={`Xóa ${item.displayName}`} onClick={() => { setSelected(new Set([item.id])); setConfirmMode('delete'); }}><Trash2 size={15} /></button>
            </div>;
          })}
          {!visibleItems.length && <div className="storage-empty"><Check size={20} /><strong>Không có dữ liệu phù hợp</strong><span>Thử chọn nhóm khác hoặc xóa nội dung tìm kiếm.</span></div>}
        </div>
        <div className="storage-path"><span>Thư mục dữ liệu</span><code title={snapshot.workdir}>{snapshot.workdir}</code></div>
      </section>
    </>}
  </div>;
}
