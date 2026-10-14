/**
 * Öğrenci / veli kayıt defteri.
 *
 * Elle girilen kayıtlar burada tutulur ve iki yöne birlikte çalışır:
 * - Analiz paneli: deneme sonuçlarındaki adla eşleşen kayıtlar "analizde var"
 *   olarak işaretlenir; analizde olup kayıtta olmayan öğrenciler tek tıkla
 *   kayıt defterine aktarılır.
 * - Muhasebe: her kaydın tahsilat özeti satırda görünür ve sayfadan çıkmadan
 *   taksitli ödeme planı açılabilir; plan öğrencinin adı ve sınıfıyla oluşur.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  UserPlus,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import SiteLayout, { useSession } from '@/components/SiteLayout';
import PageGuide from '@/components/PageGuide';
import { STUDENTS_GUIDE } from '@/lib/pageGuides';
import TemplateDownload from '@/components/TemplateDownload';
import ExcelToolbar from '@/components/ExcelToolbar';
import StudentAccountPanel from '@/components/StudentAccountPanel';
// NEDEN: Tüm modüllerde olduğu gibi büyük bölümler ok ile açılıp kapansın diye ortak bileşen kullanılıyor.
import CollapsibleSection from '@/components/CollapsibleSection';
import ClassManager from '@/components/ClassManager';
import {
  STUDENT_HEADERS,
  importStudents,
  studentExportSheet,
} from '@/lib/moduleExcel';
import {
  FEE_TYPES,
  FEE_TYPE_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  createInstallmentPlan,
  errorMessage,
  fetchAccounting,
  formatDateShort,
  formatTry,
  isMissingRecordError,
  splitInstallments,
  todayKey,
  type AccountingEntry,
  type FeeType,
  type PaymentMethod,
} from '@/lib/site';
import {
  EMPTY_FINANCE,
  GENDERS,
  GENDER_LABELS,
  PARENT_RELATIONS,
  PARENT_RELATION_LABELS,
  STUDENT_STATUSES,
  STUDENT_STATUS_LABELS,
  createStudentRecord,
  deleteStudentRecord,
  examRefIndex,
  fetchStudentRecords,
  financeByStudent,
  findDuplicateRecord,
  missingFromRegistry,
  scopeRecordsToSchool,
  studentNameKey,
  updateStudentRecord,
  type StudentInput,
  type StudentRecord,
  type StudentStatus,
} from '@/lib/students';
import { emptyDataset, listStudents, loadDataset, type StudentRef } from '@/lib/store';
import { pullDataset, purgeStudentsFromDataset } from '@/lib/cloud';
import type { ExamDataset } from '@/lib/types';

const EMPTY_FORM: StudentInput = {
  student_no: '',
  full_name: '',
  class_name: '',
  gender: 'belirtilmemis',
  birth_date: '',
  student_phone: '',
  student_email: '',
  parent_name: '',
  parent_relation: 'anne',
  parent_phone: '',
  parent_email: '',
  parent2_name: '',
  parent2_relation: '',
  parent2_phone: '',
  address: '',
  enrolled_at: todayKey(),
  status: 'aktif',
  transport: 'yok',
  note: '',
};

const EMPTY_PLAN = {
  feeType: 'okul_kurs' as FeeType,
  paymentMethod: 'nakit' as PaymentMethod,
  total: '',
  installments: '1',
  firstDueDate: todayKey(),
  note: '',
};

const STATUS_CLASS: Record<string, string> = {
  aktif: 'bg-emerald-100 text-emerald-800',
  pasif: 'bg-amber-100 text-amber-900',
  ayrildi: 'bg-slate-200 text-slate-700',
};

function toForm(record: StudentRecord): StudentInput {
  return {
    student_no: record.student_no ?? '',
    full_name: record.full_name ?? '',
    class_name: record.class_name ?? '',
    gender: record.gender || 'belirtilmemis',
    birth_date: record.birth_date ?? '',
    student_phone: record.student_phone ?? '',
    student_email: record.student_email ?? '',
    parent_name: record.parent_name ?? '',
    parent_relation: record.parent_relation || 'anne',
    parent_phone: record.parent_phone ?? '',
    parent_email: record.parent_email ?? '',
    parent2_name: record.parent2_name ?? '',
    parent2_relation: record.parent2_relation ?? '',
    parent2_phone: record.parent2_phone ?? '',
    address: record.address ?? '',
    enrolled_at: record.enrolled_at || todayKey(),
    status: record.status || 'aktif',
    transport: record.transport || 'yok',
    note: record.note ?? '',
  };
}

/** Kısa etiketli metin alanı. */
function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function StudentsBody() {
  const { school, can } = useSession();
  const navigate = useNavigate();
  const editor = can('manage_records');
  const canBill = can('manage_accounting');
  /*
    Mali tutarlar (tahsil edilen, bekleyen, gecikmiş, yakın vade) yalnızca
    muhasebe görüntüleme yetkisi olan kullanıcıya gösterilir. Yetkisi olmayan
    kullanıcı için kayıt defterinde yalnızca "ödeme kaydı var / yok" bilgisi
    kalır; tutar, vade ve gecikme bilgisi sızmaz.
  */
  const canViewBilling = can('view_accounting');
  const schoolId = Number(school?.id) || undefined;

  const [records, setRecords] = useState<StudentRecord[]>([]);
  const [entries, setEntries] = useState<AccountingEntry[]>([]);
  const [examRefs, setExamRefs] = useState<StudentRef[]>([]);
  /**
   * Analiz veri kümesinin tamamı.
   *
   * Öğrenciyi analizden silmek için yalnızca isim listesi yetmez; silme sınav
   * kayıtlarının içinden yapıldığı için veri kümesinin kendisi tutulur.
   */
  const [dataset, setDataset] = useState<ExamDataset>(emptyDataset);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<StudentInput>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);

  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('hepsi');
  const [statusFilter, setStatusFilter] = useState<'hepsi' | StudentStatus>('aktif');

  const [planFor, setPlanFor] = useState<StudentRecord | null>(null);
  const [planForm, setPlanForm] = useState(EMPTY_PLAN);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [recs, acc] = await Promise.all([fetchStudentRecords(), fetchAccounting()]);
      setRecords(scopeRecordsToSchool(recs, schoolId));
      setEntries(acc);
    } catch (e) {
      setError(errorMessage(e, 'Öğrenci kayıtları yüklenemedi.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  // Analiz verisi: önce yerel önbellek, ardından kalıcı depodan gelen birleşik set.
  useEffect(() => {
    const local = loadDataset();
    setDataset(local);
    setExamRefs(listStudents(local.exams));
    let alive = true;
    void pullDataset(local)
      .then((merged) => {
        if (!alive) return;
        setDataset(merged);
        setExamRefs(listStudents(merged.exams));
      })
      .catch(() => {
        /* çevrimdışı: yerel önbellekle devam */
      });
    return () => {
      alive = false;
    };
  }, [schoolId]);

  const finance = useMemo(() => financeByStudent(entries), [entries]);
  const examIndex = useMemo(() => examRefIndex(examRefs), [examRefs]);
  const orphans = useMemo(() => missingFromRegistry(examRefs, records), [examRefs, records]);

  const classOptions = useMemo(() => {
    const set = new Set(records.map((r) => r.class_name).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b, 'tr'));
  }, [records]);

  const rows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR');
    return records
      .filter((r) => statusFilter === 'hepsi' || (r.status || 'aktif') === statusFilter)
      .filter((r) => classFilter === 'hepsi' || r.class_name === classFilter)
      .filter((r) => {
        if (!q) return true;
        return [
          r.full_name,
          r.class_name,
          r.student_no,
          r.parent_name,
          r.parent_phone,
          r.parent_email,
          r.student_email,
        ]
          .filter(Boolean)
          .some((v) => String(v).toLocaleLowerCase('tr-TR').includes(q));
      })
      .sort((a, b) => a.full_name.localeCompare(b.full_name, 'tr'));
  }, [records, search, classFilter, statusFilter]);

  const summary = useMemo(() => {
    let analyzed = 0;
    let withParentAccount = 0;
    records.forEach((r) => {
      const key = studentNameKey(r.full_name);
      if (examIndex.has(key)) analyzed += 1;
      if ((r.parent_email || '').trim()) withParentAccount += 1;
    });
    return {
      total: records.length,
      active: records.filter((r) => (r.status || 'aktif') === 'aktif').length,
      analyzed,
      withParentAccount,
    };
  }, [records, examIndex]);

  const preview = useMemo(() => {
    const total = Number(planForm.total);
    const count = Number(planForm.installments);
    if (!Number.isFinite(total) || total <= 0) return [];
    if (!Number.isFinite(count) || count < 1) return [];
    return splitInstallments(total, Math.min(36, Math.floor(count)));
  }, [planForm.total, planForm.installments]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, enrolled_at: todayKey() });
    setFormOpen(true);
  };

  const openEdit = (record: StudentRecord) => {
    setEditingId(record.id);
    setForm(toForm(record));
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setForm({ ...EMPTY_FORM, enrolled_at: todayKey() });
  };

  const submit = async () => {
    if (!form.full_name.trim()) {
      toast.error('Öğrenci adı zorunlu.');
      return;
    }
    if (!form.class_name.trim()) {
      toast.error('Sınıf bilgisi zorunlu.');
      return;
    }
    const duplicate = findDuplicateRecord(records, form.full_name, editingId);
    if (duplicate) {
      toast.error(`${duplicate.full_name} adlı öğrenci kayıt defterinde zaten var.`);
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        const updated = await updateStudentRecord(editingId, form, schoolId);
        setRecords((prev) => prev.map((r) => (r.id === editingId ? { ...r, ...updated } : r)));
        toast.success('Kayıt güncellendi.');
      } else {
        const created = await createStudentRecord(form, schoolId);
        setRecords((prev) => [created, ...prev]);
        toast.success('Öğrenci kaydı oluşturuldu.');
      }
      closeForm();
    } catch (e) {
      if (isMissingRecordError(e)) {
        toast.info('Bu kayıt artık mevcut değil, liste yenilendi.');
        await load();
        closeForm();
        return;
      }
      toast.error(errorMessage(e, 'Kayıt kaydedilemedi.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (record: StudentRecord) => {
    if (!window.confirm(`${record.full_name} kaydı silinsin mi?`)) return;
    try {
      await deleteStudentRecord(record.id);
      setRecords((prev) => prev.filter((r) => r.id !== record.id));
      toast.success('Kayıt silindi.');
    } catch (e) {
      if (isMissingRecordError(e)) {
        setRecords((prev) => prev.filter((r) => r.id !== record.id));
        toast.info('Kayıt zaten silinmiş, liste yenilendi.');
        await load();
        return;
      }
      toast.error(errorMessage(e, 'Kayıt silinemedi.'));
    }
  };

  /** Analizde sonucu olan öğrenciyi kayıt defterine aktarır. */
  const importFromAnalysis = async (ref: StudentRef) => {
    setSaving(true);
    try {
      const created = await createStudentRecord(
        {
          ...EMPTY_FORM,
          full_name: ref.name,
          class_name: ref.className === '—' ? '' : ref.className,
          note: 'Analiz panelinden aktarıldı.',
          enrolled_at: todayKey(),
        },
        schoolId,
      );
      setRecords((prev) => [created, ...prev]);
      toast.success(`${created.full_name} kayıt defterine eklendi.`);
    } catch (e) {
      toast.error(errorMessage(e, 'Aktarma başarısız.'));
    } finally {
      setSaving(false);
    }
  };

  const importAllFromAnalysis = async () => {
    setSaving(true);
    let added = 0;
    try {
      for (const ref of orphans) {
        const created = await createStudentRecord(
          {
            ...EMPTY_FORM,
            full_name: ref.name,
            class_name: ref.className === '—' ? '' : ref.className,
            note: 'Analiz panelinden aktarıldı.',
            enrolled_at: todayKey(),
          },
          schoolId,
        );
        setRecords((prev) => [created, ...prev]);
        added += 1;
      }
      toast.success(`${added} öğrenci kayıt defterine eklendi.`);
    } catch (e) {
      toast.error(errorMessage(e, `Aktarma ${added} kayıttan sonra durdu.`));
    } finally {
      setSaving(false);
    }
  };

  /**
   * Seçili öğrencileri analiz sonuçlarından çıkarır.
   *
   * Silme kayıt defterine değil deneme sonuçlarına uygulanır: bu isimler kayıt
   * defterinde hiç yok, yalnızca analizde duruyor. İşlem sonrası uyarı listesi
   * ve analizde eşleşen sayacı yeniden hesaplanır.
   */
  const purgeFromAnalysis = async (refs: StudentRef[], label: string) => {
    if (!refs.length) return;
    const question =
      refs.length === 1
        ? `${refs[0].name} adlı öğrencinin tüm deneme sonuçları analizden silinsin mi? Bu işlem geri alınamaz.`
        : `${refs.length} öğrencinin tüm deneme sonuçları analizden silinsin mi? Bu işlem geri alınamaz.`;
    if (!window.confirm(question)) return;

    setSaving(true);
    try {
      const { dataset: next, outcome } = await purgeStudentsFromDataset(
        dataset,
        refs.map((ref) => ref.key),
      );
      setDataset(next);
      setExamRefs(listStudents(next.exams));

      if (outcome.removedStudents === 0) {
        toast.info('Bu öğrencilere ait deneme sonucu bulunamadı.');
        return;
      }
      const detail = outcome.deletedExams
        ? ` ${outcome.deletedExams} deneme öğrencisi kalmadığı için kaldırıldı.`
        : '';
      if (outcome.ok) {
        toast.success(`${label} analizden silindi (${outcome.removedStudents} sonuç).${detail}`);
      } else {
        toast.warning(
          `${label} bu cihazda analizden çıkarıldı, ancak sunucu kaydı güncellenemedi. Bağlantı düzelince tekrar deneyin.`,
        );
      }
    } catch (e) {
      toast.error(errorMessage(e, 'Analizden silme başarısız.'));
    } finally {
      setSaving(false);
    }
  };

  const submitPlan = async () => {
    if (!planFor) return;
    const total = Number(planForm.total);
    const count = Math.floor(Number(planForm.installments));
    if (!Number.isFinite(total) || total <= 0) {
      toast.error('Geçerli bir toplam tutar girin.');
      return;
    }
    if (!Number.isFinite(count) || count < 1 || count > 36) {
      toast.error('Taksit sayısı 1 ile 36 arasında olmalı.');
      return;
    }
    setSaving(true);
    try {
      const created = await createInstallmentPlan({
        feeType: planForm.feeType,
        paymentMethod: planForm.paymentMethod,
        studentName: planFor.full_name,
        className: planFor.class_name,
        total,
        installments: count,
        firstDueDate: planForm.firstDueDate || todayKey(),
        note: planForm.note,
        schoolId,
      });
      setEntries((prev) => [...created, ...prev]);
      toast.success(
        count > 1
          ? `${planFor.full_name} için ${count} taksit oluşturuldu.`
          : `${planFor.full_name} için ödeme kaydı oluşturuldu.`,
      );
      setPlanFor(null);
      setPlanForm({ ...EMPTY_PLAN, firstDueDate: todayKey() });
    } catch (e) {
      toast.error(errorMessage(e, 'Ödeme planı oluşturulamadı.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Users className="h-5 w-5" />
        </span>
        <div className="mr-auto">
          <h1 className="text-xl font-extrabold">Öğrenci ve veli kayıtları</h1>
          <p className="text-xs text-muted-foreground">
            Kayıtlar analiz panelindeki deneme sonuçlarıyla ve muhasebedeki taksitlerle öğrenci adı
            üzerinden eşleşir.
          </p>
        </div>
        {editor && (
          <Button size="sm" onClick={formOpen ? closeForm : openCreate}>
            {formOpen ? (
              <>
                <X className="mr-1.5 h-3.5 w-3.5" />
                Formu kapat
              </>
            ) : (
              <>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Yeni öğrenci kaydı
              </>
            )}
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm font-semibold text-destructive">
          {error}
        </div>
      )}

      {editor && <TemplateDownload />}

      {/* Excel içe/dışa aktarma: kayıt defterinin tüm alanları tek dosyada taşınır. */}
      <ExcelToolbar
        className="no-print"
        compact
        fileName={`ogrenci-kayitlari-${new Date().toISOString().slice(0, 10)}`}
        buildSheets={() => [studentExportSheet(records)]}
        canImport={editor}
        expectedHeaders={STUDENT_HEADERS}
        templateSheetName="Öğrenci Kayıtları"
        templateHeaders={STUDENT_HEADERS}
        onImport={(sheet) => importStudents(sheet, records, schoolId)}
        onImported={() => void load()}
      />

      {/*
        Öğrenci giriş hesapları yalnızca kullanıcı yönetimi yetkisi olan hesaba
        açılır: panel toplu şifre üretiyor ve kayıt defterindeki e-postayı
        yazıyor. Kayıt düzenleme yetkisi tek başına bu kapıyı açmamalı.
      */}
      {can('manage_users') && (
        <StudentAccountPanel
          records={records}
          schoolId={schoolId}
          onChanged={() => void load()}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-xs font-semibold text-muted-foreground">Toplam kayıt</p>
          <p className="mt-1 text-lg font-extrabold tabular-nums">{summary.total}</p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-xs font-semibold text-muted-foreground">Aktif öğrenci</p>
          <p className="mt-1 text-lg font-extrabold tabular-nums text-emerald-700">
            {summary.active}
          </p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-xs font-semibold text-muted-foreground">Analizde eşleşen</p>
          <p className="mt-1 text-lg font-extrabold tabular-nums text-primary">
            {summary.analyzed}
          </p>
          <p className="text-[11px] text-muted-foreground">{orphans.length} kayıtsız isim</p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-xs font-semibold text-muted-foreground">Veli e-postası tanımlı</p>
          <p className="mt-1 text-lg font-extrabold tabular-nums">{summary.withParentAccount}</p>
        </div>
      </div>

      {editor && orphans.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" />
            <p className="mr-auto text-sm font-bold text-amber-900">
              Analizde sonucu olan {orphans.length} öğrenci kayıt defterinde yok
            </p>
            <Button size="sm" variant="outline" onClick={importAllFromAnalysis} disabled={saving}>
              Tümünü kayıt defterine ekle
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => purgeFromAnalysis(orphans, `${orphans.length} öğrenci`)}
              disabled={saving}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              Tümünü analizden sil
            </Button>
          </div>
          <p className="text-[11px] font-semibold text-amber-800">
            İsme tıklayarak kayıt defterine ekleyin, çöp kutusuna tıklayarak o öğrencinin tüm
            deneme sonuçlarını analizden silin.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {orphans.slice(0, 24).map((ref) => (
              <span
                key={ref.key}
                className="inline-flex items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-[11px] font-bold"
              >
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => importFromAnalysis(ref)}
                  title={`${ref.name} kaydını kayıt defterine ekle`}
                  className="inline-flex items-center gap-1 hover:md:text-primary"
                >
                  <UserPlus className="h-3 w-3" />
                  {ref.name}
                  <span className="text-muted-foreground">{ref.className}</span>
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => purgeFromAnalysis([ref], ref.name)}
                  title={`${ref.name} öğrencisinin deneme sonuçlarını analizden sil`}
                  className="inline-flex items-center rounded-full p-0.5 text-red-600 hover:md:bg-red-100"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            ))}
            {orphans.length > 24 && (
              <span className="rounded-full border bg-card px-2.5 py-1 text-[11px] font-bold">
                +{orphans.length - 24} öğrenci
              </span>
            )}
          </div>
        </div>
      )}

      <ClassManager
        records={records}
        editable={Boolean(editor)}
        onUpdated={(updated) =>
          setRecords((prev) =>
            prev.map((r) => {
              const u = updated.find((x) => x.id === r.id);
              return u ? { ...r, class_name: u.class_name } : r;
            }),
          )
        }
      />

      {editor && formOpen && (
        <CollapsibleSection
          title={editingId ? 'Kaydı güncelle' : 'Yeni öğrenci kaydı'}
          storageKey="students.form"
          className="space-y-3"
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Okul no">
              <Input
                value={form.student_no}
                onChange={(e) => setForm({ ...form, student_no: e.target.value })}
                placeholder="1234"
                className="h-9"
              />
            </Field>
            <Field label="Öğrenci adı soyadı *">
              <Input
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                placeholder="Ayşe Yılmaz"
                className="h-9"
              />
            </Field>
            <Field label="Sınıf *">
              <Input
                value={form.class_name}
                onChange={(e) => setForm({ ...form, class_name: e.target.value })}
                placeholder="8/A"
                className="h-9"
              />
            </Field>
            <Field label="Durum">
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                {STUDENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STUDENT_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Cinsiyet">
              <select
                value={form.gender}
                onChange={(e) => setForm({ ...form, gender: e.target.value })}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                {GENDERS.map((g) => (
                  <option key={g} value={g}>
                    {GENDER_LABELS[g]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Doğum tarihi">
              <Input
                type="date"
                value={form.birth_date}
                onChange={(e) => setForm({ ...form, birth_date: e.target.value })}
                className="h-9"
              />
            </Field>
            <Field label="Kayıt tarihi">
              <Input
                type="date"
                value={form.enrolled_at}
                onChange={(e) => setForm({ ...form, enrolled_at: e.target.value })}
                className="h-9"
              />
            </Field>
            <Field label="Servis">
              <select
                value={form.transport}
                onChange={(e) => setForm({ ...form, transport: e.target.value })}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                <option value="yok">Servis kullanmıyor</option>
                <option value="var">Servis kullanıyor</option>
              </select>
            </Field>
            <Field label="Öğrenci telefonu">
              <Input
                value={form.student_phone}
                onChange={(e) => setForm({ ...form, student_phone: e.target.value })}
                placeholder="05xx xxx xx xx"
                className="h-9"
              />
            </Field>
            <Field label="Öğrenci e-postası (portal girişi)">
              <Input
                value={form.student_email}
                onChange={(e) => setForm({ ...form, student_email: e.target.value })}
                placeholder="ogrenci@ornek.com"
                className="h-9"
              />
            </Field>
            <Field label="Veli adı soyadı">
              <Input
                value={form.parent_name}
                onChange={(e) => setForm({ ...form, parent_name: e.target.value })}
                placeholder="Fatma Yılmaz"
                className="h-9"
              />
            </Field>
            <Field label="Yakınlık">
              <select
                value={form.parent_relation}
                onChange={(e) => setForm({ ...form, parent_relation: e.target.value })}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                {PARENT_RELATIONS.map((r) => (
                  <option key={r} value={r}>
                    {PARENT_RELATION_LABELS[r]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Veli telefonu">
              <Input
                value={form.parent_phone}
                onChange={(e) => setForm({ ...form, parent_phone: e.target.value })}
                placeholder="05xx xxx xx xx"
                className="h-9"
              />
            </Field>
            <Field label="Veli e-postası (portal girişi)">
              <Input
                value={form.parent_email}
                onChange={(e) => setForm({ ...form, parent_email: e.target.value })}
                placeholder="veli@ornek.com"
                className="h-9"
              />
            </Field>
            <Field label="İkinci veli">
              <Input
                value={form.parent2_name}
                onChange={(e) => setForm({ ...form, parent2_name: e.target.value })}
                placeholder="Opsiyonel"
                className="h-9"
              />
            </Field>
            <Field label="İkinci veli telefonu">
              <Input
                value={form.parent2_phone}
                onChange={(e) => setForm({ ...form, parent2_phone: e.target.value })}
                placeholder="Opsiyonel"
                className="h-9"
              />
            </Field>
            <Field label="Adres" className="sm:col-span-2">
              <Input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Mahalle / sokak / no"
                className="h-9"
              />
            </Field>
            <Field label="Not" className="sm:col-span-2">
              <Input
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="Rehberlik veya muhasebe notu"
                className="h-9"
              />
            </Field>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Veli e-postası, o velinin portal girişinde kendi çocuğunun karnesini ve ödeme planını
            görmesi için kullanılır.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={closeForm} disabled={saving}>
              Vazgeç
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {editingId ? 'Değişiklikleri kaydet' : 'Kaydı oluştur'}
            </Button>
          </div>
        </CollapsibleSection>
      )}

      {canBill && planFor && (
        <div className="space-y-3 rounded-2xl border border-primary/30 bg-primary/5 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Wallet className="h-4 w-4 text-primary" />
            <p className="mr-auto text-sm font-extrabold">
              {planFor.full_name} · {planFor.class_name} için ödeme planı
            </p>
            <Button size="sm" variant="outline" onClick={() => setPlanFor(null)}>
              Kapat
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Ödeme türü">
              <select
                value={planForm.feeType}
                onChange={(e) => setPlanForm({ ...planForm, feeType: e.target.value as FeeType })}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                {FEE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {FEE_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Toplam tutar (TL)">
              <Input
                type="number"
                min="0"
                value={planForm.total}
                onChange={(e) => setPlanForm({ ...planForm, total: e.target.value })}
                placeholder="24000"
                className="h-9"
              />
            </Field>
            <Field label="Taksit sayısı">
              <Input
                type="number"
                min="1"
                max="36"
                value={planForm.installments}
                onChange={(e) => setPlanForm({ ...planForm, installments: e.target.value })}
                className="h-9"
              />
            </Field>
            <Field label="Ödeme yöntemi">
              <select
                value={planForm.paymentMethod}
                onChange={(e) =>
                  setPlanForm({ ...planForm, paymentMethod: e.target.value as PaymentMethod })
                }
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="İlk taksit vadesi">
              <Input
                type="date"
                value={planForm.firstDueDate}
                onChange={(e) => setPlanForm({ ...planForm, firstDueDate: e.target.value })}
                className="h-9"
              />
            </Field>
            <Field label="Not" className="sm:col-span-2 lg:col-span-3">
              <Input
                value={planForm.note}
                onChange={(e) => setPlanForm({ ...planForm, note: e.target.value })}
                placeholder="Opsiyonel"
                className="h-9"
              />
            </Field>
          </div>
          {preview.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {preview.slice(0, 12).map((amount, i) => (
                <span
                  key={i}
                  className="rounded-full border bg-card px-2.5 py-1 text-[11px] font-bold tabular-nums"
                >
                  {i + 1}. {formatTry(amount)}
                </span>
              ))}
              {preview.length > 12 && (
                <span className="rounded-full border bg-card px-2.5 py-1 text-[11px] font-bold">
                  +{preview.length - 12} taksit
                </span>
              )}
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={submitPlan} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Planı muhasebeye kaydet
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card px-3 py-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold uppercase text-muted-foreground">Sınıf</label>
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="hepsi">Tüm sınıflar</option>
            {classOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold uppercase text-muted-foreground">Öğrenci</label>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Öğrenci adı, veli, telefon veya e-posta"
            className="h-9 w-full sm:w-72"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold uppercase text-muted-foreground">Durum</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'hepsi' | StudentStatus)}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="hepsi">Tüm durumlar</option>
            {STUDENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STUDENT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        {(classFilter !== 'hepsi' || search.trim() || statusFilter !== 'aktif') && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setClassFilter('hepsi');
              setSearch('');
              setStatusFilter('aktif');
            }}
          >
            Filtreyi temizle
          </Button>
        )}
        <span className="ml-auto text-xs font-semibold text-muted-foreground">
          {rows.length} kayıt listeleniyor
        </span>
      </div>

      <CollapsibleSection
        title="Öğrenci kayıt defteri"
        badge={`${rows.length} kayıt`}
        storageKey="students.list"
        bodyClassName="px-0 py-0 overflow-x-auto"
      >
        <table className="w-full min-w-[1040px] text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-bold">Öğrenci</th>
              <th className="px-3 py-2 text-left font-bold">Veli</th>
              <th className="px-3 py-2 text-left font-bold">İletişim</th>
              <th className="px-3 py-2 text-left font-bold">Analiz</th>
              <th className="px-3 py-2 text-left font-bold">Muhasebe</th>
              <th className="px-3 py-2 text-left font-bold">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const key = studentNameKey(r.full_name);
              const ref = examIndex.get(key);
              const f = finance.get(key) ?? EMPTY_FINANCE;
              const status = (r.status || 'aktif') as StudentStatus;
              return (
                <tr key={r.id} className="border-t align-top">
                  <td className="px-3 py-2">
                    <p className="font-bold">{r.full_name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {r.class_name}
                      {r.student_no ? ` · No: ${r.student_no}` : ''}
                    </p>
                    <span
                      className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        STATUS_CLASS[status] ?? STATUS_CLASS.aktif
                      }`}
                    >
                      {STUDENT_STATUS_LABELS[status]}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <p className="font-medium">{r.parent_name || '—'}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {r.parent_relation
                        ? PARENT_RELATION_LABELS[r.parent_relation as 'anne'] || r.parent_relation
                        : ''}
                    </p>
                    {r.parent2_name && (
                      <p className="text-[11px] text-muted-foreground">
                        2. veli: {r.parent2_name}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <p className="text-xs tabular-nums">{r.parent_phone || '—'}</p>
                    <p className="text-[11px] text-muted-foreground break-all">
                      {r.parent_email || 'Veli e-postası yok'}
                    </p>
                    {r.student_email && (
                      <p className="text-[11px] text-muted-foreground break-all">
                        Öğrenci: {r.student_email}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {ref ? (
                      <>
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                          <CheckCircle2 className="h-3 w-3" />
                          {ref.examCount} deneme
                        </span>
                        <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                          Son net: {ref.latestNet !== undefined ? ref.latestNet : '—'}
                        </p>
                        <button
                          type="button"
                          onClick={() => navigate(`/analiz?ogrenci=${encodeURIComponent(r.full_name)}`)}
                          className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-primary"
                        >
                          <BarChart3 className="h-3 w-3" />
                          Karneyi aç
                        </button>
                      </>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-700">
                        Deneme sonucu yok
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {f.count ? (
                      canViewBilling ? (
                        <>
                          <p className="text-[11px] font-semibold text-emerald-700 tabular-nums">
                            Tahsil: {formatTry(f.collected)}
                          </p>
                          <p className="text-[11px] font-semibold text-amber-700 tabular-nums">
                            Bekleyen: {formatTry(f.pending)}
                          </p>
                          {f.overdue > 0 && (
                            <p className="text-[11px] font-semibold text-red-700 tabular-nums">
                              Gecikmiş: {formatTry(f.overdue)}
                            </p>
                          )}
                          {f.nextDue && (
                            <p className="text-[11px] text-muted-foreground">
                              Yakın vade: {formatDateShort(f.nextDue)}
                            </p>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              navigate(`/muhasebe?ogrenci=${encodeURIComponent(r.full_name)}`)
                            }
                            className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-primary"
                          >
                            <Wallet className="h-3 w-3" />
                            Taksitleri gör
                          </button>
                        </>
                      ) : (
                        <span className="text-[11px] font-semibold text-muted-foreground">
                          Ödeme kaydı var
                        </span>
                      )
                    ) : (
                      <span className="text-[11px] text-muted-foreground">Ödeme kaydı yok</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {canBill && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setPlanFor(r);
                            setPlanForm({ ...EMPTY_PLAN, firstDueDate: todayKey() });
                          }}
                        >
                          Ödeme planı
                        </Button>
                      )}
                      {editor && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => openEdit(r)}>
                            <Pencil className="mr-1 h-3 w-3" />
                            Düzenle
                          </Button>
                          <button
                            type="button"
                            onClick={() => remove(r)}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-destructive"
                          >
                            <Trash2 className="h-3 w-3" />
                            Sil
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  {records.length
                    ? 'Bu filtreyle kayıt bulunamadı.'
                    : 'Henüz öğrenci kaydı yok. "Yeni öğrenci kaydı" ile başlayın veya analizdeki isimleri aktarın.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </CollapsibleSection>

      <PageGuide storageKey="ogrenciler" {...STUDENTS_GUIDE} />
    </div>
  );
}

export default function StudentsPage() {
  return (
    <SiteLayout anyPermission={['manage_records', 'view_school']} wide>
      <StudentsBody />
    </SiteLayout>
  );
}