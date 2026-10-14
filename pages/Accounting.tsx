/**
 * Muhasebe sayfası.
 *
 * Yönetici:
 * - Toplam tutar + taksit sayısı + ödeme yöntemi girerek taksit planı oluşturur.
 * - Ödeme türü seçer (okul/kurs, kıyafet, kitap, ek ders, yemek, servis, diğer).
 * - Ödenenler / Bekleyenler / Vadesi geçenler / Giderler sekmelerinden takip eder.
 *
 * Veli:
 * - Yalnızca kendi öğrencisinin taksitlerini aynı sekmelerde görür.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  FileSignature,
  FileText,
  Loader2,
  Plus,
  Trash2,
  Users,
  Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import SiteLayout, { useSession } from '@/components/SiteLayout';
import PageGuide from '@/components/PageGuide';
import CollapsibleSection from '@/components/CollapsibleSection';
import { ACCOUNTING_GUIDE } from '@/lib/pageGuides';
import {
  ACCOUNTING_STATUS_LABELS,
  EXPENSE_TYPES,
  FEE_TYPES,
  FEE_TYPE_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  accountingSummary,
  createAccountingEntry,
  createInstallmentPlan,
  daysUntilDue,
  deleteAccountingEntry,
  effectiveStatus,
  errorMessage,
  feeTypeBreakdown,
  feeTypeLabel,
  fetchAccounting,
  formatDateShort,
  formatTry,
  isMissingRecordError,
  paymentMethodLabel,
  splitInstallments,
  todayKey,
  updateAccountingEntry,
  type AccountingEntry,
  type AccountingStatus,
  type FeeType,
  type PaymentMethod,
} from '@/lib/site';
import {
  fetchStudentRecords,
  scopeRecordsToSchool,
  studentNameKey,
  type StudentRecord,
} from '@/lib/students';
import { useLinkedStudents } from '@/hooks/use-linked-students';
import ExcelToolbar from '@/components/ExcelToolbar';
import {
  ACCOUNTING_HEADERS,
  accountingExportSheet,
  importAccounting,
} from '@/lib/moduleExcel';
import PaymentDocumentsPanel from '@/components/PaymentDocumentsPanel';
import StudentPaymentDetail from '@/components/StudentPaymentDetail';
import StudentContractDialog from '@/components/StudentContractDialog';
import {
  docsByEntry,
  fetchPaymentDocuments,
  groupPaymentsByStudent,
  scopeDocsToSchool,
  type PaymentDocument,
} from '@/lib/paymentDocs';
import {
  buildContractPdf,
  type ContractInstallment,
} from '@/lib/contractPdf';
import { downloadBlob } from '@/lib/paymentPdf';
import {
  CONTRACT_STATUS_CLASS,
  CONTRACT_STATUS_LABELS,
  contractStatus,
  contractsByStudent,
  deleteStudentContract,
  fetchStudentContracts,
  parseClauses,
  parseInstallments,
  scopeContractsToSchool,
  type StudentContract,
} from '@/lib/contracts';
import FinanceSummary from '@/components/FinanceSummary';
import AccountingReports from '@/components/AccountingReports';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  MONEY_EPSILON,
  applyPayment,
  missingRevertTargets,
  recordTotal,
  revertPayment,
  settlementOf,
  settledStatus,
} from '@/lib/settlement';

type TabKey =
  | 'ozet'
  | 'mali'
  | 'ogrenci'
  | 'sozlesme'
  | 'odenen'
  | 'bekleyen'
  | 'geciken'
  | 'gider'
  | 'rapor';

const TABS: { key: TabKey; label: string; managerOnly?: boolean }[] = [
  { key: 'ozet', label: 'Tüm kayıtlar' },
  // Gelir–gider dengesi ve net kâr yalnızca gider verisini görebilen role açık.
  { key: 'mali', label: 'Mali özet', managerOnly: true },
  { key: 'ogrenci', label: 'Öğrenci bazlı' },
  { key: 'sozlesme', label: 'Sözleşmeler' },
  { key: 'odenen', label: 'Ödenenler' },
  { key: 'bekleyen', label: 'Bekleyenler' },
  { key: 'geciken', label: 'Vadesi geçenler' },
  { key: 'gider', label: 'Giderler', managerOnly: true },
  // Raporlar gider verisini de içerdiği için yalnızca kurum görünümüne açık.
  { key: 'rapor', label: 'Raporlar', managerOnly: true },
];

const STATUS_CLASS: Record<AccountingStatus, string> = {
  odendi: 'bg-emerald-100 text-emerald-800',
  bekliyor: 'bg-amber-100 text-amber-900',
  gecikti: 'bg-red-100 text-red-800',
};

const EMPTY_PLAN = {
  feeType: 'okul_kurs' as FeeType,
  paymentMethod: 'nakit' as PaymentMethod,
  studentName: '',
  className: '',
  total: '',
  installments: '1',
  firstDueDate: todayKey(),
  note: '',
};

const EMPTY_EXPENSE = {
  feeType: 'elektrik' as FeeType,
  /** Gider ödendi mi, henüz ödenmedi mi (fatura gelir ama sonra ödenir). */
  paid: 'odendi' as 'odendi' | 'bekliyor',
  paymentMethod: 'nakit' as PaymentMethod,
  title: '',
  amount: '',
  dueDate: todayKey(),
  note: '',
};

/** Vade bilgisini "3 gün kaldı" / "5 gün gecikti" biçiminde anlatır. */
function dueHint(entry: AccountingEntry): string {
  // Kısmi ödeme alan taksit "ödendi" sayılmaz; gecikme uyarısı bakiye
  // kapanmadığı sürece gösterilmeye devam eder.
  const status = settledStatus(entry);
  if (status === 'odendi') return '';
  const diff = daysUntilDue(entry.due_date);
  if (diff === null) return '';
  if (diff < 0) return `${Math.abs(diff)} gün gecikti`;
  if (diff === 0) return 'Bugün son gün';
  return `${diff} gün kaldı`;
}

function AccountingBody() {
  const { profile, school, user, role, can } = useSession();
  const manager = can('manage_accounting');

  /**
   * Muhasebe görünürlüğü iki farklı kapsamda çalışır:
   *
   * - Veli hesabı yalnızca kendisine bağlı öğrencinin ödeme planını, belgelerini
   *   ve sözleşmesini görür; kurumun diğer öğrencilerine ve giderlerine erişemez.
   * - Muhasebe yetkisi verilmiş kurum rolleri (yönetici, müdür yardımcısı olarak
   *   yetkilendirilmiş öğretmen/rehber vb.) kurum genelini görür. Yalnız
   *   `view_accounting` verilmişse kayıt ekleme/düzenleme kapalı kalır, yani
   *   salt okunur muhasebe erişimi mümkündür.
   *
   * Öğrenci rolü bu sayfaya hiç ulaşamaz: `view_accounting` ve
   * `manage_accounting` yetkileri o rol için sistem düzeyinde engellidir, bu
   * yüzden hem menüde hem sayfa korumasında bölüm görünmez.
   */
  const parentScope = role === 'veli' || role === 'ogrenci';
  // Kurum personeli görünümü: veli değil ve muhasebe okuma yetkisi var.
  const staffViewer = !parentScope && (manager || can('view_accounting'));
  // Kurum geneli veri görebilen kullanıcı.
  const fullScope = manager || staffViewer;

  const schoolId = Number(school?.id) || undefined;
  // Veli: kayıt defterindeki e-posta eşleşmesiyle bağlı öğrenciler bulunur.
  const linked = useLinkedStudents({
    email: user?.email,
    schoolId,
    fallbackName: profile?.student_name,
    enabled: !fullScope,
  });

  const [entries, setEntries] = useState<AccountingEntry[]>([]);
  // Ödeme planı formu, öğrenci kayıt defterindeki isim ve sınıfları kullanır.
  const [registry, setRegistry] = useState<StudentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<TabKey>('ozet');
  const [planForm, setPlanForm] = useState(EMPTY_PLAN);
  const [expenseForm, setExpenseForm] = useState(EMPTY_EXPENSE);
  /** Düzenlenen gider kaydının kimliği; boşsa form yeni kayıt açar. */
  const [editingExpense, setEditingExpense] = useState<number | null>(null);
  const [formMode, setFormMode] = useState<'kapali' | 'tahsilat' | 'gider'>('kapali');
  const [saving, setSaving] = useState(false);
  const [feeFilter, setFeeFilter] = useState<'hepsi' | FeeType>('hepsi');
  /* Ayrıntılı liste filtreleri */
  const [statusFilter, setStatusFilter] = useState<'' | AccountingStatus>('');
  const [methodFilter, setMethodFilter] = useState<'' | PaymentMethod>('');
  const [classFilter, setClassFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  // Kayıt defterinden `?ogrenci=Ad Soyad` ile gelindiğinde liste o öğrenciye odaklanır.
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('ogrenci') ?? '');
  // Makbuz / fatura kayıtları: dosyanın kendisi nesne deposunda, burada üst bilgisi tutulur.
  const [docs, setDocs] = useState<PaymentDocument[]>([]);
  // Listede oku basılan satır: o taksitin belgeleri açılır.
  const [openEntry, setOpenEntry] = useState<number | null>(null);
  // Öğrenci bazlı detay penceresi için seçilen öğrencinin anahtarı.
  const [detailKey, setDetailKey] = useState<string | null>(null);
  // Sözleşme penceresi için seçilen öğrencinin anahtarı (yeni sözleşme).
  const [contractKey, setContractKey] = useState<string | null>(null);
  // Düzenlenmek üzere açılan kayıtlı sözleşme.
  const [editingContract, setEditingContract] = useState<StudentContract | null>(null);
  const [openStudent, setOpenStudent] = useState<string | null>(null);
  // Sözleşmeler sekmesinde açılan öğrenci satırı.
  const [openContractStudent, setOpenContractStudent] = useState<string | null>(null);
  // Kurum arşivindeki sözleşme kayıtları.
  const [contracts, setContracts] = useState<StudentContract[]>([]);

  /*
    Gerçek tahsilat penceresi.
    "Ödendi" düğmesi yerine tutar/tarih/yöntem sorulur: kısmi ödemede ekranda
    kalan bakiye kalmalı, fazla ödeme ileri taksitlere dağıtılmalıdır. Tutarı
    sabit varsaymak bu iki davranışı imkânsız kılar.
  */
  const [payEntry, setPayEntry] = useState<AccountingEntry | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(todayKey());
  const [payMethod, setPayMethod] = useState<PaymentMethod>('nakit');
  const [payBusy, setPayBusy] = useState(false);

  /** Belge listesi ayrı yüklenir; belge eklenip silindiğinde tek başına yenilenir. */
  const loadDocs = async () => {
    try {
      setDocs(await fetchPaymentDocuments());
    } catch {
      setDocs([]);
    }
  };

  /** Sözleşme arşivi ayrı yüklenir; kaydetme sonrası tek başına yenilenir. */
  const loadContracts = async () => {
    try {
      setContracts(await fetchStudentContracts());
    } catch {
      setContracts([]);
    }
  };

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setEntries(await fetchAccounting());
    } catch (e) {
      const err = e as { data?: { detail?: string }; message?: string };
      setError(err?.data?.detail || err?.message || 'Muhasebe kayıtları yüklenemedi.');
    } finally {
      setLoading(false);
    }
    await loadDocs();
    await loadContracts();
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!manager) return;
    let alive = true;
    void fetchStudentRecords()
      .then((all) => {
        if (alive) setRegistry(scopeRecordsToSchool(all, schoolId));
      })
      .catch(() => {
        if (alive) setRegistry([]);
      });
    return () => {
      alive = false;
    };
  }, [manager, schoolId]);

  /** Kayıt defterindeki isim seçilince sınıf alanı otomatik dolar. */
  const applyRegistryStudent = (name: string) => {
    const match = registry.find((r) => studentNameKey(r.full_name) === studentNameKey(name));
    setPlanForm((prev) => ({
      ...prev,
      studentName: match ? match.full_name : name,
      className: match ? match.class_name : prev.className,
    }));
  };

  /** Kurum ayrımı: school_id yazılmamış eski kayıtlar da görünür kalır. */
  const scoped = useMemo(() => {
    const list = entries as (AccountingEntry & { school_id?: number })[];
    if (!schoolId) return list;
    return list.filter((e) => !e.school_id || Number(e.school_id) === schoolId);
  }, [entries, schoolId]);

  /** Veli yalnızca kendisine bağlı öğrencilerin tahsilat kayıtlarını görür. */
  const visible = useMemo(() => {
    if (fullScope) return scoped;
    return scoped.filter(
      (e) => e.entry_type === 'tahsilat' && linked.keys.has(studentNameKey(e.student_name)),
    );
  }, [scoped, fullScope, linked.keys]);

  const summary = useMemo(() => accountingSummary(visible), [visible]);
  const breakdown = useMemo(() => feeTypeBreakdown(visible), [visible]);

  /** Belgeler de kurum kapsamına indirilir; veli yalnız kendi öğrencisinin belgesini görür. */
  const visibleDocs = useMemo(() => {
    const scopedDocs = scopeDocsToSchool(docs, schoolId);
    if (fullScope) return scopedDocs;
    return scopedDocs.filter((d) => linked.keys.has(studentNameKey(d.student_name)));
  }, [docs, schoolId, fullScope, linked.keys]);

  const docMap = useMemo(() => docsByEntry(visibleDocs), [visibleDocs]);

  /** Öğrenci bazlı özet: tüm taksitler, tahsilat durumu ve belge sayısı bir arada. */
  const studentGroups = useMemo(
    () => groupPaymentsByStudent(visible, visibleDocs),
    [visible, visibleDocs],
  );

  const studentRows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR');
    if (!q) return studentGroups;
    return studentGroups.filter((g) =>
      [g.studentName, g.className].some((v) =>
        String(v || '').toLocaleLowerCase('tr-TR').includes(q),
      ),
    );
  }, [studentGroups, search]);

  const detailGroup = useMemo(
    () => studentGroups.find((g) => g.key === detailKey) ?? null,
    [studentGroups, detailKey],
  );

  /** Sözleşme penceresinde gösterilecek öğrenci ve kayıt defteri eşleşmesi. */
  const contractGroup = useMemo(
    () => studentGroups.find((g) => g.key === contractKey) ?? null,
    [studentGroups, contractKey],
  );

  /** Sözleşme penceresi hem yeni sözleşme hem kayıtlı sözleşme düzenleme için kullanılır. */
  const contractOpen = Boolean(contractGroup) || Boolean(editingContract);
  const contractStudentName =
    editingContract?.student_name || contractGroup?.studentName || '';
  const contractClassName = editingContract?.class_name || contractGroup?.className || '';

  const contractRecord = useMemo(() => {
    if (!contractStudentName) return null;
    const key = studentNameKey(contractStudentName);
    return registry.find((r) => studentNameKey(r.full_name) === key) ?? null;
  }, [contractStudentName, registry]);

  /**
   * Yeni sözleşmeye yazılacak taksit planı.
   * Muhasebe kayıtlarından üretilir; böylece sözleşmedeki ödeme planı tahsilat
   * takibiyle birebir aynı kalır. Kayıtlı sözleşme düzenlenirken sözleşme
   * anındaki plan korunur (pencere kendi kayıtlı planını kullanır).
   */
  const contractPlan = useMemo<ContractInstallment[]>(() => {
    /*
      Kayıtlı sözleşme düzenlenirken `contractGroup` boştur (pencere `contractKey`
      ile açılmamıştır). Bu durumda plan, sözleşmenin öğrenci anahtarından
      bulunur; aksi hâlde "Muhasebeden yenile" düğmesi hep boş plan görürdü.
    */
    const group =
      contractGroup ??
      (contractStudentName
        ? studentGroups.find((g) => g.key === studentNameKey(contractStudentName)) ?? null
        : null);
    if (!group) return [];
    return group.entries.map((entry) => ({
      title: `${entry.title} (${feeTypeLabel(entry.fee_type)})`,
      amount: Number(entry.amount) || 0,
      dueDate: entry.due_date,
      methodLabel: paymentMethodLabel(entry.payment_method),
    }));
  }, [contractGroup, contractStudentName, studentGroups]);

  /** Sözleşme kapsamı: kurum ayrımı + veli/öğrenci yalnız kendi sözleşmesini görür. */
  const visibleContracts = useMemo(() => {
    const scopedContracts = scopeContractsToSchool(contracts, schoolId);
    if (fullScope) return scopedContracts;
    return scopedContracts.filter((c) =>
      linked.keys.has(studentNameKey(c.student_name || '')),
    );
  }, [contracts, schoolId, fullScope, linked.keys]);

  /**
   * Sözleşmeler sekmesi satırları.
   * Ödeme kaydı olan her öğrenci listede görünür (sözleşmesi olmayanlar dâhil),
   * ayrıca ödeme kaydı silinmiş ama sözleşmesi arşivde kalan öğrenciler de eklenir.
   */
  const contractRows = useMemo(() => {
    const byStudent = contractsByStudent(visibleContracts);
    const list: {
      key: string;
      studentName: string;
      className: string;
      items: StudentContract[];
    }[] = studentGroups.map((g) => ({
      key: g.key,
      studentName: g.studentName,
      className: g.className,
      items: byStudent.get(g.key) ?? [],
    }));
    const seen = new Set(list.map((r) => r.key));
    for (const [key, items] of byStudent) {
      if (seen.has(key)) continue;
      list.push({
        key,
        studentName: items[0]?.student_name || 'İsimsiz kayıt',
        className: items[0]?.class_name || '',
        items,
      });
    }
    const q = search.trim().toLocaleLowerCase('tr-TR');
    const filtered = q
      ? list.filter((r) =>
          [r.studentName, r.className, ...r.items.map((i) => i.contract_no)].some((v) =>
            String(v || '').toLocaleLowerCase('tr-TR').includes(q),
          ),
        )
      : list;
    return filtered
      .slice()
      .sort((a, b) => a.studentName.localeCompare(b.studentName, 'tr-TR'));
  }, [visibleContracts, studentGroups, search]);

  /** Kayıtlı sözleşmeyi pencere açmadan doğrudan PDF olarak indirir. */
  const downloadContract = async (contract: StudentContract) => {
    try {
      const { blob, fileName } = await buildContractPdf({
        contractNo: contract.contract_no || '',
        contractDate: (contract.contract_date || todayKey()).slice(0, 10),
        academicYear: contract.academic_year || '',
        schoolName: contract.school_name || school?.name || 'Eğitim Kurumu',
        schoolMeta: school?.city || 'Eğitim ve öğretim hizmeti sözleşmesi',
        schoolAddress: contract.school_address,
        schoolPhone: contract.school_phone,
        schoolTaxNo: contract.school_tax_no,
        representativeName: contract.representative_name,
        representativeTitle: contract.representative_title,
        studentName: contract.student_name || '',
        className: contract.class_name,
        studentNo: contract.student_no,
        birthDate: contract.birth_date,
        studentTc: contract.student_tc,
        parentName: contract.parent_name,
        parentRelation: contract.parent_relation,
        parentTc: contract.parent_tc,
        parentPhone: contract.parent_phone,
        parentEmail: contract.parent_email,
        parentAddress: contract.parent_address,
        totalAmount: Number(contract.total_amount) || 0,
        discountAmount: Number(contract.discount_amount) || 0,
        discountNote: contract.discount_note,
        installments: parseInstallments(contract.installments_json),
        services: contract.services,
        extraNotes: contract.extra_notes,
        clauses: parseClauses(contract.clauses_json),
      });
      downloadBlob(blob, fileName);
      toast.success('Sözleşme indirildi', { description: fileName });
    } catch {
      toast.error('Sözleşme indirilemedi', { description: 'Lütfen tekrar deneyin.' });
    }
  };

  /** Sözleşme kaydını siler (yalnız yetkili kullanıcı). */
  const removeContract = async (contract: StudentContract) => {
    if (!window.confirm(`${contract.contract_no} numaralı sözleşme silinsin mi?`)) return;
    try {
      await deleteStudentContract(Number(contract.id));
      toast.success('Sözleşme silindi');
      await loadContracts();
    } catch {
      toast.error('Sözleşme silinemedi', { description: 'Lütfen tekrar deneyin.' });
    }
  };

  const rows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR');
    return visible
      .filter((e) => {
        if (tab === 'gider') return e.entry_type === 'gider';
        if (tab === 'ogrenci' || tab === 'sozlesme' || tab === 'mali' || tab === 'rapor') return false;
        if (e.entry_type !== 'tahsilat') return false;
        // Sekme kararı mahsup durumuna bağlıdır: yarısı ödenmiş bir taksit
        // "bekliyor" sekmesinde kalır (borç kapanmadı), ama gecikmişse
        // "gecikti"ye düşer. `effectiveStatus` mahsubu hiç görmediği için
        // kısmi ödemeyi "ödendi" sayıp alacağı listeden düşürürdü.
        const status = settledStatus(e);
        if (tab === 'odenen') return status === 'odendi';
        if (tab === 'bekleyen') return status === 'bekliyor';
        if (tab === 'geciken') return status === 'gecikti';
        return true;
      })
      .filter((e) => feeFilter === 'hepsi' || (e.fee_type || 'diger') === feeFilter)
      .filter((e) => {
        // Gider mahsup günlüğü taşımaz; durumu kaydın kendi alanından okunur.
        const status = e.entry_type === 'gider' ? effectiveStatus(e) : settledStatus(e);
        if (statusFilter && status !== statusFilter) return false;
        if (methodFilter && (e.payment_method || 'nakit') !== methodFilter) return false;
        if (classFilter && (e.class_name || '').trim() !== classFilter) return false;
        const day = (e.due_date || '').slice(0, 10);
        if (dateFrom && day < dateFrom) return false;
        if (dateTo && day > dateTo) return false;
        const amount = Number(e.amount) || 0;
        if (minAmount && amount < Number(minAmount)) return false;
        if (maxAmount && amount > Number(maxAmount)) return false;
        return true;
      })
      .filter((e) => {
        if (!q) return true;
        return [e.student_name, e.class_name, e.title, e.note]
          .filter(Boolean)
          .some((v) => String(v).toLocaleLowerCase('tr-TR').includes(q));
      })
      .sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));
  }, [
    visible,
    tab,
    feeFilter,
    search,
    statusFilter,
    methodFilter,
    classFilter,
    dateFrom,
    dateTo,
    minAmount,
    maxAmount,
  ]);

  const classOptions = useMemo(
    () =>
      [...new Set(visible.map((e) => (e.class_name || '').trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, 'tr'),
      ),
    [visible],
  );

  const anyFilter = Boolean(
    feeFilter !== 'hepsi' ||
      statusFilter ||
      methodFilter ||
      classFilter ||
      dateFrom ||
      dateTo ||
      minAmount ||
      maxAmount ||
      search,
  );

  const clearFilters = () => {
    setFeeFilter('hepsi');
    setStatusFilter('');
    setMethodFilter('');
    setClassFilter('');
    setDateFrom('');
    setDateTo('');
    setMinAmount('');
    setMaxAmount('');
    setSearch('');
  };

  /** Var olan gideri forma yükler (düzenleme modu). */
  const editExpense = (entry: AccountingEntry) => {
    setEditingExpense(Number(entry.id));
    setExpenseForm({
      feeType: (entry.fee_type || 'diger') as FeeType,
      paid: effectiveStatus(entry) === 'odendi' ? 'odendi' : 'bekliyor',
      paymentMethod: (entry.payment_method || 'nakit') as PaymentMethod,
      title: entry.title || '',
      amount: String(Number(entry.amount) || ''),
      dueDate: (entry.paid_date || entry.due_date || todayKey()).slice(0, 10),
      note: entry.note || '',
    });
    setFormMode('gider');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /** Gideri "ödendi" ↔ "ödenmedi" arasında çevirir. */
  const toggleExpensePaid = async (entry: AccountingEntry) => {
    const paid = effectiveStatus(entry) === 'odendi';
    const patch: Partial<AccountingEntry> = paid
      ? { status: 'bekliyor', paid_date: '' }
      : { status: 'odendi', paid_date: todayKey() };
    try {
      await updateAccountingEntry(entry.id, patch);
      setEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, ...patch } : x)));
      toast.success(paid ? 'Gider ödenmedi olarak işaretlendi.' : 'Gider ödendi olarak işaretlendi.');
    } catch (e) {
      toast.error(errorMessage(e, 'Gider durumu güncellenemedi.'));
    }
  };

  /** Taksit önizlemesi: kullanıcı kaydetmeden tutarları görsün. */
  const preview = useMemo(() => {
    const total = Number(planForm.total);
    const count = Number(planForm.installments);
    if (!Number.isFinite(total) || total <= 0) return [];
    if (!Number.isFinite(count) || count < 1) return [];
    return splitInstallments(total, Math.min(36, Math.floor(count)));
  }, [planForm.total, planForm.installments]);

  /**
   * Tahsilat penceresinin dağıtım önizlemesi.
   *
   * Önizleme **kaydetmeyle aynı fonksiyonla** üretilir (`applyPayment`). Ayrı bir
   * "bilgilendirme" hesabı yazılsaydı iki sonuç zamanla ayrışır ve kullanıcı
   * ekranda gördüğü dağıtımdan farklı bir kayıt oluştururdu.
   */
  const paymentPreview = useMemo(() => {
    if (!payEntry) return null;
    const amount = Number(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return applyPayment({
      entry: payEntry,
      all: visible,
      amount,
      date: payDate || todayKey(),
      method: payMethod,
    });
  }, [payEntry, payAmount, payDate, payMethod, visible]);

  /** Dağıtım satırını okunur etikete çevirir (kayıt kimliği → taksit adı). */
  const entryLabelOf = (entryId: number): string => {
    const found = visible.find((e) => Number(e.id) === entryId);
    if (!found) return `#${entryId}`;
    const parts = [found.title];
    if (found.installment_total && found.installment_total > 1) {
      parts.push(`${found.installment_no}/${found.installment_total}`);
    }
    parts.push(formatDateShort(found.due_date));
    return parts.filter(Boolean).join(' · ');
  };

  const submitPlan = async () => {
    const total = Number(planForm.total);
    const count = Math.floor(Number(planForm.installments));
    if (!planForm.studentName.trim()) {
      toast.error('Öğrenci adı gerekli.');
      return;
    }
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
        studentName: planForm.studentName,
        className: planForm.className,
        total,
        installments: count,
        firstDueDate: planForm.firstDueDate || todayKey(),
        note: planForm.note,
        schoolId,
      });
      setEntries((prev) => [...created, ...prev]);
      setPlanForm({ ...EMPTY_PLAN, feeType: planForm.feeType });
      toast.success(
        count > 1 ? `${count} taksit oluşturuldu.` : 'Ödeme kaydı oluşturuldu.',
      );
    } catch (e) {
      const err = e as { data?: { detail?: string }; message?: string };
      toast.error(err?.data?.detail || err?.message || 'Plan oluşturulamadı.');
    } finally {
      setSaving(false);
    }
  };

  const submitExpense = async () => {
    const amount = Number(expenseForm.amount);
    if (!expenseForm.title.trim()) {
      toast.error('Gider açıklaması gerekli.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Geçerli bir tutar girin.');
      return;
    }
    setSaving(true);
    try {
      const common = {
        fee_type: expenseForm.feeType,
        payment_method: expenseForm.paymentMethod,
        title: expenseForm.title.trim(),
        amount,
        status: expenseForm.paid,
        due_date: expenseForm.dueDate || todayKey(),
        paid_date: expenseForm.paid === 'odendi' ? expenseForm.dueDate || todayKey() : '',
        note: expenseForm.note.trim(),
      } satisfies Partial<AccountingEntry>;

      // Düzenleme ve yeni kayıt aynı alanları yazar; tek fark hedefin var olması.
      if (editingExpense) {
        const updated = await updateAccountingEntry(editingExpense, common);
        setEntries((prev) =>
          prev.map((x) => (Number(x.id) === editingExpense ? { ...x, ...updated, ...common } : x)),
        );
        setEditingExpense(null);
        setExpenseForm({ ...EMPTY_EXPENSE });
        setFormMode('kapali');
        toast.success('Gider güncellendi.');
        return;
      }

      const payload: Partial<AccountingEntry> & { school_id?: number } = {
        entry_type: 'gider',
        ...common,
      };
      if (schoolId) payload.school_id = schoolId;
      const created = await createAccountingEntry(payload);
      setEntries((prev) => [created, ...prev]);
      setExpenseForm({ ...EMPTY_EXPENSE });
      toast.success('Gider kaydedildi.');
    } catch (e) {
      const err = e as { data?: { detail?: string }; message?: string };
      toast.error(err?.data?.detail || err?.message || 'Gider eklenemedi.');
    } finally {
      setSaving(false);
    }
  };

  /**
   * Kayıt sunucuda yoksa (başka bir yerden silinmiş veya liste bayatlamış olabilir)
   * hata basmak yerine satırı listeden düşürüp güncel listeyi yeniden çekiyoruz.
   */
  const handleStaleRecord = async (id: number, message: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    toast.info(message);
    await load();
  };

  /**
   * Tahsilat penceresini açar.
   *
   * Tutar alanı **kalan bakiye** ile dolu gelir; taksitin tamamı görünen tutar
   * olsaydı yarısı ödenmiş bir taksitte ikinci kez tam tutar önerilir ve kullanıcı
   * farkında olmadan fazla tahsilat kaydederdi.
   */
  const openPayment = (entry: AccountingEntry) => {
    const state = settlementOf(entry);
    const suggested =
      state.remaining > MONEY_EPSILON ? state.remaining : Math.max(0, Number(entry.amount) || 0);
    setPayEntry(entry);
    setPayAmount(suggested > 0 ? String(Math.round(suggested * 100) / 100) : '');
    setPayDate(todayKey());
    setPayMethod((entry.payment_method as PaymentMethod) || 'nakit');
  };

  /**
   * Gerçek tahsilatı işler.
   *
   * Hangi taksite ne kadar yazılacağını mahsup katmanı hesaplar (kendi taksit →
   * en eski vadeli bekleyen taksitler → artık). Burada yalnızca o kayıtlar
   * sırayla sunucuya yazılır. Yazma sonrası liste **sunucudan yeniden okunur**:
   * güncellenen satırları yalnızca yerel yanıttan birleştirmek, sunucu `settle_log`
   * alanını düşürdüğünde ekranda doğru ama veritabanında eksik bir tahsilat
   * bırakırdı ve bu kusur yalnızca önbelleği temiz bir cihazda görünürdü.
   */
  const confirmPayment = async () => {
    if (!payEntry) return;
    const amount = Number(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Geçerli bir tahsilat tutarı girin.');
      return;
    }
    const result = applyPayment({
      entry: payEntry,
      all: visible,
      amount,
      date: payDate || todayKey(),
      method: payMethod,
    });
    if (!result.patches.length) {
      toast.error('Tahsil edilecek bakiye bulunamadı.');
      return;
    }
    setPayBusy(true);
    try {
      for (const item of result.patches) {
        await updateAccountingEntry(item.id, item.patch as Partial<AccountingEntry>);
      }
      setPayEntry(null);
      await load();
      const parts = [`${formatTry(result.applied)} tahsil edildi`];
      if (result.forwarded > MONEY_EPSILON) {
        parts.push(`${formatTry(result.forwarded)} sonraki taksitlere dağıtıldı`);
      }
      if (result.overflow > MONEY_EPSILON) {
        // Taksitlerin dışına taşan tutar sessizce yutulmaz; iade/avans olarak bildirilir.
        toast.warning(`${formatTry(result.overflow)} taksitlere sığmadı`, {
          description: 'Bu tutar avans/iade olarak duruyor; kayıt gerekebilir.',
        });
      }
      toast.success(parts.join(' · '));
    } catch (e) {
      if (isMissingRecordError(e)) {
        await handleStaleRecord(payEntry.id, 'Bu kayıt artık mevcut değil, liste yenilendi.');
        setPayEntry(null);
        return;
      }
      toast.error(errorMessage(e, 'Tahsilat kaydedilemedi.'));
      await load();
    } finally {
      setPayBusy(false);
    }
  };

  /**
   * Son tahsilat işlemini geri alır.
   *
   * İşlem kimliğiyle geri alma, kaydın **dokunduğu her taksiti** temizler.
   * Yalnızca açılan satırı sıfırlamak, önceki mahsubun ileri taksitlerde bıraktığı
   * tutarı orada bırakır ve kayıt diriltilmiş borç üretirdi. Kurum listesi eksikse
   * (sayfa hatası, kurum değişimi) geri alma yarım çalışacağı için önce
   * doğrulanır, eksikse işlem yapılmaz.
   */
  const undoPayment = async (entry: AccountingEntry) => {
    const state = settlementOf(entry);
    const last = state.records[state.records.length - 1];
    if (!last) {
      toast.info('Bu kayıtta geri alınacak tahsilat yok.');
      return;
    }
    const missing = missingRevertTargets(last.opId, visible);
    if (missing.length) {
      toast.error('Tahsilatın bir parçası listede görünmüyor', {
        description: 'Liste yenilendi, lütfen tekrar deneyin.',
      });
      await load();
      return;
    }
    try {
      for (const patch of revertPayment(last.opId, visible)) {
        await updateAccountingEntry(patch.id, patch.patch as Partial<AccountingEntry>);
      }
      await load();
      toast.success(`${formatTry(recordTotal(last))} geri alındı`);
    } catch (e) {
      toast.error(errorMessage(e, 'Tahsilat geri alınamadı.'));
      await load();
    }
  };

  const setMethod = async (entry: AccountingEntry, method: PaymentMethod) => {
    try {
      const updated = await updateAccountingEntry(entry.id, { payment_method: method });
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, ...updated } : e)));
    } catch (e) {
      if (isMissingRecordError(e)) {
        await handleStaleRecord(entry.id, 'Bu kayıt artık mevcut değil, liste yenilendi.');
        return;
      }
      toast.error(errorMessage(e, 'Ödeme yöntemi güncellenemedi.'));
    }
  };

  const remove = async (id: number) => {
    try {
      await deleteAccountingEntry(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
      toast.success('Kayıt silindi.');
    } catch (e) {
      if (isMissingRecordError(e)) {
        await handleStaleRecord(id, 'Kayıt zaten silinmiş, liste yenilendi.');
        return;
      }
      toast.error(errorMessage(e, 'Silinemedi.'));
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const cards = manager
    ? [
        { label: 'Toplam tahakkuk', value: summary.total, tone: 'text-primary', hint: '' },
        {
          label: 'Tahsil edilen',
          value: summary.collected,
          tone: 'text-emerald-700',
          hint: `${summary.paidCount} kayıt`,
        },
        {
          label: 'Bekleyen',
          value: summary.pending,
          tone: 'text-amber-700',
          hint: `${summary.pendingCount} taksit`,
        },
        {
          label: 'Vadesi geçen',
          value: summary.overdue,
          tone: 'text-red-700',
          hint: `${summary.overdueCount} taksit`,
        },
        { label: 'Giderler', value: summary.expense, tone: 'text-slate-700', hint: '' },
        { label: 'Net durum', value: summary.net, tone: 'text-primary', hint: '' },
      ]
    : [
        {
          label: 'Ödediğiniz',
          value: summary.collected,
          tone: 'text-emerald-700',
          hint: `${summary.paidCount} taksit`,
        },
        {
          label: 'Bekleyen ödeme',
          value: summary.pending,
          tone: 'text-amber-700',
          hint: `${summary.pendingCount} taksit`,
        },
        {
          label: 'Vadesi geçen',
          value: summary.overdue,
          tone: 'text-red-700',
          hint: `${summary.overdueCount} taksit`,
        },
      ];

  const tabs = TABS.filter((t) => manager || !t.managerOnly);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Wallet className="h-5 w-5" />
        </span>
        <div className="mr-auto">
          <h1 className="text-xl font-extrabold">Muhasebe</h1>
          <p className="text-xs text-muted-foreground">
            {manager
              ? 'Toplam tutar, taksit planı, ödeme türü ve tahsilat takibi.'
              : staffViewer
                ? 'Kurum tahsilat ve sözleşme kayıtları (salt okunur görünüm).'
                : `${linked.primaryName || profile?.student_name || 'Öğrenciniz'} için ödeme planı ve durumu.`}
          </p>
        </div>
        {manager && (
          <div className="no-print flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => setFormMode((v) => (v === 'tahsilat' ? 'kapali' : 'tahsilat'))}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Ödeme planı oluştur
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setFormMode((v) => (v === 'gider' ? 'kapali' : 'gider'))}
            >
              Gider ekle
            </Button>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm font-semibold text-destructive">
          {error}
        </div>
      )}

      {/* Tahsilat ve gider kalemleri Excel ile dışa/içe aktarılır. */}
      <ExcelToolbar
        className="no-print"
        compact
        fileName={`muhasebe-${new Date().toISOString().slice(0, 10)}`}
        buildSheets={() => [accountingExportSheet(scoped)]}
        canImport={manager}
        expectedHeaders={ACCOUNTING_HEADERS}
        templateSheetName="Muhasebe"
        templateHeaders={ACCOUNTING_HEADERS}
        onImport={(sheet) => importAccounting(sheet, scoped)}
        onImported={() => void load()}
      />

      {summary.overdueCount > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
          <p className="text-sm font-semibold text-red-800">
            {summary.overdueCount} taksitin vadesi geçmiş. Toplam {formatTry(summary.overdue)}{' '}
            tahsil edilmesi gerekiyor.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border bg-card p-4">
            <p className="text-xs font-semibold text-muted-foreground">{c.label}</p>
            <p className={`mt-1 text-lg font-extrabold tabular-nums ${c.tone}`}>
              {formatTry(c.value)}
            </p>
            {c.hint && <p className="text-[11px] text-muted-foreground">{c.hint}</p>}
          </div>
        ))}
      </div>

      {manager && formMode === 'tahsilat' && (
        <div className="space-y-3 rounded-2xl border bg-card p-4">
          <p className="text-sm font-extrabold">Ödeme planı oluştur</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Ödeme türü</Label>
              <select
                value={planForm.feeType}
                onChange={(e) =>
                  setPlanForm({ ...planForm, feeType: e.target.value as FeeType })
                }
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                {FEE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {FEE_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Toplam tutar (TL)</Label>
              <Input
                type="number"
                min="0"
                value={planForm.total}
                onChange={(e) => setPlanForm({ ...planForm, total: e.target.value })}
                placeholder="24000"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Taksit sayısı</Label>
              <Input
                type="number"
                min="1"
                max="36"
                value={planForm.installments}
                onChange={(e) => setPlanForm({ ...planForm, installments: e.target.value })}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Ödeme yöntemi</Label>
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
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Öğrenci</Label>
              <Input
                list="muhasebe-ogrenci-listesi"
                value={planForm.studentName}
                onChange={(e) => applyRegistryStudent(e.target.value)}
                placeholder="Ad Soyad"
                className="h-9"
              />
              <datalist id="muhasebe-ogrenci-listesi">
                {registry.map((r) => (
                  <option key={r.id} value={r.full_name}>
                    {r.class_name}
                  </option>
                ))}
              </datalist>
              <p className="text-[11px] text-muted-foreground">
                Kayıt defterindeki öğrenciler listeden seçilebilir; sınıf otomatik dolar.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Sınıf</Label>
              <Input
                value={planForm.className}
                onChange={(e) => setPlanForm({ ...planForm, className: e.target.value })}
                placeholder="8-A"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">İlk taksit vadesi</Label>
              <Input
                type="date"
                value={planForm.firstDueDate}
                onChange={(e) => setPlanForm({ ...planForm, firstDueDate: e.target.value })}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Not</Label>
              <Input
                value={planForm.note}
                onChange={(e) => setPlanForm({ ...planForm, note: e.target.value })}
                placeholder="Opsiyonel"
                className="h-9"
              />
            </div>
          </div>

          {preview.length > 0 && (
            <div className="rounded-xl border bg-muted/40 p-3">
              <p className="text-xs font-bold text-muted-foreground">
                Taksit önizlemesi ({preview.length} adet · ilk vade{' '}
                {formatDateShort(planForm.firstDueDate)})
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
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
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={submitPlan} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Planı kaydet
            </Button>
          </div>
        </div>
      )}

      {manager && formMode === 'gider' && (
        <div className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1.5">
            <Label className="text-xs">Gider türü</Label>
            <select
              value={expenseForm.feeType}
              onChange={(e) =>
                setExpenseForm({ ...expenseForm, feeType: e.target.value as FeeType })
              }
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            >
              {EXPENSE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {FEE_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Ödeme durumu</Label>
            <select
              value={expenseForm.paid}
              onChange={(e) =>
                setExpenseForm({ ...expenseForm, paid: e.target.value as 'odendi' | 'bekliyor' })
              }
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            >
              <option value="odendi">Ödeme yapıldı</option>
              <option value="bekliyor">Ödeme yapılmadı</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Açıklama</Label>
            <Input
              value={expenseForm.title}
              onChange={(e) => setExpenseForm({ ...expenseForm, title: e.target.value })}
              placeholder="Ekim elektrik faturası"
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Tutar (TL)</Label>
            <Input
              type="number"
              min="0"
              value={expenseForm.amount}
              onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })}
              placeholder="5200"
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Ödeme yöntemi</Label>
            <select
              value={expenseForm.paymentMethod}
              onChange={(e) =>
                setExpenseForm({ ...expenseForm, paymentMethod: e.target.value as PaymentMethod })
              }
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">
              {expenseForm.paid === 'odendi' ? 'Ödeme tarihi' : 'Son ödeme tarihi'}
            </Label>
            <Input
              type="date"
              value={expenseForm.dueDate}
              onChange={(e) => setExpenseForm({ ...expenseForm, dueDate: e.target.value })}
              className="h-9"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
            <Label className="text-xs">Not</Label>
            <Input
              value={expenseForm.note}
              onChange={(e) => setExpenseForm({ ...expenseForm, note: e.target.value })}
              placeholder="Opsiyonel"
              className="h-9"
            />
          </div>
          <div className="flex items-end">
            <div className="flex w-full gap-2">
              <Button onClick={submitExpense} disabled={saving} className="flex-1">
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {editingExpense ? 'Değişikliği kaydet' : 'Gideri kaydet'}
              </Button>
              {editingExpense && (
                <Button
                  variant="outline"
                  className="!bg-transparent"
                  onClick={() => {
                    setEditingExpense(null);
                    setExpenseForm({ ...EMPTY_EXPENSE });
                  }}
                >
                  Vazgeç
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {breakdown.length > 0 && (
        <CollapsibleSection
          title="Ödeme türüne göre kırılım"
          badge={`${breakdown.length} tür`}
          storageKey="accounting.breakdown"
          bodyClassName="px-0 py-0 overflow-x-auto"
        >
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-bold">Ödeme türü</th>
                <th className="px-3 py-2 text-right font-bold">Tahsil edilen</th>
                <th className="px-3 py-2 text-right font-bold">Bekleyen</th>
                <th className="px-3 py-2 text-right font-bold">Vadesi geçen</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map((row) => (
                <tr key={row.feeType} className="border-t">
                  <td className="px-3 py-2 font-semibold">{row.label}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
                    {formatTry(row.collected)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-amber-700">
                    {formatTry(row.pending)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-red-700">
                    {formatTry(row.overdue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CollapsibleSection>
      )}

      <div className="no-print flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1 rounded-lg border p-1">
          {tabs.map((t) => {
            const count =
              t.key === 'ogrenci'
                ? studentGroups.length
                : t.key === 'sozlesme'
                ? visibleContracts.length
                : t.key === 'odenen'
                ? summary.paidCount
                : t.key === 'bekleyen'
                  ? summary.pendingCount
                  : t.key === 'geciken'
                    ? summary.overdueCount
                    : null;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold transition-colors duration-150 ${
                  tab === t.key ? 'bg-primary text-primary-foreground' : 'hover:md:bg-accent'
                }`}
              >
                {t.key === 'ogrenci' && <Users className="h-3.5 w-3.5" />}
                {t.key === 'sozlesme' && <FileSignature className="h-3.5 w-3.5" />}
                {t.key === 'odenen' && <CheckCircle2 className="h-3.5 w-3.5" />}
                {t.key === 'bekleyen' && <Clock className="h-3.5 w-3.5" />}
                {t.key === 'geciken' && <AlertTriangle className="h-3.5 w-3.5" />}
                {t.label}
                {count !== null && count > 0 ? ` (${count})` : ''}
              </button>
            );
          })}
        </div>
        <select
          value={feeFilter}
          onChange={(e) => setFeeFilter(e.target.value as 'hepsi' | FeeType)}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="hepsi">{tab === 'gider' ? 'Tüm gider türleri' : 'Tüm ödeme türleri'}</option>
          {(tab === 'gider' ? EXPENSE_TYPES : FEE_TYPES).map((t) => (
            <option key={t} value={t}>
              {FEE_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        {manager && (
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tab === 'gider' ? 'Açıklama veya not ara' : 'Öğrenci veya açıklama ara'}
            className="h-9 w-full sm:w-56"
          />
        )}
      </div>

      {/* Ayrıntılı filtreler: tüm kayıt listelerine (tahsilat ve gider) uygulanır. */}
      {tab !== 'mali' && tab !== 'sozlesme' && tab !== 'rapor' && (
        <div className="no-print flex flex-wrap items-end gap-2 rounded-2xl border bg-card p-3">
          <div className="space-y-1">
            <Label className="text-[11px]">Durum</Label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as '' | AccountingStatus)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">Tümü</option>
              <option value="odendi">{tab === 'gider' ? 'Ödeme yapıldı' : 'Ödendi'}</option>
              <option value="bekliyor">{tab === 'gider' ? 'Ödeme yapılmadı' : 'Bekliyor'}</option>
              <option value="gecikti">Gecikti</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Ödeme yöntemi</Label>
            <select
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value as '' | PaymentMethod)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">Tümü</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
          {tab !== 'gider' && classOptions.length > 0 && (
            <div className="space-y-1">
              <Label className="text-[11px]">Sınıf</Label>
              <select
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value)}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="">Tümü</option>
                {classOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-[11px]">Tarih (başlangıç)</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 w-40" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Tarih (bitiş)</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 w-40" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">En az tutar</Label>
            <Input type="number" min="0" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} className="h-9 w-28" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">En çok tutar</Label>
            <Input type="number" min="0" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} className="h-9 w-28" />
          </div>
          {anyFilter && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Filtreleri temizle
            </Button>
          )}
        </div>
      )}

      {/* Mali özet: gelir–gider dengesi, net kâr, aylık gidişat ve kırılımlar. */}
      {tab === 'mali' && <FinanceSummary entries={visible} />}

      {/* Profesyonel raporlar: dönem seç → rapor seç → incele / Excel / yazdır. */}
      {tab === 'rapor' && <AccountingReports entries={visible} />}

      {/* Öğrenci bazlı liste: isim isim özet, ok ile taksit dökümü, "Detaylar" ile tam kart. */}
      {tab === 'ogrenci' && (
        <CollapsibleSection
          title="Öğrenci bazlı ödeme özeti"
          badge={`${studentRows.length} öğrenci`}
          storageKey="accounting.students"
          bodyClassName="px-0 py-0 overflow-x-auto"
        >
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="w-8 px-2 py-2" />
                <th className="px-3 py-2 text-left font-bold">Öğrenci</th>
                <th className="px-3 py-2 text-right font-bold">Toplam</th>
                <th className="px-3 py-2 text-right font-bold">Tahsil edilen</th>
                <th className="px-3 py-2 text-right font-bold">Bekleyen</th>
                <th className="px-3 py-2 text-right font-bold">Vadesi geçen</th>
                <th className="px-3 py-2 text-left font-bold">En yakın vade</th>
                <th className="px-3 py-2 text-left font-bold">Belge</th>
                <th className="px-3 py-2 text-left font-bold">Detay</th>
              </tr>
            </thead>
            <tbody>
              {studentRows.map((g) => {
                const open = openStudent === g.key;
                return (
                  <Fragment key={g.key}>
                    <tr className="border-t">
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          aria-label={open ? 'Dökümü kapat' : 'Dökümü aç'}
                          onClick={() => setOpenStudent(open ? null : g.key)}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md border hover:md:bg-accent"
                        >
                          {open ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-semibold">{g.studentName}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {g.className || '—'} · {g.entries.length} kalem
                        </p>
                      </td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums">
                        {formatTry(g.total)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
                        {formatTry(g.collected)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-amber-700">
                        {formatTry(g.pending)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-red-700">
                        {formatTry(g.overdue)}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {g.nextDueDate ? formatDateShort(g.nextDueDate) : 'Borç yok'}
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-muted-foreground">
                          <FileText className="h-3 w-3" />
                          {g.docs.length}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2"
                            onClick={() => setDetailKey(g.key)}
                          >
                            Detaylar
                          </Button>
                          {/* Sözleşme çıktısı: ikonlu ve vurgulu düğme, tabloda kolay bulunuyor. */}
                          <Button
                            size="sm"
                            className="h-7 gap-1 px-2"
                            title="Eğitim sözleşmesi PDF'i oluştur"
                            onClick={() => setContractKey(g.key)}
                          >
                            <FileSignature className="h-3.5 w-3.5" />
                            Sözleşme
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-t bg-muted/20">
                        <td colSpan={9} className="px-3 py-3">
                          <ul className="space-y-1.5">
                            {g.entries.map((entry) => {
                              // Öğrenci satırı da mahsup günlüğünden okur:
                              // tahsil edilen ve kalan tutar burada görünmezse
                              // kısmi ödeme yalnızca ana tabloda belli olur.
                              const status = settledStatus(entry);
                              const state = settlementOf(entry);
                              const entryDocs = docMap.get(entry.id) ?? [];
                              return (
                                <li
                                  key={entry.id}
                                  className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-2.5 py-2"
                                >
                                  <span className="text-xs font-bold">{entry.title}</span>
                                  <span className="text-[11px] text-muted-foreground">
                                    {feeTypeLabel(entry.fee_type)} ·{' '}
                                    {formatDateShort(entry.due_date)} ·{' '}
                                    {paymentMethodLabel(entry.payment_method)}
                                  </span>
                                  <span className="text-xs font-bold tabular-nums">
                                    {formatTry(Number(entry.amount) || 0)}
                                    {state.paid > MONEY_EPSILON && (
                                      <span className="ml-1 font-semibold text-emerald-700">
                                        (tahsil {formatTry(state.paid)})
                                      </span>
                                    )}
                                    {state.remaining > MONEY_EPSILON &&
                                      state.paid > MONEY_EPSILON && (
                                        <span className="ml-1 font-semibold text-amber-700">
                                          (kalan {formatTry(state.remaining)})
                                        </span>
                                      )}
                                  </span>
                                  <span
                                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_CLASS[status]}`}
                                  >
                                    {ACCOUNTING_STATUS_LABELS[status]}
                                  </span>
                                  <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-bold text-muted-foreground">
                                    <FileText className="h-3 w-3" />
                                    {entryDocs.length} belge
                                  </span>
                                </li>
                              );
                            })}
                            {!g.entries.length && (
                              <li className="text-[11px] text-muted-foreground">
                                Bu öğrenci için ödeme kaydı yok.
                              </li>
                            )}
                          </ul>
                          <p className="mt-2 text-[11px] text-muted-foreground">
                            Makbuz / fatura eklemek ve tüm belgeleri görmek için “Detaylar”a girin.
                          </p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {!studentRows.length && (
                <tr>
                  <td colSpan={9} className="px-3 py-10 text-center text-sm text-muted-foreground">
                    Öğrenci bazlı ödeme kaydı bulunamadı.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CollapsibleSection>
      )}

      {/* Sözleşmeler: her öğrenci için sözleşme arşivi, düzenleme ve PDF çıktısı. */}
      {tab === 'sozlesme' && (
        <CollapsibleSection
          title="Sözleşme arşivi"
          badge={`${visibleContracts.length} kayıt`}
          storageKey="accounting.contracts"
          bodyClassName="px-0 py-0 overflow-x-auto"
        >
          <table className="w-full min-w-[880px] text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="w-8 px-2 py-2" />
                <th className="px-3 py-2 text-left font-bold">Öğrenci</th>
                <th className="px-3 py-2 text-left font-bold">Son sözleşme no</th>
                <th className="px-3 py-2 text-left font-bold">Dönem</th>
                <th className="px-3 py-2 text-right font-bold">Net tutar</th>
                <th className="px-3 py-2 text-left font-bold">Durum</th>
                <th className="px-3 py-2 text-left font-bold">Sözleşme</th>
                <th className="px-3 py-2 text-left font-bold">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {contractRows.map((row) => {
                const open = openContractStudent === row.key;
                const latest = row.items[0] ?? null;
                const latestStatus = contractStatus(latest?.status);
                const latestNet = latest
                  ? Math.max(
                      0,
                      (Number(latest.total_amount) || 0) - (Number(latest.discount_amount) || 0),
                    )
                  : 0;
                return (
                  <Fragment key={row.key}>
                    <tr className="border-t">
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          aria-label={open ? 'Sözleşmeleri kapat' : 'Sözleşmeleri aç'}
                          onClick={() => setOpenContractStudent(open ? null : row.key)}
                          disabled={!row.items.length}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md border hover:md:bg-accent disabled:opacity-40"
                        >
                          {open ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-semibold">{row.studentName}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {row.className || '—'} · {row.items.length} sözleşme
                        </p>
                      </td>
                      <td className="px-3 py-2 tabular-nums">{latest?.contract_no || '—'}</td>
                      <td className="px-3 py-2">{latest?.academic_year || '—'}</td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums">
                        {latest ? formatTry(latestNet) : '—'}
                      </td>
                      <td className="px-3 py-2">
                        {latest ? (
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${CONTRACT_STATUS_CLASS[latestStatus]}`}
                          >
                            {CONTRACT_STATUS_LABELS[latestStatus]}
                          </span>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">
                            Sözleşme yok
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-muted-foreground">
                          <FileSignature className="h-3 w-3" />
                          {row.items.length}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {latest && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1 px-2"
                              title="Sözleşmeyi PDF olarak indir"
                              onClick={() => void downloadContract(latest)}
                            >
                              <FileText className="h-3.5 w-3.5" />
                              PDF
                            </Button>
                          )}
                          {manager && latest && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2"
                              title="Sözleşme maddelerini düzenle"
                              onClick={() => setEditingContract(latest)}
                            >
                              Düzenle
                            </Button>
                          )}
                          {manager && (
                            <Button
                              size="sm"
                              className="h-7 gap-1 px-2"
                              title="Yeni eğitim sözleşmesi oluştur"
                              onClick={() => setContractKey(row.key)}
                            >
                              <Plus className="h-3.5 w-3.5" />
                              Yeni
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-t bg-muted/20">
                        <td colSpan={8} className="px-3 py-3">
                          <ul className="space-y-1.5">
                            {row.items.map((item) => {
                              const itemStatus = contractStatus(item.status);
                              const itemNet = Math.max(
                                0,
                                (Number(item.total_amount) || 0) -
                                  (Number(item.discount_amount) || 0),
                              );
                              return (
                                <li
                                  key={item.id}
                                  className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-2.5 py-2"
                                >
                                  <span className="text-xs font-bold tabular-nums">
                                    {item.contract_no}
                                  </span>
                                  <span className="text-[11px] text-muted-foreground">
                                    {item.academic_year || '—'} ·{' '}
                                    {formatDateShort(item.contract_date)} · Veli:{' '}
                                    {item.parent_name || '—'}
                                  </span>
                                  <span className="text-xs font-bold tabular-nums">
                                    {formatTry(itemNet)}
                                  </span>
                                  <span
                                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${CONTRACT_STATUS_CLASS[itemStatus]}`}
                                  >
                                    {CONTRACT_STATUS_LABELS[itemStatus]}
                                  </span>
                                  <span className="ml-auto flex flex-wrap items-center gap-1.5">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 gap-1 px-2"
                                      onClick={() => void downloadContract(item)}
                                    >
                                      <FileText className="h-3.5 w-3.5" />
                                      PDF
                                    </Button>
                                    {manager && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 px-2"
                                        onClick={() => setEditingContract(item)}
                                      >
                                        Düzenle
                                      </Button>
                                    )}
                                    {manager && (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 px-2 text-red-600 hover:md:bg-red-50"
                                        title="Sözleşmeyi sil"
                                        onClick={() => void removeContract(item)}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    )}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {!contractRows.length && (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-sm text-muted-foreground">
                    Henüz öğrenci veya sözleşme kaydı yok.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CollapsibleSection>
      )}

      {/*
        NEDEN gizleme sarmalayıcı korunuyor: öğrenci/sözleşme sekmelerinde bu
        tablo çizilmemeli, ama katlama durumu sekme değişiminde sıfırlanmamalı.
      */}
      <div className={tab === 'ogrenci' || tab === 'sozlesme' ? 'hidden' : ''}>
        <CollapsibleSection
          title="Ödeme kalemleri"
          badge={`${rows.length} kayıt`}
          storageKey="accounting.entries"
          bodyClassName="px-0 py-0 overflow-x-auto"
        >
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="w-8 px-2 py-2" />
              <th className="px-3 py-2 text-left font-bold">Kalem</th>
              {tab !== 'gider' && <th className="px-3 py-2 text-left font-bold">Öğrenci</th>}
              <th className="px-3 py-2 text-left font-bold">Yöntem</th>
              <th className="px-3 py-2 text-right font-bold">Tutar</th>
              <th className="px-3 py-2 text-left font-bold">Vade</th>
              <th className="px-3 py-2 text-left font-bold">Durum</th>
              {tab !== 'gider' && <th className="px-3 py-2 text-left font-bold">Belge</th>}
              {manager && <th className="px-3 py-2 text-left font-bold">İşlem</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              // Rozet de mahsup durumundan gelir: `effectiveStatus` kısmi
              // ödemeyi yok sayar ve yarısı tahsil edilmiş taksit ekranda
              // "bekliyor/gecikti" görünürken bakiye hiç yazılmazdı.
              const status = e.entry_type === 'gider' ? effectiveStatus(e) : settledStatus(e);
              const state = settlementOf(e);
              const hint = dueHint(e);
              const entryDocs = docMap.get(e.id) ?? [];
              const open = openEntry === e.id;
              return (
                <Fragment key={e.id}>
                <tr className="border-t">
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      aria-label={open ? 'Belgeleri kapat' : 'Belgeleri aç'}
                      onClick={() => setOpenEntry(open ? null : e.id)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md border hover:md:bg-accent"
                    >
                      {open ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <p className="font-semibold">{e.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {feeTypeLabel(e.fee_type)}
                      {e.installment_total && e.installment_total > 1
                        ? ` · ${e.installment_no}/${e.installment_total} taksit`
                        : ''}
                      {e.plan_total ? ` · Plan: ${formatTry(Number(e.plan_total))}` : ''}
                    </p>
                    {e.note && <p className="text-[11px] text-muted-foreground">{e.note}</p>}
                  </td>
                  {tab !== 'gider' && (
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() =>
                          setDetailKey(studentNameKey(e.student_name) || 'bilinmeyen')
                        }
                        className="text-left font-medium underline-offset-2 hover:md:underline"
                      >
                        {e.student_name || '—'}
                      </button>
                      <p className="text-[11px] text-muted-foreground">{e.class_name || ''}</p>
                    </td>
                  )}
                  <td className="px-3 py-2">
                    {manager ? (
                      <select
                        value={e.payment_method || 'nakit'}
                        onChange={(ev) => setMethod(e, ev.target.value as PaymentMethod)}
                        className="h-8 rounded-md border bg-background px-1.5 text-xs"
                      >
                        {PAYMENT_METHODS.map((m) => (
                          <option key={m} value={m}>
                            {PAYMENT_METHOD_LABELS[m]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs font-semibold">
                        {paymentMethodLabel(e.payment_method)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums">
                    {formatTry(Number(e.amount) || 0)}
                    {state.paid > MONEY_EPSILON && (
                      <span className="block text-[11px] font-semibold text-emerald-700">
                        Tahsil: {formatTry(state.paid)}
                      </span>
                    )}
                    {state.remaining > MONEY_EPSILON && state.paid > MONEY_EPSILON && (
                      <span className="block text-[11px] font-semibold text-amber-700">
                        Kalan: {formatTry(state.remaining)}
                      </span>
                    )}
                    {state.overflow > MONEY_EPSILON && (
                      <span className="block text-[11px] font-semibold text-rose-700">
                        Fazla: {formatTry(state.overflow)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {formatDateShort(e.due_date)}
                    {hint && (
                      <span
                        className={`block text-[11px] font-semibold ${
                          status === 'gecikti' ? 'text-red-700' : 'text-muted-foreground'
                        }`}
                      >
                        {hint}
                      </span>
                    )}
                    {e.paid_date && (
                      <span className="block text-[11px] text-muted-foreground">
                        Ödeme: {formatDateShort(e.paid_date)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_CLASS[status]}`}
                    >
                      {e.entry_type === 'gider'
                        ? status === 'odendi'
                          ? 'Ödeme yapıldı'
                          : status === 'gecikti'
                            ? 'Ödenmedi · gecikti'
                            : 'Ödeme yapılmadı'
                        : ACCOUNTING_STATUS_LABELS[status]}
                    </span>
                    {e.entry_type === 'tahsilat' && state.paid > MONEY_EPSILON && state.remaining > MONEY_EPSILON && (
                      <span className="mt-1 block text-[11px] font-semibold text-muted-foreground">
                        Kısmi ödeme · {state.count} kayıt
                      </span>
                    )}
                  </td>
                  {tab !== 'gider' && (
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setOpenEntry(open ? null : e.id)}
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-muted-foreground"
                      >
                        <FileText className="h-3 w-3" />
                        {entryDocs.length}
                      </button>
                    </td>
                  )}
                  {manager && (
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {e.entry_type === 'tahsilat' &&
                          (settlementOf(e).remaining > MONEY_EPSILON ? (
                            <Button size="sm" variant="outline" onClick={() => openPayment(e)}>
                              Tahsilat gir
                            </Button>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => void undoPayment(e)}>
                              Geri al
                            </Button>
                          ))}
                        {e.entry_type === 'gider' && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => editExpense(e)}>
                              Düzenle
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => void toggleExpensePaid(e)}>
                              {status === 'odendi' ? 'Ödenmedi yap' : 'Ödendi işaretle'}
                            </Button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => remove(e.id)}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-destructive"
                        >
                          <Trash2 className="h-3 w-3" />
                          Sil
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
                {open && (
                  <tr className="border-t bg-muted/20">
                    <td colSpan={9} className="px-3 py-3">
                      <PaymentDocumentsPanel
                        docs={entryDocs}
                        allDocs={visibleDocs}
                        canManage={manager}
                        schoolId={schoolId}
                        schoolName={school?.name}
                        schoolMeta={school?.city || ''}
                        issuedBy={user?.email || profile?.full_name || ''}
                        onChanged={loadDocs}
                        title={`${e.title} · makbuz ve fatura`}
                        defaults={{
                          entryId: e.id,
                          planCode: e.plan_code,
                          studentName: e.student_name || '',
                          className: e.class_name || '',
                          amount: Number(e.amount) || undefined,
                          itemTitle: e.title,
                          feeTypeLabel: feeTypeLabel(e.fee_type),
                          installmentText:
                            e.installment_total && e.installment_total > 1
                              ? `${e.installment_no}/${e.installment_total}`
                              : undefined,
                          dueDate: e.due_date,
                          paidDate: e.paid_date,
                          methodLabel: paymentMethodLabel(e.payment_method),
                          planTotal: Number(e.plan_total) || undefined,
                        }}
                      />
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  {tab === 'geciken'
                    ? 'Vadesi geçen ödeme yok.'
                    : tab === 'bekleyen'
                      ? 'Bekleyen ödeme yok.'
                      : tab === 'odenen'
                        ? 'Henüz tahsil edilmiş ödeme yok.'
                        : 'Kayıt bulunamadı.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </CollapsibleSection>
      </div>

      {/* Gerçek tahsilat: tutar, tarih, yöntem ve dağıtım önizlemesi. */}
      <Dialog
        open={Boolean(payEntry)}
        onOpenChange={(next) => {
          if (!next) setPayEntry(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base font-extrabold">Tahsilat gir</DialogTitle>
            <DialogDescription className="text-xs">
              {payEntry
                ? `${payEntry.student_name || 'İsimsiz kayıt'} · ${payEntry.title}`
                : ''}
            </DialogDescription>
          </DialogHeader>

          {payEntry && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Taksit tutarı</Label>
                  <p className="text-sm font-bold tabular-nums">
                    {formatTry(Number(payEntry.amount) || 0)}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Kalan bakiye</Label>
                  <p className="text-sm font-bold tabular-nums text-amber-700">
                    {formatTry(settlementOf(payEntry).remaining)}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Tahsil edilen tutar (TL)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    className="h-9"
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Tahsilat tarihi</Label>
                  <Input
                    type="date"
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs">Ödeme yöntemi</Label>
                  <select
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {PAYMENT_METHOD_LABELS[m]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {paymentPreview && paymentPreview.lines.length > 0 && (
                <div className="rounded-xl border bg-muted/40 p-3">
                  <p className="text-xs font-bold text-muted-foreground">
                    Dağıtım önizlemesi ({paymentPreview.lines.length} taksit)
                  </p>
                  <ul className="mt-2 space-y-1">
                    {paymentPreview.lines.map((line) => (
                      <li
                        key={line.entryId}
                        className="flex flex-wrap items-center justify-between gap-2 text-[11px]"
                      >
                        <span className="font-semibold">{entryLabelOf(line.entryId)}</span>
                        <span className="font-bold tabular-nums">{formatTry(line.amount)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Kalan bakiyenin üzerindeki tutar en eski vadeli taksitlerden başlanarak
                    kapatılır.
                  </p>
                </div>
              )}

              {paymentPreview && paymentPreview.overflow > MONEY_EPSILON && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                  <p className="text-[11px] font-semibold text-amber-900">
                    {formatTry(paymentPreview.overflow)} hiçbir taksite sığmıyor. Bu tutar
                    kaydedilmez; avans/iade olarak ayrıca takip edilmelidir.
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setPayEntry(null)} disabled={payBusy}>
                  Vazgeç
                </Button>
                <Button onClick={() => void confirmPayment()} disabled={payBusy}>
                  {payBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Tahsilatı kaydet
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Öğrenci bazlı detay: tüm ödemeler, taksit dökümü ve belgeler tek kartta. */}
      <StudentPaymentDetail
        group={detailGroup}
        allDocs={visibleDocs}
        canManage={manager}
        schoolId={schoolId}
        schoolName={school?.name}
        schoolMeta={school?.city || ''}
        issuedBy={user?.email || profile?.full_name || ''}
        onClose={() => setDetailKey(null)}
        onChanged={loadDocs}
        onContract={(key) => setContractKey(key)}
      />

      {/* Öğrenci sözleşmesi: düzenlenebilir maddeler, imza alanları ve PDF çıktısı. */}
      <StudentContractDialog
        open={contractOpen}
        studentName={contractStudentName}
        className={contractClassName}
        record={contractRecord}
        planInstallments={contractPlan}
        contract={editingContract}
        allContracts={visibleContracts}
        canManage={manager}
        schoolId={schoolId}
        schoolName={school?.name}
        schoolMeta={school?.city || ''}
        issuedBy={profile?.full_name || user?.email || ''}
        onClose={() => {
          setContractKey(null);
          setEditingContract(null);
        }}
        onSaved={(saved) => {
          /*
            Kaydedilen kayıt pencereye geri bağlanır. Aksi hâlde "Kaydet"ten
            sonra pencere hâlâ "yeni sözleşme" modunda kalır ve ikinci kayıt
            aynı numarayla tekrar oluşturulmaya çalışılırdı.
          */
          setEditingContract(saved);
          setContractKey(null);
          void loadContracts();
        }}
      />

      <PageGuide storageKey="muhasebe" {...ACCOUNTING_GUIDE} />
    </div>
  );
}

export default function AccountingPage() {
  return (
    <SiteLayout anyPermission={['view_accounting', 'manage_accounting']}>
      <AccountingBody />
    </SiteLayout>
  );
}