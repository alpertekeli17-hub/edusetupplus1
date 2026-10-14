/**
 * Yıllık dönem yönetimi ve üst sınıfa aktarım ekranı (`/donemler`).
 *
 * Akış:
 * 1. Kurumun dönemleri listelenir; yeni eğitim-öğretim yılı açılabilir,
 *    bir dönem aktif yapılabilir veya arşive alınabilir.
 * 2. "Üst sınıfa aktarım" bölümünde kaynak dönem (mevcut aktif yıl) ve hedef
 *    dönem (bir sonraki yıl) seçilir.
 * 3. Mezuniyet seviyesi belirlenir (ortaokul 8, lise 12; öğrenci verisinden
 *    otomatik önerilir).
 * 4. Aktarım planı satır satır gösterilir: her öğrenci için bir üst sınıf,
 *    mezuniyet veya sınıfı koruma seçilebilir. Kullanıcı istediği satırları
 *    işaretler.
 * 5. Onaylandığında hedef dönem oluşturulur (yoksa), öğrenci kayıtları
 *    güncellenir ve her satır için aktarım günlüğü yazılır.
 *
 * Öğrenci kaydı silinmez: mezun edilen öğrenci `Mezun` sınıfına alınır ve
 * durumu `ayrildi` olur; geçmiş yılların analizleri bozulmaz.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpCircle,
  CalendarRange,
  CheckCircle2,
  GraduationCap,
  History,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Users,
} from 'lucide-react';
import SiteLayout, { useSession } from '@/components/SiteLayout';
import PageGuide from '@/components/PageGuide';
// NEDEN: dönem bölümleri de ok ile açılıp kapansın.
import CollapsibleSection from '@/components/CollapsibleSection';
import { TERMS_GUIDE } from '@/lib/pageGuides';
import TermArchivePanel from '@/components/TermArchivePanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { fetchAllStudentRecords, type StudentRecord } from '@/lib/students';
import {
  PROMOTION_ACTION_LABELS,
  TERM_SNAPSHOT_SOURCE_LABELS,
  TERM_STATUS_CLASS,
  TERM_STATUS_LABELS,
  activateTerm,
  activeTermOf,
  applyPromotion,
  buildPromotionPlan,
  buildTermSnapshot,
  createTerm,
  currentTermCode,
  defaultTermRange,
  ensureTerm,
  fetchPromotionLogs,
  fetchTerms,
  isValidTermCode,
  logsOfTerm,
  nextClassOf,
  nextTermCode,
  resolveRecordTerm,
  suggestGraduationGrade,
  termLabelOf,
  updateTerm,
  writeActiveTermCode,
  type AcademicTerm,
  type PromotionAction,
  type PromotionLog,
  type PromotionPlanRow,
  type PromotionResult,
} from '@/lib/terms';

/** Buton içi yükleniyor göstergesi. */
function Busy({ busy, children }: { busy: boolean; children: React.ReactNode }) {
  if (!busy) return <>{children}</>;
  return (
    <>
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      İşleniyor…
    </>
  );
}

const ACTION_CLASS: Record<PromotionAction, string> = {
  yukseltildi: 'bg-emerald-100 text-emerald-800',
  mezun: 'bg-sky-100 text-sky-800',
  sabit: 'bg-slate-200 text-slate-700',
};

function TermsInner() {
  const { school, account, can } = useSession();
  const schoolId = Number(school?.id) || 0;
  const allowed = can('manage_users');

  const [terms, setTerms] = useState<AcademicTerm[]>([]);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Yeni dönem formu
  const [newCode, setNewCode] = useState(currentTermCode());
  const [creating, setCreating] = useState(false);
  const [busyTerm, setBusyTerm] = useState(0);

  // Aktarım
  const [sourceTerm, setSourceTerm] = useState('');
  const [targetTerm, setTargetTerm] = useState('');
  const [graduationGrade, setGraduationGrade] = useState(8);
  const [plan, setPlan] = useState<PromotionPlanRow[] | null>(null);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<PromotionResult | null>(null);
  const [logs, setLogs] = useState<PromotionLog[]>([]);
  /*
    Görüntülenen dönem. Varsayılan olarak aktif dönemdir; kullanıcı arşiv
    dönemini seçtiğinde ekran o dönemin kendi verisini gösterir. Aktif dönem
    değiştiğinde bu seçim de yeni aktif döneme taşınır, aksi hâlde kullanıcı
    artık yürürlükte olmayan bir yılın sınıflarına bakmaya devam ederdi.
  */
  const [viewCode, setViewCode] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [termList, studentList, logList] = await Promise.all([
        fetchTerms(schoolId || undefined),
        /*
          Bu ekran dönem süzgeci uygulanmadan okur: aktarımın kaynağı, öğrenci
          kayıtlarının fiilen hangi dönemde durduğudur. Aktif döneme göre süzülen
          liste kullanılsaydı, yeni açılmış (henüz aktarım almamış) dönemde liste
          boş gelir ve aktarım hiç başlatılamazdı.
        */
        fetchAllStudentRecords(),
        /*
          Günlüğün tamamı okunur: bir dönemin kendi sınıf dağılımı yalnızca
          aktarım kayıtlarından çözülebilir. Öğrenci kaydında tek bir güncel
          sınıf durduğu için geçmiş dönemler ancak "önce / sonra" bilgisinden
          doğru gösterilebilir.
        */
        fetchPromotionLogs({ schoolId: schoolId || undefined }),
      ]);
      const scoped = schoolId
        ? studentList.filter((s) => !s.school_id || Number(s.school_id) === schoolId)
        : studentList;
      const active = scoped.filter((s) => (s.status || 'aktif') !== 'ayrildi');

      setTerms(termList);
      setStudents(active);
      setLogs(logList);
      setGraduationGrade(suggestGraduationGrade(active));

      const activeTerm = activeTermOf(termList);
      const activeCodeNow = activeTerm?.status === 'aktif' ? activeTerm.code : '';
      /*
        Aktarımın kaynağı, öğrenci kayıtlarının fiilen bulunduğu dönemdir. Yeni
        bir yıl açmak öğrencileri taşımadığı için kaynak "aktif dönem" değil, son
        aktarımın hedefi (hiç aktarım yoksa en eski dönem) olmalıdır.
      */
      const record =
        resolveRecordTerm({ terms: termList, logs: logList }) || activeCodeNow || currentTermCode();
      setSourceTerm(record);
      // Aktif dönem henüz aktarım almadıysa hedef olarak doğrudan o dönem önerilir.
      setTargetTerm(
        activeCodeNow && activeCodeNow !== record ? activeCodeNow : nextTermCode(record),
      );
      setNewCode((prev) => prev || nextTermCode(activeCodeNow || record));
      // Seçili dönem silinmiş ya da hiç seçilmemişse aktif döneme dönülür.
      setViewCode((prev) =>
        prev && termList.some((t) => t.code === prev) ? prev : activeCodeNow || record,
      );
    } catch (e) {
      setError((e as Error).message || 'Veriler yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [schoolId]);

  useEffect(() => {
    if (allowed) void refresh();
    else setLoading(false);
  }, [allowed, refresh]);

  const activeTerm = useMemo(() => activeTermOf(terms), [terms]);

  /*
    `activeTermOf` dönem hiç işaretlenmemişse listenin ilk kaydına düşer. Dönem
    verisini üretirken bu kadarı yeterli değil: yalnızca gerçekten `aktif`
    işaretli dönem güncel öğrenci kayıtlarını temsil eder. Aksi hâlde arşiv
    dönemi bugünün sınıflarını gösterirdi.
  */
  const activeCode = activeTerm?.status === 'aktif' ? activeTerm.code : '';

  const viewTerm = useMemo(
    () => terms.find((t) => t.code === viewCode) ?? null,
    [terms, viewCode],
  );

  /**
   * Öğrenci kayıtlarının fiilen bulunduğu dönem. Dönem oluşturmak veya bir
   * dönemi aktif yapmak öğrencileri taşımaz; taşıma yalnızca üst sınıfa
   * aktarımla olur. Bu yüzden güncel sınıflar bu dönemde gösterilir.
   */
  const recordTerm = useMemo(() => resolveRecordTerm({ terms, logs }), [terms, logs]);

  /** Seçili dönemin yalnızca kendi sınıf ve öğrenci dağılımı. */
  const snapshot = useMemo(
    () => buildTermSnapshot({ code: viewCode, recordCode: recordTerm, students, logs }),
    [viewCode, recordTerm, students, logs],
  );

  /** Aktif dönem açıldı ama öğrenciler hâlâ önceki dönemde mi? */
  const promotionPending = Boolean(activeCode && recordTerm && activeCode !== recordTerm);

  /** Seçili dönemi ilgilendiren aktarım kayıtları (kaynak ya da hedef). */
  const viewLogs = useMemo(() => logsOfTerm(logs, viewCode), [logs, viewCode]);

  const archivedTerms = useMemo(() => terms.filter((t) => t.status === 'arsiv'), [terms]);

  const planStats = useMemo(() => {
    const rows = (plan ?? []).filter((r) => r.selected);
    return {
      total: plan?.length ?? 0,
      selected: rows.length,
      promoted: rows.filter((r) => r.action === 'yukseltildi').length,
      graduated: rows.filter((r) => r.action === 'mezun').length,
      kept: rows.filter((r) => r.action === 'sabit').length,
    };
  }, [plan]);

  /** Yeni eğitim-öğretim yılı açar. */
  const handleCreateTerm = async () => {
    const code = newCode.trim();
    if (!isValidTermCode(code)) {
      toast.error('Dönem kodu 2026-2027 biçiminde ve ardışık iki yıl olmalı.');
      return;
    }
    if (terms.some((t) => t.code === code)) {
      toast.error('Bu dönem zaten tanımlı.');
      return;
    }
    setCreating(true);
    try {
      const range = defaultTermRange(code);
      await createTerm({
        code,
        label: termLabelOf(code),
        start_date: range.start,
        end_date: range.end,
        status: 'hazirlik',
        ...(schoolId ? { school_id: schoolId } : {}),
      });
      toast.success(`${code} dönemi oluşturuldu.`, {
        description: 'Öğrenciler otomatik taşınmaz; üst sınıfa aktarım yapmanız gerekir.',
      });
      // Yeni dönem hemen görüntülenir; kullanıcı eski dönemin verisine bakmaya devam etmesin.
      setViewCode(code);
      setNewCode(nextTermCode(code));
      await refresh();
    } catch (e) {
      toast.error('Dönem oluşturulamadı', { description: (e as Error).message });
    } finally {
      setCreating(false);
    }
  };

  /** Bir dönemi aktif yapar; diğer aktif dönem arşive alınır. */
  const handleActivate = async (term: AcademicTerm) => {
    if (!window.confirm(`${term.code} dönemi aktif yapılsın mı? Diğer aktif dönem arşive alınır.`))
      return;
    setBusyTerm(term.id);
    try {
      await activateTerm(terms, term);
      // Aktif dönem değişti: ekran hemen yeni dönemin verisine geçer.
      setViewCode(term.code);
      toast.success(`${term.code} artık aktif dönem.`);
      await refresh();
    } catch (e) {
      toast.error('Dönem aktif edilemedi', { description: (e as Error).message });
    } finally {
      setBusyTerm(0);
    }
  };

  /** Bir dönemi arşive alır. */
  const handleArchive = async (term: AcademicTerm) => {
    setBusyTerm(term.id);
    try {
      await updateTerm(term.id, { status: 'arsiv' });
      toast.success(`${term.code} arşive alındı.`);
      await refresh();
    } catch (e) {
      toast.error('Dönem arşive alınamadı', { description: (e as Error).message });
    } finally {
      setBusyTerm(0);
    }
  };

  /** Aktarım planını hazırlar (henüz hiçbir kayıt değişmez). */
  const handlePreparePlan = () => {
    if (!isValidTermCode(targetTerm)) {
      toast.error('Hedef dönem 2027-2028 biçiminde olmalı.');
      return;
    }
    if (targetTerm === sourceTerm) {
      toast.error('Hedef dönem kaynak dönemden farklı olmalı.');
      return;
    }
    if (!students.length) {
      toast.error('Aktarılacak öğrenci kaydı bulunamadı.');
      return;
    }
    setResult(null);
    setPlan(buildPromotionPlan(students, graduationGrade));
    toast.success('Aktarım planı hazır. Satırları kontrol edip onaylayın.');
  };

  /** Tek satırın işaretini değiştirir. */
  const toggleRow = (studentId: number) => {
    setPlan((prev) =>
      (prev ?? []).map((row) =>
        Number(row.student.id) === studentId ? { ...row, selected: !row.selected } : row,
      ),
    );
  };

  /** Tüm satırları işaretler / kaldırır. */
  const toggleAll = (selected: boolean) => {
    setPlan((prev) => (prev ?? []).map((row) => ({ ...row, selected })));
  };

  /** Bir satırın kararını değiştirir (üst sınıf / mezun / sınıfı koru). */
  const changeAction = (studentId: number, action: PromotionAction) => {
    setPlan((prev) =>
      (prev ?? []).map((row) => {
        if (Number(row.student.id) !== studentId) return row;
        if (action === 'yukseltildi') {
          const next = nextClassOf(row.fromClass, 99); // mezuniyeti zorlamadan bir üst sınıf
          return { ...row, action, toClass: next.className, toGrade: next.grade, selected: true };
        }
        if (action === 'mezun') {
          return { ...row, action, toClass: 'Mezun', toGrade: undefined, selected: true };
        }
        return {
          ...row,
          action,
          toClass: row.fromClass,
          toGrade: row.fromGrade,
          selected: true,
        };
      }),
    );
  };

  /** Planı uygular: hedef dönemi açar, kayıtları güncellemeyi başlatır. */
  const handleApply = async () => {
    if (!plan?.length) return;
    const rows = plan.filter((r) => r.selected);
    if (!rows.length) {
      toast.error('Aktarılacak öğrenci seçilmedi.');
      return;
    }
    const promoted = rows.filter((r) => r.action === 'yukseltildi').length;
    const graduated = rows.filter((r) => r.action === 'mezun').length;
    if (
      !window.confirm(
        `${targetTerm} dönemine aktarım yapılacak.\n\n` +
          `Bir üst sınıfa geçecek: ${promoted}\nMezun edilecek: ${graduated}\n` +
          `Sınıfı korunacak: ${rows.length - promoted - graduated}\n\nDevam edilsin mi?`,
      )
    ) {
      return;
    }

    setApplying(true);
    setError('');
    try {
      // Hedef dönem yoksa hazırlık durumunda oluşturulur.
      const term = await ensureTerm({
        terms,
        code: targetTerm,
        schoolId: schoolId || undefined,
        note: `${sourceTerm} döneminden aktarım için oluşturuldu.`,
      });

      const applied = await applyPromotion({
        rows,
        sourceTerm,
        targetTerm,
        movedBy: account?.email || '',
        schoolId: schoolId || undefined,
      });
      setResult(applied);

      // Aktarım tamamlandıysa yeni dönem aktif döneme alınır.
      if (!applied.errors.length) {
        await activateTerm(terms, term);
        writeActiveTermCode(term.code);
        setViewCode(term.code);
        toast.success('Aktarım tamamlandı ve yeni dönem aktif edildi.', {
          description: `${applied.promoted} öğrenci üst sınıfa geçti, ${applied.graduated} öğrenci mezun edildi.`,
        });
      } else {
        toast.error(`${applied.errors.length} öğrenci aktarılamadı.`, {
          description: applied.errors.slice(0, 3).join('\n'),
          duration: 9000,
        });
      }

      setPlan(null);
      await refresh();
    } catch (e) {
      const message = (e as Error).message || 'Aktarım tamamlanamadı.';
      setError(message);
      toast.error('Aktarım başarısız', { description: message });
    } finally {
      setApplying(false);
    }
  };

  if (!allowed) {
    return (
      <div className="rounded-2xl border bg-card p-6 text-sm font-semibold text-muted-foreground">
        Dönem yönetimi ve sınıf aktarımı için kullanıcı yönetimi yetkisi gerekir. Kurum
        yöneticinizle görüşebilirsiniz.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start gap-3">
        <div className="flex-1 space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight">
            <CalendarRange className="h-6 w-6 text-primary" />
            Dönem ve sınıf aktarımı
          </h1>
          <p className="text-sm text-muted-foreground">
            Yeni eğitim-öğretim yılını açın, öğrencileri bir üst sınıfa aktarın, mezunları
            işaretleyin. Geçmiş yılın verisi silinmez.
          </p>
        </div>
        <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
          <Busy busy={loading}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Yenile
          </Busy>
        </Button>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/*
        Aktif dönem kartı: sayfanın en üstünde, hangi eğitim-öğretim yılının
        yürürlükte olduğunu ve diğer modüllerin (yoklama, muhasebe, sınav)
        hangi döneme yazdığını tek bakışta gösterir.
      */}
      <section
        className={`flex flex-wrap items-center gap-4 rounded-2xl border p-5 shadow-sm ${
          activeTerm ? 'border-emerald-300 bg-emerald-50/70' : 'border-amber-300 bg-amber-50/70'
        }`}
      >
        <span
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${
            activeTerm ? 'bg-emerald-600/10 text-emerald-700' : 'bg-amber-600/10 text-amber-700'
          }`}
        >
          <CalendarRange className="h-6 w-6" />
        </span>
        <div className="mr-auto min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Şu anda aktif dönem
          </p>
          <p className="truncate text-xl font-extrabold sm:text-2xl">
            {activeTerm
              ? activeTerm.label || `${activeTerm.code} Eğitim Öğretim Yılı`
              : 'Aktif dönem tanımlı değil'}
          </p>
          <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
            {activeTerm ? (
              <>
                {activeTerm.start_date} — {activeTerm.end_date} · Yoklama, muhasebe, sınav ve
                rehberlik kayıtları bu döneme işlenir.
              </>
            ) : (
              'Aşağıdan bir dönem ekleyip “Aktif yap” butonuyla yürürlüğe alın; modüller o zaman doğru döneme yazar.'
            )}
          </p>
        </div>
        <div className="rounded-xl border bg-card px-4 py-2 text-center">
          <p className="text-[11px] font-bold text-muted-foreground">Dönem kodu</p>
          <p className="text-lg font-extrabold tabular-nums">{activeTerm?.code || '—'}</p>
        </div>
      </section>

      {/*
        Aktif dönem açıldı ama öğrenciler hâlâ önceki dönemin kayıtlarında.
        Bu uyarı olmadan kullanıcı yeni yılın boş görünmesini hata sanar.
      */}
      {promotionPending && (
        <div className="flex flex-wrap items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">
            {activeCode} dönemi aktif, ancak öğrenciler hâlâ {recordTerm} kayıtlarında. Dönem
            açmak öğrencileri taşımaz; aşağıdaki “Üst sınıfa aktarım” bölümünden {recordTerm} →{' '}
            {activeCode} aktarımını yapın. Aktarım yapılmadan {activeCode} dönemi boş görünür ve
            eski dönemin verileri yeni yılın verisi gibi gösterilmez.
          </span>
        </div>
      )}

      {/* Dönemler */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 rounded-2xl border bg-card p-5 shadow-sm lg:col-span-2">
          <h2 className="text-base font-extrabold">Eğitim-öğretim yılları</h2>
          {loading && !terms.length ? (
            <p className="text-sm text-muted-foreground">Dönemler yükleniyor…</p>
          ) : terms.length ? (
            <ul className="space-y-2">
              {terms.map((term) => (
                <li
                  key={term.id}
                  className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${
                    term.code === viewCode ? 'border-primary/50 bg-primary/5' : ''
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-extrabold">{term.label || term.code}</p>
                    <p className="text-xs text-muted-foreground">
                      {term.start_date} — {term.end_date}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                        TERM_STATUS_CLASS[term.status] ?? 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {TERM_STATUS_LABELS[term.status] ?? term.status}
                    </span>
                    {/*
                      Arşiv dönemleri de görüntülenebilir: kullanıcı geçmiş yılın
                      sınıf dağılımını okumak için dönemi aktif etmek zorunda
                      kalmamalı. Aktif etme ayrı bir karar olarak kalıyor.
                    */}
                    <Button
                      size="sm"
                      variant={term.code === viewCode ? 'secondary' : 'outline'}
                      onClick={() => setViewCode(term.code)}
                    >
                      {term.code === viewCode ? 'Görüntüleniyor' : 'Görüntüle'}
                    </Button>
                    {term.status !== 'aktif' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleActivate(term)}
                        disabled={busyTerm === term.id}
                      >
                        <Busy busy={busyTerm === term.id}>Aktif yap</Busy>
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleArchive(term)}
                        disabled={busyTerm === term.id}
                      >
                        <Busy busy={busyTerm === term.id}>Arşive al</Busy>
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
              Henüz dönem tanımlanmamış. Aşağıdan içinde bulunduğunuz yılı ekleyebilirsiniz.
            </p>
          )}

          <div className="flex flex-wrap items-end gap-3 border-t pt-3">
            <div className="w-40 space-y-1.5">
              <Label htmlFor="term-code">Yeni dönem kodu</Label>
              <Input
                id="term-code"
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
                placeholder="2027-2028"
              />
            </div>
            <Button onClick={() => void handleCreateTerm()} disabled={creating}>
              <Busy busy={creating}>
                <Plus className="mr-2 h-4 w-4" />
                Dönem ekle
              </Busy>
            </Button>
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border bg-card p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-base font-extrabold">
            <Users className="h-4 w-4 text-primary" />
            Durum
          </h2>
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Kurum</dt>
              <dd className="truncate font-bold">{school?.name || '—'}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Aktif dönem</dt>
              <dd className="font-bold">{activeTerm?.code || 'Tanımlı değil'}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Arşiv dönemi</dt>
              <dd className="font-bold tabular-nums">{archivedTerms.length}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Aktarılabilir öğrenci</dt>
              <dd className="font-bold tabular-nums">{students.length}</dd>
            </div>
          </dl>
          {archivedTerms.length > 0 && (
            <div className="space-y-2 border-t pt-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                Arşivdeki dönemler
              </p>
              <ul className="space-y-1.5">
                {archivedTerms.map((term) => (
                  <li key={term.id} className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setViewCode(term.code)}
                      className="truncate text-left text-xs font-bold text-primary underline-offset-2 hover:underline"
                    >
                      {term.code}
                    </button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => void handleActivate(term)}
                      disabled={busyTerm === term.id}
                    >
                      <Busy busy={busyTerm === term.id}>Yeniden aktif yap</Busy>
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {/*
        Seçili dönemin kendi verisi.

        Kural: bir bilgi yalnızca ait olduğu dönemde görünür. Aktif dönemde
        öğrenci kayıtlarının güncel sınıfı geçerlidir; arşiv dönemlerinde ise o
        yılın sınıfları aktarım günlüğündeki "önce / sonra" bilgisinden okunur.
        Böylece 8-A'ya geçmiş bir öğrenci geçmiş yılda hâlâ 7-A görünür.
      */}
      <CollapsibleSection
        title={`${viewCode || '—'} dönemi verileri`}
        icon={<Layers className="h-4 w-4" />}
        storageKey="terms.termData"
        bodyClassName="space-y-3"
      >
        <div className="flex flex-wrap items-center gap-3">
          {viewTerm && (
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                TERM_STATUS_CLASS[viewTerm.status] ?? 'bg-slate-200 text-slate-700'
              }`}
            >
              {TERM_STATUS_LABELS[viewTerm.status] ?? viewTerm.status}
            </span>
          )}
          {viewCode && recordTerm && viewCode !== recordTerm && (
            <span className="rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-700">
              {viewCode.localeCompare(recordTerm) > 0
                ? 'Öğrenciler henüz bu döneme aktarılmadı'
                : 'Geçmiş dönem kayıtları'}
            </span>
          )}
          {viewCode && activeCode && viewCode !== activeCode && (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              onClick={() => setViewCode(activeCode)}
            >
              Aktif döneme dön
            </Button>
          )}
        </div>

        <p className="text-xs font-semibold text-muted-foreground">
          {TERM_SNAPSHOT_SOURCE_LABELS[snapshot.source]}
          {snapshot.studentCount > 0 ? ` · ${snapshot.studentCount} öğrenci` : ''}
        </p>

        {snapshot.rows.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {snapshot.rows.map((row) => (
              <div key={row.className} className="space-y-2 rounded-xl border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-extrabold">{row.className}</p>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums">
                    {row.studentCount}
                  </span>
                </div>
                <ul className="max-h-40 space-y-0.5 overflow-auto text-xs text-muted-foreground">
                  {row.students.map((name) => (
                    <li key={name} className="truncate">
                      {name}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs font-semibold text-muted-foreground">
            {snapshot.source === 'aktarim-bekliyor'
              ? `Bu dönem yeni açıldı ve henüz öğrenci aktarılmadı. Öğrenciler ${
                  recordTerm || 'önceki dönem'
                } kayıtlarında duruyor; aşağıdaki “Üst sınıfa aktarım” bölümünden ${viewCode} dönemine aktarabilirsiniz.`
              : viewCode === recordTerm
                ? 'Bu dönemde henüz öğrenci kaydı yok. Öğrenci ekledikçe sınıf dağılımı burada görünür.'
                : 'Bu döneme ait aktarım veya sınıf kaydı bulunmuyor. Dönem verisi yalnızca o dönemde yapılan işlemlerden oluşur.'}
          </p>
        )}
      </CollapsibleSection>

      {/* Aktarım kurulumu */}
      <CollapsibleSection
        title="Üst sınıfa aktarım"
        icon={<ArrowUpCircle className="h-4 w-4" />}
        storageKey="terms.promotion"
        bodyClassName="space-y-4"
      >
        <p className="text-sm text-muted-foreground">
          Kaynak dönemdeki öğrenciler hedef dönemde bir üst sınıfa geçer. Mezuniyet seviyesindeki
          öğrenciler mezun edilir; kayıtları silinmez, geçmiş analizleri korunur.
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="source-term">
              Kaynak dönem (öğrencilerin şu anki dönemi)
              {sourceTerm && activeTerm?.code === sourceTerm ? ' · aktif dönem' : ''}
            </Label>
            <Input
              id="source-term"
              value={sourceTerm}
              onChange={(e) => setSourceTerm(e.target.value)}
              placeholder="2026-2027"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="target-term">
              Hedef dönem (aktarımdan sonra aktif olacak dönem)
            </Label>
            <select
              id="target-term"
              value={targetTerm}
              onChange={(e) => setTargetTerm(e.target.value)}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm font-semibold"
            >
              {Array.from(
                new Set([nextTermCode(sourceTerm), ...terms.map((t) => t.code), targetTerm]),
              )
                .filter((code) => code && code !== sourceTerm)
                .map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="graduation-grade">Mezuniyet seviyesi</Label>
            <select
              id="graduation-grade"
              value={graduationGrade}
              onChange={(e) => setGraduationGrade(Number(e.target.value) || 8)}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm font-semibold"
            >
              {[4, 8, 12].map((grade) => (
                <option key={grade} value={grade}>
                  {grade}. sınıf sonunda mezun
                </option>
              ))}
            </select>
          </div>
        </div>

        <Button onClick={handlePreparePlan} disabled={loading}>
          <GraduationCap className="mr-2 h-4 w-4" />
          Aktarım planını hazırla
        </Button>

        {plan && (
          <div className="space-y-3 rounded-xl border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-extrabold">
                {planStats.selected}/{planStats.total} öğrenci seçili · Üst sınıf{' '}
                {planStats.promoted} · Mezun {planStats.graduated} · Sabit {planStats.kept}
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => toggleAll(true)}>
                  Tümünü seç
                </Button>
                <Button size="sm" variant="outline" onClick={() => toggleAll(false)}>
                  Seçimi kaldır
                </Button>
              </div>
            </div>

            <div className="max-h-96 overflow-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/80 text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">Seç</th>
                    <th className="px-3 py-2 text-left">Öğrenci</th>
                    <th className="px-3 py-2 text-left">Mevcut</th>
                    <th className="px-3 py-2 text-left">Yeni</th>
                    <th className="px-3 py-2 text-left">Karar</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.map((row) => (
                    <tr key={row.student.id} className="border-t">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={row.selected}
                          onChange={() => toggleRow(Number(row.student.id))}
                          className="h-4 w-4"
                          aria-label={`${row.student.full_name} seç`}
                        />
                      </td>
                      <td className="px-3 py-2 font-semibold">{row.student.full_name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.fromClass || '—'}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${ACTION_CLASS[row.action]}`}
                        >
                          {row.toClass}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={row.action}
                          onChange={(e) =>
                            changeAction(Number(row.student.id), e.target.value as PromotionAction)
                          }
                          className="h-8 rounded-md border bg-background px-2 text-xs font-semibold"
                          aria-label={`${row.student.full_name} kararı`}
                        >
                          {(
                            ['yukseltildi', 'mezun', 'sabit'] satisfies PromotionAction[]
                          ).map((action) => (
                            <option key={action} value={action}>
                              {PROMOTION_ACTION_LABELS[action]}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void handleApply()} disabled={applying}>
                <Busy busy={applying}>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  {targetTerm} dönemine aktar
                </Busy>
              </Button>
              <Button variant="outline" onClick={() => setPlan(null)} disabled={applying}>
                Planı iptal et
              </Button>
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-2 rounded-xl border bg-muted/40 p-4 text-sm">
            <p className="font-extrabold">
              Aktarım sonucu: {result.promoted} üst sınıf · {result.graduated} mezun ·{' '}
              {result.kept} sabit
            </p>
            {result.errors.length ? (
              <ul className="space-y-1 text-xs font-semibold text-destructive">
                {result.errors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            ) : (
              <p className="text-xs font-semibold text-emerald-700">Tüm satırlar uygulandı.</p>
            )}
          </div>
        )}
      </CollapsibleSection>

      {/* Aktarım günlüğü */}
      <CollapsibleSection
        title={`${viewCode || targetTerm} aktarım günlüğü`}
        icon={<History className="h-4 w-4" />}
        storageKey="terms.log"
        bodyClassName="space-y-3"
      >
        {viewLogs.length ? (
          <div className="max-h-72 overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Öğrenci</th>
                  <th className="px-3 py-2 text-left">Önce</th>
                  <th className="px-3 py-2 text-left">Sonra</th>
                  <th className="px-3 py-2 text-left">Dönem</th>
                  <th className="px-3 py-2 text-left">Karar</th>
                </tr>
              </thead>
              <tbody>
                {viewLogs.map((log) => (
                  <tr key={log.id} className="border-t">
                    <td className="px-3 py-2 font-semibold">{log.student_name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{log.from_class || '—'}</td>
                    <td className="px-3 py-2">{log.to_class}</td>
                    <td className="px-3 py-2 text-xs font-semibold text-muted-foreground">
                      {log.source_term || '—'} → {log.target_term || '—'}
                    </td>
                    <td className="px-3 py-2 text-xs font-semibold">
                      {PROMOTION_ACTION_LABELS[(log.action || 'sabit') as PromotionAction] ??
                        log.action}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Bu dönem için henüz aktarım kaydı yok.
          </p>
        )}
      </CollapsibleSection>

      {/*
        Dönem arşivleme paneli.

        Kurum yöneticisi kendi kurumunun geçmiş dönemlerini arşivleyebilir ve
        paketi bilgisayarına indirebilir. "Bulut kopyasını sil" düğmesi geri
        alınamaz bir işlem olduğu için yalnızca platform yöneticisine açıktır;
        sunucu bunu ayrıca zorlar.
      */}
      <TermArchivePanel />

      <PageGuide storageKey="donemler" {...TERMS_GUIDE} />
    </div>
  );
}

export default function TermsPage() {
  return (
    <SiteLayout>
      <TermsInner />
    </SiteLayout>
  );
}