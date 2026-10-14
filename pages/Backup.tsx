/**
 * Yedekleme ve geri yükleme ekranı (`/yedekleme`).
 *
 * Kurum yöneticisi tek ekrandan:
 * - Kurumun tüm verisinden yedek alabilir (sunucuda saklanır),
 * - Yedeği bilgisayarına indirebilir,
 * - Önceki yedekleri listeleyip içeriğini görebilir,
 * - Yanlışlıkla silinen veriyi geri yükleyebilir (eksikleri tamamla / birebir döndür),
 * - Bilgisayarındaki bir yedek dosyasından geri yükleme yapabilir,
 * - Eski yedek dosyalarını silebilir.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  Building2,
  Download,
  History,
  Loader2,
  Package,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import SiteLayout, { useSession } from '@/components/SiteLayout';
import PageGuide from '@/components/PageGuide';
// NEDEN: yedekleme bölümleri de ok ile açılıp kapansın.
import CollapsibleSection from '@/components/CollapsibleSection';
import { BACKUP_GUIDE } from '@/lib/pageGuides';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  RESTORE_MODE_DESCRIPTIONS,
  RESTORE_MODE_LABELS,
  backupDownloadUrl,
  createAllBackups,
  createBackup,
  deleteBackup,
  downloadJson,
  exportSnapshot,
  fetchBackupScope,
  fileLabel,
  formatMoment,
  formatSize,
  inspectBackup,
  listBackups,
  readBackupFile,
  restoreBackup,
  tableLabel,
  type BackupItem,
  type BackupScopeInfo,
  type BackupSummary,
  type BulkBackupResult,
  type RestoreMode,
  type RestoreResult,
} from '@/lib/backup';

/** Bekleyen bir işlem sırasında gösterilen düğme içeriği. */
function Busy({ busy, children }: { busy: boolean; children: React.ReactNode }) {
  return (
    <>
      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
      {children}
    </>
  );
}

/** Yedek içeriğinin satır/dosya kırılımı. */
function SummaryPanel({ summary }: { summary: BackupSummary }) {
  const rows = Object.entries(summary.counts ?? {}).filter(([, count]) => Number(count) > 0);
  return (
    <div className="space-y-3 rounded-xl border bg-muted/40 p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          Oluşturulma: <strong className="text-foreground">{formatMoment(summary.created_at)}</strong>
        </span>
        {summary.created_by && (
          <span>
            Alan kişi: <strong className="text-foreground">{summary.created_by}</strong>
          </span>
        )}
        <span>
          Toplam kayıt:{' '}
          <strong className="text-foreground tabular-nums">{summary.total_rows}</strong>
        </span>
      </div>

      {rows.length ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map(([key, count]) => (
            <div
              key={key}
              className="flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2"
            >
              <span className="truncate text-xs font-semibold">{tableLabel(key)}</span>
              <span className="text-sm font-extrabold tabular-nums">{count}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Bu yedekte veritabanı kaydı bulunmuyor (yalnızca dosya belgeleri olabilir).
        </p>
      )}

      {summary.truncated?.length ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
          Çok büyük olduğu için tamamı yedeğe girmeyen bölümler:{' '}
          {summary.truncated.map((key) => tableLabel(key)).join(', ')}. Bu bölümler geri yüklemede
          silinmez, yalnızca eksikleri tamamlanır.
        </p>
      ) : null}

      {summary.files?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {summary.files.map((key) => (
            <span
              key={key}
              className="rounded-full border bg-card px-2.5 py-1 text-[11px] font-bold"
            >
              {fileLabel(key)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function BackupInner() {
  const { school } = useSession();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [items, setItems] = useState<BackupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState(false);
  // Yetki kapsamı: süper admin kurumlar arasında geçiş yapar, yönetici kendi kurumunda kalır.
  const [scope, setScope] = useState<BackupScopeInfo | null>(null);
  const [targetSchool, setTargetSchool] = useState<number>(0);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkBackupResult | null>(null);
  const [mode, setMode] = useState<RestoreMode>('merge');
  const [selected, setSelected] = useState<string>('');
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [summaryFor, setSummaryFor] = useState<string>('');
  const [inspecting, setInspecting] = useState('');
  const [restoring, setRestoring] = useState('');
  const [removing, setRemoving] = useState('');
  const [result, setResult] = useState<RestoreResult | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const list = await listBackups(targetSchool || undefined);
      setItems(list);
      setSelected((prev) => (prev && list.some((i) => i.object_key === prev) ? prev : ''));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [targetSchool]);

  // Kapsam bir kez okunur; süper adminde kurum listesi buradan gelir.
  useEffect(() => {
    let alive = true;
    void fetchBackupScope()
      .then((info) => {
        if (!alive) return;
        setScope(info);
        setTargetSchool(info.own_school_id || info.schools[0]?.id || 0);
      })
      .catch((e) => {
        if (alive) setError((e as Error).message);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeSchoolName =
    scope?.schools.find((s) => s.id === targetSchool)?.name || school?.name || '—';

  const latest = items[0];

  const restoreSummary = useMemo(() => {
    if (!result) return [];
    return Object.entries(result.applied ?? {})
      .map(([key, value]) => ({
        key,
        label: tableLabel(key),
        created: Number(value?.created ?? 0),
        updated: Number(value?.updated ?? 0),
      }))
      .filter((row) => row.created > 0 || row.updated > 0);
  }, [result]);

  const handleCreate = async () => {
    setCreating(true);
    setError('');
    try {
      const created = await createBackup(note, targetSchool || undefined);
      toast.success('Yedek alındı', {
        description: `${created.file_name} · ${formatSize(created.size)}`,
      });
      setNote('');
      setSummary(created.summary);
      setSummaryFor(created.object_key);
      setSelected(created.object_key);
      await refresh();
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      toast.error('Yedek alınamadı', { description: message });
    } finally {
      setCreating(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    setError('');
    try {
      const { snapshot, summary: exported } = await exportSnapshot(targetSchool || undefined);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      downloadJson(`${activeSchoolName || 'kurum'}-yedek-${stamp}.json`.replace(/\s+/g, '-'), snapshot);
      setSummary(exported);
      setSummaryFor('');
      toast.success('Yedek dosyası bilgisayarınıza indirildi.');
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      toast.error('Yedek indirilemedi', { description: message });
    } finally {
      setExporting(false);
    }
  };

  const handleInspect = async (item: BackupItem) => {
    setInspecting(item.object_key);
    setError('');
    try {
      const found = await inspectBackup(item.object_key, targetSchool || undefined);
      setSummary(found);
      setSummaryFor(item.object_key);
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      toast.error('Yedek içeriği okunamadı', { description: message });
    } finally {
      setInspecting('');
    }
  };

  const handleDownload = async (item: BackupItem) => {
    try {
      const url = await backupDownloadUrl(item.object_key, targetSchool || undefined);
      if (!url) throw new Error('İndirme adresi alınamadı.');
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      toast.error('İndirilemedi', { description: (e as Error).message });
    }
  };

  const handleRestore = async (item: BackupItem) => {
    const label = mode === 'replace' ? 'birebir geri yükleme' : 'eksikleri tamamlama';
    const confirmed = window.confirm(
      `${item.file_name} dosyasından ${label} yapılacak.\n\n${RESTORE_MODE_DESCRIPTIONS[mode]}\n\nDevam edilsin mi?`,
    );
    if (!confirmed) return;

    setRestoring(item.object_key);
    setError('');
    try {
      const restored = await restoreBackup({
        objectKey: item.object_key,
        mode,
        schoolId: targetSchool || undefined,
      });
      setResult(restored);
      setSummary(restored.summary);
      setSummaryFor(item.object_key);
      toast.success('Veriler geri yüklendi', {
        description: 'Diğer ekranları yenilediğinizde kayıtlar görünecek.',
      });
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      toast.error('Geri yükleme başarısız', { description: message });
    } finally {
      setRestoring('');
    }
  };

  const handleDelete = async (item: BackupItem) => {
    if (!window.confirm(`${item.file_name} yedeği kalıcı olarak silinsin mi?`)) return;
    setRemoving(item.object_key);
    try {
      await deleteBackup(item.object_key, targetSchool || undefined);
      toast.success('Yedek silindi');
      if (summaryFor === item.object_key) {
        setSummary(null);
        setSummaryFor('');
      }
      await refresh();
    } catch (e) {
      toast.error('Yedek silinemedi', { description: (e as Error).message });
    } finally {
      setRemoving('');
    }
  };

  const handleUploadRestore = async (file: File) => {
    const label = mode === 'replace' ? 'birebir geri yükleme' : 'eksikleri tamamlama';
    if (
      !window.confirm(
        `${file.name} dosyasından ${label} yapılacak.\n\n${RESTORE_MODE_DESCRIPTIONS[mode]}\n\nDevam edilsin mi?`,
      )
    ) {
      return;
    }
    setRestoring('upload');
    setError('');
    try {
      const snapshot = await readBackupFile(file);
      const restored = await restoreBackup({
        snapshot,
        mode,
        schoolId: targetSchool || undefined,
      });
      setResult(restored);
      setSummary(restored.summary);
      setSummaryFor('');
      toast.success('Dosyadan geri yükleme tamamlandı');
      await refresh();
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      toast.error('Geri yükleme başarısız', { description: message });
    } finally {
      setRestoring('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  /** Süper admin: tüm kurumların yedeğini tek işlemde alır. */
  const handleBackupAll = async () => {
    if (
      !window.confirm(
        'Platformdaki tüm kurumların yedeği alınacak. Kurum sayısına göre bu işlem biraz sürebilir. Devam edilsin mi?',
      )
    ) {
      return;
    }
    setBulkBusy(true);
    setError('');
    setBulkResult(null);
    try {
      const result = await createAllBackups(note);
      setBulkResult(result);
      if (result.backed_up > 0) {
        toast.success(`${result.backed_up}/${result.school_count} kurumun yedeği alındı.`);
      } else {
        toast.error('Hiçbir kurumun yedeği alınamadı.');
      }
      if (result.errors.length) {
        toast.error(result.errors.slice(0, 3).join('\n'), { duration: 9000 });
      }
      setNote('');
      await refresh();
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      toast.error('Tüm kurumlar yedeklenemedi', { description: message });
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Archive className="h-5 w-5" />
        </span>
        <div className="mr-auto min-w-0">
          <h1 className="text-xl font-extrabold sm:text-2xl">Yedekleme ve geri yükleme</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Kurumunuzun tüm verisi (öğrenci ve veli kayıtları, kullanıcılar, yetkiler ve giriş
            bilgileri, sınavlar ve öğrenci sonuçları, yoklamalar, ders programı, muhasebe, online
            dersler, rehberlik kayıtları, deneme analizleri ve kurum bilgileri) tek bir yedek
            dosyasında toplanır. Aynı dosyayı “birebir döndür” ile geri yüklediğinizde kurum yedek
            alınan tarihteki durumuna döner; sınavlar ve yoklamalar da geri gelir.
          </p>
        </div>
        <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
          <Busy busy={loading}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Listeyi yenile
          </Busy>
        </Button>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {scope?.is_super_admin && (
        <section className="space-y-3 rounded-2xl border border-primary/30 bg-primary/5 p-5">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            <h2 className="text-base font-extrabold">Kurum seçimi (süper admin)</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Aşağıdaki işlemler seçtiğiniz kurum üzerinde çalışır. Tek seferde tüm kurumların
            yedeğini de alabilirsiniz; her kurum kendi klasörüne ayrı dosya olarak yazılır.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[16rem] space-y-1.5">
              <Label htmlFor="backup-school">İşlem yapılacak kurum</Label>
              <select
                id="backup-school"
                value={targetSchool}
                onChange={(e) => {
                  setTargetSchool(Number(e.target.value) || 0);
                  setSummary(null);
                  setSummaryFor('');
                  setResult(null);
                }}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm font-semibold"
              >
                {scope.schools.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <Button variant="outline" onClick={() => void handleBackupAll()} disabled={bulkBusy}>
              <Busy busy={bulkBusy}>
                <Package className="mr-2 h-4 w-4" />
                Tüm kurumları yedekle ({scope.schools.length})
              </Busy>
            </Button>
          </div>

          {bulkResult && (
            <div className="space-y-2 rounded-xl border bg-card p-4">
              <p className="text-sm font-extrabold">
                {bulkResult.backed_up}/{bulkResult.school_count} kurum yedeklendi ·{' '}
                {bulkResult.total_rows} kayıt
              </p>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {bulkResult.items.map((item) => (
                  <li
                    key={item.school_id}
                    className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs"
                  >
                    <span className="truncate font-semibold">{item.school_name}</span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">
                      {item.total_rows} kayıt · {formatSize(item.size)}
                    </span>
                  </li>
                ))}
              </ul>
              {bulkResult.errors.length ? (
                <ul className="space-y-1 text-xs font-semibold text-destructive">
                  {bulkResult.errors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </section>
      )}

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 rounded-2xl border bg-card p-5 shadow-sm lg:col-span-2">
          <div className="flex items-center gap-2">
            <Save className="h-4 w-4 text-primary" />
            <h2 className="text-base font-extrabold">Yeni yedek al</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Yedek kurumunuzun kalıcı klasörüne kaydedilir. Önemli bir değişiklikten önce
            (toplu silme, veri aktarımı, dönem sonu) yedek almanız önerilir.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="backup-note">Yedek notu (isteğe bağlı)</Label>
            <Input
              id="backup-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Örn. Dönem sonu öncesi yedek"
              maxLength={200}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void handleCreate()} disabled={creating}>
              <Busy busy={creating}>
                <Save className="mr-2 h-4 w-4" />
                Yedek al ve kaydet
              </Busy>
            </Button>
            <Button variant="outline" onClick={() => void handleExport()} disabled={exporting}>
              <Busy busy={exporting}>
                <Download className="mr-2 h-4 w-4" />
                Bilgisayarıma indir
              </Busy>
            </Button>
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <h2 className="text-base font-extrabold">Durum</h2>
          </div>
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Kurum</dt>
              <dd className="truncate font-bold">{activeSchoolName}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Kayıtlı yedek</dt>
              <dd className="font-bold tabular-nums">{items.length}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Son yedek</dt>
              <dd className="font-bold">
                {latest ? formatMoment(latest.last_modified) : 'Henüz yok'}
              </dd>
            </div>
          </dl>
          {!items.length && !loading && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
              Henüz yedek almadınız. İlk yedeği şimdi almanız önerilir.
            </p>
          )}
        </div>
      </section>

      <CollapsibleSection
        title="Geri yükleme şekli"
        icon={<RotateCcw className="h-4 w-4" />}
        storageKey="backup.restoreMode"
        bodyClassName="space-y-4"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {(['merge', 'replace'] as RestoreMode[]).map((value) => {
            const active = mode === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={`rounded-xl border p-4 text-left transition-colors duration-150 ${
                  active ? 'border-primary bg-primary/5' : 'hover:md:bg-accent'
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-extrabold">
                  <span
                    className={`h-3.5 w-3.5 rounded-full border-2 ${
                      active ? 'border-primary bg-primary' : 'border-muted-foreground'
                    }`}
                  />
                  {RESTORE_MODE_LABELS[value]}
                </span>
                <span className="mt-2 block text-xs text-muted-foreground">
                  {RESTORE_MODE_DESCRIPTIONS[value]}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed p-4">
          <Upload className="h-4 w-4 text-muted-foreground" />
          <p className="mr-auto text-sm text-muted-foreground">
            Bilgisayarınızdaki bir yedek dosyasından geri yükleyin.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleUploadRestore(file);
            }}
          />
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={restoring === 'upload'}
          >
            <Busy busy={restoring === 'upload'}>
              <Upload className="mr-2 h-4 w-4" />
              Dosya seç ve geri yükle
            </Busy>
          </Button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Kayıtlı yedekler"
        icon={<History className="h-4 w-4" />}
        storageKey="backup.list"
        bodyClassName="space-y-4"
      >
        {loading ? (
          <div className="flex min-h-[120px] items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            Kayıtlı yedek bulunmuyor. Yukarıdan ilk yedeğinizi alabilirsiniz.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => {
              const isSelected = selected === item.object_key;
              return (
                <li
                  key={item.object_key}
                  className={`rounded-xl border p-3 transition-colors duration-150 ${
                    isSelected ? 'border-primary bg-primary/5' : ''
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSelected(item.object_key)}
                      className="mr-auto min-w-0 text-left"
                    >
                      <span className="block truncate text-sm font-extrabold">
                        {item.file_name}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {formatMoment(item.last_modified)} · {formatSize(item.size)}
                      </span>
                    </button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleInspect(item)}
                      disabled={inspecting === item.object_key}
                    >
                      <Busy busy={inspecting === item.object_key}>İçeriği gör</Busy>
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void handleDownload(item)}>
                      <Download className="mr-1.5 h-3.5 w-3.5" />
                      İndir
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void handleRestore(item)}
                      disabled={restoring === item.object_key}
                    >
                      <Busy busy={restoring === item.object_key}>
                        <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                        Geri yükle
                      </Busy>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleDelete(item)}
                      disabled={removing === item.object_key}
                      className="text-destructive"
                    >
                      <Busy busy={removing === item.object_key}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Busy>
                    </Button>
                  </div>

                  {summaryFor === item.object_key && summary ? (
                    <div className="mt-3">
                      <SummaryPanel summary={summary} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {summary && !summaryFor ? <SummaryPanel summary={summary} /> : null}
      </CollapsibleSection>

      {result && (
        <section className="space-y-3 rounded-2xl border border-emerald-300 bg-emerald-50 p-5">
          <h2 className="text-base font-extrabold text-emerald-900">Geri yükleme tamamlandı</h2>
          <p className="text-sm text-emerald-900">
            Yöntem: <strong>{RESTORE_MODE_LABELS[result.mode as RestoreMode] ?? result.mode}</strong>
          </p>
          {restoreSummary.length ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {restoreSummary.map((row) => (
                <div key={row.key} className="rounded-lg border bg-card px-3 py-2">
                  <span className="block truncate text-xs font-semibold">{row.label}</span>
                  <span className="text-xs text-muted-foreground">
                    <strong className="text-foreground tabular-nums">{row.created}</strong> geri
                    getirildi ·{' '}
                    <strong className="text-foreground tabular-nums">{row.updated}</strong>{' '}
                    güncellendi
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-emerald-900">
              Kayıtlar zaten yedekle aynıydı, değişiklik gerekmedi.
            </p>
          )}
          {result.files?.length ? (
            <p className="text-xs font-semibold text-emerald-900">
              Geri yazılan belgeler: {result.files.map((key) => fileLabel(key)).join(', ')}
            </p>
          ) : null}
          {result.protected_tables?.length ? (
            <p className="text-xs font-semibold text-amber-800">
              Yedekte tamamı bulunmadığı için silinmeden korunan bölümler:{' '}
              {result.protected_tables.map((key) => tableLabel(key)).join(', ')}
            </p>
          ) : null}
        </section>
      )}

      <PageGuide storageKey="yedekleme" {...BACKUP_GUIDE} />
    </div>
  );
}

export default function BackupPage() {
  return (
    <SiteLayout anyPermission={['manage_users']}>
      <BackupInner />
    </SiteLayout>
  );
}