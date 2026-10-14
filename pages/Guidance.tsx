/**
 * Rehberlik (360° öğrenci analizi) sayfası.
 *
 * Tek ekranda tüm kaynaklar birleşir:
 * - Ders programı (scheduler): öğrencinin sınıfının haftalık ve bugünkü ders saatleri
 * - Devamsızlık (`attendance_records`): katılım oranı, tam devamsız günler, üst üste seri
 * - Deneme sonuçları (kalıcı depodaki analiz veri kümesi): net gidişatı, ders bazlı düşüş
 * - Rehberlik kayıtları (`guidance_entries`): öğretmen gözlemi, veli görüşmesi, ölçek, disiplin
 * - Risk raporu (`risk_reports`): kural tabanlı erken uyarı + yapay zekâ değerlendirmesi
 *
 * Yetkiler: `view_guidance` görüntüleme, `manage_guidance` kayıt açma/güncelleme/silme
 * ve yapay zekâ risk analizi çalıştırma.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  ClipboardList,
  HeartHandshake,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import SiteLayout, { useSession } from '@/components/SiteLayout';
import CounselingPanel from '@/components/CounselingPanel';
import {
  canEnterCounseling,
  fetchCounselingAssignments,
  myStudentKeys,
  seesAllCounseling,
  type CounselingAssignment,
  type CounselingViewer,
} from '@/lib/counseling';
import PageGuide from '@/components/PageGuide';
// NEDEN: rehberlik panelleri de diğer modüllerle aynı ok ile açılır/kapanır davranışı taşısın.
import CollapsibleSection from '@/components/CollapsibleSection';
import TableFilter from '@/components/TableFilter';
import { GUIDANCE_GUIDE } from '@/lib/pageGuides';
import { client } from '@/lib/api';
import { errorMessage, formatDateShort } from '@/lib/site';
import { pullDataset, pullRecords, pullScheduler, pushRecords } from '@/lib/cloud';
import { loadDataset, type StudentRef } from '@/lib/store';
import { emptyRecords, loadRecords } from '@/lib/records';
/*
  Ödev modülü Rehberlik bölümüne taşındı: atama, durum, öğretmen görüşü, sonuç
  ve silme işlemleri karne ekranındaki panelle AYNI bileşenden yürür. İkinci bir
  kopya yazılsaydı "görüş yazılmadan ödev kapatılamaz" kuralı ile grup anahtarı
  iki ekranda ayrışır, aynı ödev raporda iki ayrı satır gibi görünürdü.
*/
import HomeworkPanel from '@/components/HomeworkPanel';
/** Ödev panelinin "eksik konudan hızlı ödev" listesi bu analizden beslenir. */
import { analyzeStudentExam } from '@/lib/analysis';
import { studentKeyOf } from '@/lib/text';
import {
  buildAssignmentRows,
  buildClassHomeworkRows,
  buildHomeworkOverview,
  buildStudentHomeworkRows,
  buildSubjectClassRows,
  buildSubjectRows,
  isHomeworkVisibleToTeacher,
  scopeHomework,
  type HomeworkStudentRef,
} from '@/lib/homeworkReports';
import HomeworkReports from '@/components/HomeworkReports';
import { fetchStudentRecords, scopeRecordsToSchool, type StudentRecord } from '@/lib/students';
import { emptySetup, loadSetup, syncSetup, type ExamSetupData } from '@/lib/examSetup';
import {
  classKey,
  defaultHistoryStartKey,
  fetchAttendanceForSchool,
  fetchAttendanceSessions,
  hasSchedule,
  listOccurrencesForDate,
  todayDateKey,
  type AttendanceRecord,
  type AttendanceSessionSummary,
} from '@/lib/attendance';
import {
  GUIDANCE_KINDS,
  GUIDANCE_KIND_LABELS,
  GUIDANCE_KIND_TONES,
  MOODS,
  MOOD_LABELS,
  RISK_LABELS,
  RISK_TONES,
  SEVERITIES,
  SEVERITY_LABELS,
  WARNING_RULES,
  buildClassReports,
  buildRiskPrompt,
  buildRiskProfiles,
  buildStudentReportRows,
  createGuidanceEntry,
  deleteGuidanceEntry,
  fetchGuidanceEntries,
  fetchRiskReports,
  filterProfiles,
  latestReportOf,
  parseAiRisk,
  riskOverview,
  saveRiskReport,
  todayKey,
  updateGuidanceEntry,
  type GuidanceEntry,
  type GuidanceInput,
  type GuidanceKind,
  type Mood,
  type RiskReport,
  type Severity,
  type StudentRiskProfile,
} from '@/lib/guidance';
import { ClassReportTable, StudentReportTable } from '@/components/GuidanceReports';
import type { ExamRecord, SchoolRecords } from '@/lib/types';

const AI_MODEL = 'gpt-5.6-sol';

/**
 * Rehberlik gövdesindeki görünümler.
 *
 * `danismanlik` ayrı bir görünümdür: veli/öğrenci hiç görmez (rol kapısı),
 * ama öğretmen, rehber öğretmen ve yönetici için bu sayfanın doğal parçasıdır.
 */
type GuidanceView = 'ogrenci' | 'raporlar' | 'odev' | 'danismanlik';

/* -------------------------------- Parçacıklar ------------------------------- */

function RiskChip({ level }: { level: StudentRiskProfile['level'] }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${RISK_TONES[level]}`}>
      {RISK_LABELS[level]}
    </span>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className={`rounded-xl px-3 py-2 ${tone}`}>
      <p className="text-[11px] font-bold uppercase tracking-wide opacity-80">{label}</p>
      <p className="text-xl font-extrabold tabular-nums">{value}</p>
    </div>
  );
}

function SectionCard({
  icon: Icon,
  title,
  action,
  children,
}: {
  icon: typeof CalendarDays;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  // NEDEN: tüm rehberlik panelleri tek yerden katlanır hale geldi; her panele
  // ayrı ayrı ok eklemek yerine ortak sarmalayıcı kullanılıyor.
  return (
    <CollapsibleSection
      title={title}
      icon={<Icon className="h-4 w-4" />}
      actions={action}
      storageKey={`guidance.${title}`}
    >
      {children}
    </CollapsibleSection>
  );
}

/** Haftanın (pazartesi başlangıçlı) tarih anahtarları. */
function weekDateKeys(dateKey: string): string[] {
  const base = new Date(`${dateKey}T00:00:00`);
  const shift = (base.getDay() + 6) % 7;
  const monday = new Date(base);
  monday.setDate(base.getDate() - shift);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

/* ------------------------------- Kayıt formu ------------------------------- */

interface FormState {
  kind: GuidanceKind;
  entry_date: string;
  title: string;
  detail: string;
  subject: string;
  scale_name: string;
  scale_score: string;
  scale_max: string;
  severity: Severity;
  action: string;
  follow_up_date: string;
  mood: Mood;
}

const emptyForm = (): FormState => ({
  kind: 'gorusme',
  entry_date: todayKey(),
  title: '',
  detail: '',
  subject: '',
  scale_name: '',
  scale_score: '',
  scale_max: '100',
  severity: 'orta',
  action: '',
  follow_up_date: '',
  mood: 'normal',
});

const formFromEntry = (entry: GuidanceEntry): FormState => ({
  kind: entry.kind,
  entry_date: (entry.entry_date ?? todayKey()).slice(0, 10),
  title: entry.title ?? '',
  detail: entry.detail ?? '',
  subject: entry.subject ?? '',
  scale_name: entry.scale_name ?? '',
  scale_score: entry.scale_score === undefined ? '' : String(entry.scale_score),
  scale_max: entry.scale_max === undefined ? '100' : String(entry.scale_max),
  severity: (SEVERITIES as readonly string[]).includes(entry.severity ?? '')
    ? (entry.severity as Severity)
    : 'orta',
  action: entry.action ?? '',
  follow_up_date: (entry.follow_up_date ?? '').slice(0, 10),
  mood: (MOODS as readonly string[]).includes(entry.mood ?? '') ? (entry.mood as Mood) : 'normal',
});

function EntryDialog({
  open,
  student,
  editing,
  onClose,
  onSaved,
  authorName,
  schoolId,
}: {
  open: boolean;
  student?: StudentRecord;
  editing?: GuidanceEntry;
  onClose: () => void;
  onSaved: () => Promise<void>;
  authorName?: string;
  schoolId?: number;
}) {
  const [form, setForm] = useState<FormState>(emptyForm());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(editing ? formFromEntry(editing) : emptyForm());
  }, [open, editing]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    if (!student) return;
    if (!form.title.trim()) {
      toast.error('Başlık girin.');
      return;
    }
    if (form.kind === 'olcek' && !Number(form.scale_max)) {
      toast.error('Ölçek için en yüksek puanı girin.');
      return;
    }
    const input: GuidanceInput = {
      student,
      kind: form.kind,
      entry_date: form.entry_date,
      title: form.title,
      detail: form.detail,
      subject: form.subject,
      scale_name: form.scale_name,
      scale_score: Number(form.scale_score) || 0,
      scale_max: Number(form.scale_max) || 100,
      severity: form.severity,
      action: form.action,
      follow_up_date: form.follow_up_date,
      mood: form.mood,
    };
    setBusy(true);
    try {
      if (editing) {
        await updateGuidanceEntry(editing.id, input, authorName, schoolId);
        toast.success('Kayıt güncellendi.');
      } else {
        await createGuidanceEntry(input, authorName, schoolId);
        toast.success('Rehberlik kaydı eklendi.');
      }
      await onSaved();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e, 'Rehberlik kaydı kaydedilemedi.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing ? 'Rehberlik kaydını düzenle' : 'Yeni rehberlik kaydı'}
            {student ? ` · ${student.full_name}` : ''}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Kayıt türü</Label>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={form.kind}
                onChange={(e) => set('kind', e.target.value as GuidanceKind)}
              >
                {GUIDANCE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {GUIDANCE_KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Tarih</Label>
              <Input
                type="date"
                value={form.entry_date}
                onChange={(e) => set('entry_date', e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Başlık</Label>
            <Input
              value={form.title}
              placeholder="Örn. Sınav kaygısı görüşmesi"
              onChange={(e) => set('title', e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Detay</Label>
            <Textarea
              rows={3}
              value={form.detail}
              placeholder="Görüşme / gözlem notları"
              onChange={(e) => set('detail', e.target.value)}
            />
          </div>

          {form.kind === 'gozlem' && (
            <div className="space-y-1.5">
              <Label>Ders (varsa)</Label>
              <Input
                value={form.subject}
                placeholder="Örn. Matematik"
                onChange={(e) => set('subject', e.target.value)}
              />
            </div>
          )}

          {form.kind === 'olcek' && (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-1">
                <Label>Ölçek adı</Label>
                <Input
                  value={form.scale_name}
                  placeholder="Sınav kaygısı"
                  onChange={(e) => set('scale_name', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Puan</Label>
                <Input
                  type="number"
                  value={form.scale_score}
                  onChange={(e) => set('scale_score', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>En yüksek</Label>
                <Input
                  type="number"
                  value={form.scale_max}
                  onChange={(e) => set('scale_max', e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Önem derecesi</Label>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={form.severity}
                onChange={(e) => set('severity', e.target.value as Severity)}
              >
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {SEVERITY_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Genel hâl</Label>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={form.mood}
                onChange={(e) => set('mood', e.target.value as Mood)}
              >
                {MOODS.map((m) => (
                  <option key={m} value={m}>
                    {MOOD_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Alınan aksiyon</Label>
              <Input
                value={form.action}
                placeholder="Örn. Veli bilgilendirildi"
                onChange={(e) => set('action', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Takip tarihi</Label>
              <Input
                type="date"
                value={form.follow_up_date}
                onChange={(e) => set('follow_up_date', e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------- Filtreler -------------------------------- */

/**
 * Arama / sınıf / uyarı filtreleri.
 *
 * Hem 360° görünümün yan panelinde hem raporlar sekmesinde aynı durum
 * kullanıldığı için tek bileşene alındı; iki yerde ayrı ayrı yazılsa
 * filtrelerden biri güncellendiğinde diğerinin geride kalma riski olurdu.
 */
function FilterControls({
  search,
  onSearch,
  className,
  onClassName,
  onlyRisky,
  onOnlyRisky,
  classNames,
  horizontal,
}: {
  search: string;
  onSearch: (value: string) => void;
  className: string;
  onClassName: (value: string) => void;
  onlyRisky: boolean;
  onOnlyRisky: (value: boolean) => void;
  classNames: string[];
  horizontal?: boolean;
}) {
  return (
    <div className={horizontal ? 'flex flex-wrap items-center gap-2' : 'space-y-2'}>
      <Input
        value={search}
        placeholder="Öğrenci ara"
        className={horizontal ? 'w-full sm:w-56' : undefined}
        onChange={(e) => onSearch(e.target.value)}
      />
      <select
        className={`h-10 rounded-md border bg-background px-3 text-sm ${
          horizontal ? 'w-full sm:w-48' : 'w-full'
        }`}
        value={className}
        onChange={(e) => onClassName(e.target.value)}
      >
        <option value="">Tüm sınıflar</option>
        {classNames.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input
          type="checkbox"
          checked={onlyRisky}
          onChange={(e) => onOnlyRisky(e.target.checked)}
        />
        Yalnızca uyarı alanlar
      </label>
    </div>
  );
}

/* --------------------------------- Gövde ---------------------------------- */

function GuidanceBody() {
  const { school, profile, can, user } = useSession();
  const schoolId = Number(school?.id) || undefined;
  const manage = can('manage_guidance');

  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  /*
    Ders saati özetleri katılım oranının tek doğru kaynağı: "geldi" satırı
    yazılmadığı için toplam ders saati yalnızca burada bulunur.
  */
  const [sessions, setSessions] = useState<AttendanceSessionSummary[]>([]);
  /*
    Sınav kurgusu: bir denemenin hangi sınav moduna (LGS / TYT / AYT / KPSS)
    ait olduğu yalnızca buradan çözülebilir. Net düşüşü kuralı mod ayrımını
    buna dayandırır.
  */
  const [setup, setSetup] = useState<ExamSetupData>(() => emptySetup());
  /** Gidişat grafiğinde gösterilen sınav modu (boşsa en çok denemesi olan). */
  const [seriesModeId, setSeriesModeId] = useState('');
  const [exams, setExams] = useState<ExamRecord[]>([]);
  const [entries, setEntries] = useState<GuidanceEntry[]>([]);
  const [reports, setReports] = useState<RiskReport[]>([]);
  const [scheduleReady, setScheduleReady] = useState(false);
  /** Hedef / ödev / rehberlik notu kayıtları (ödev raporlarının kaynağı). */
  const [schoolRecords, setSchoolRecords] = useState<SchoolRecords>(() => emptyRecords());
  /*
    Danışmanlık atamaları 360° görünümün ve ödev raporlarının kapsamını belirler:
    branş öğretmeni yalnızca kendi danışmanlığındaki öğrencileri görür. Liste
    burada yüklenir çünkü kapsam yalnızca "Danışmanlık" sekmesinde değil tüm
    sayfada geçerlidir.
  */
  const [assignments, setAssignments] = useState<CounselingAssignment[]>([]);

  const [search, setSearch] = useState('');
  const [className, setClassName] = useState('');
  const [onlyRisky, setOnlyRisky] = useState(false);
  const [selectedKey, setSelectedKey] = useState('');

  const [view, setView] = useState<GuidanceView>('ogrenci');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<GuidanceEntry | undefined>(undefined);
  const [aiBusy, setAiBusy] = useState(false);

  const reloadGuidance = useCallback(async () => {
    const [list, riskList] = await Promise.all([
      fetchGuidanceEntries(schoolId),
      fetchRiskReports(schoolId),
    ]);
    setEntries(list);
    setReports(riskList);
  }, [schoolId]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void (async () => {
      try {
        await pullScheduler();
        if (alive) setScheduleReady(hasSchedule());
        const historyFrom = defaultHistoryStartKey();
        const [
          records,
          attendanceRows,
          sessionRows,
          dataset,
          examSetup,
          list,
          riskList,
          recordBundle,
          assignmentRows,
        ] = await Promise.all([
          fetchStudentRecords(),
          fetchAttendanceForSchool(schoolId),
          // Devamsızlık satırlarıyla aynı aralık istenir; farklı aralık olsa
          // oran ile devamsız ders sayısı birbirini tutmazdı.
          fetchAttendanceSessions({ schoolId, from: historyFrom, to: todayDateKey() }),
          pullDataset(loadDataset()),
          syncSetup(loadSetup()),
          fetchGuidanceEntries(schoolId),
          fetchRiskReports(schoolId),
          /*
            Ödev kayıtları yerel depoda tutulur; kalıcı depoyla birleştirilerek
            okunur. Hata durumunda yerel kopyaya düşülür: bu istek reddedilirse
            `Promise.all` tüm rehberlik verisini iptal eder ve yalnızca ödev
            raporu değil 360° öğrenci görünümü de boş kalırdı.
          */
          pullRecords(loadRecords()).catch(() => loadRecords()),
          /*
            Danışmanlık atamaları kapsamı belirler. Hata durumunda boş listeye
            düşülür; istek `Promise.all` içinde reddedilseydi tüm rehberlik
            ekranı boş kalırdı. Boş liste güvenli taraftır: öğretmen fazladan
            öğrenci görmez, yalnızca kendi verdiği ödevler görünür.
          */
          fetchCounselingAssignments(schoolId).catch(() => [] as CounselingAssignment[]),
        ]);
        if (!alive) return;
        setAssignments(assignmentRows);
        setSchoolRecords(recordBundle);
        setStudents(
          scopeRecordsToSchool(records, schoolId).filter((r) => r.status !== 'ayrildi'),
        );
        setAttendance(attendanceRows);
        setSessions(sessionRows);
        setExams(dataset.exams ?? []);
        setSetup(examSetup);
        setEntries(list);
        setReports(riskList);
      } catch (e) {
        if (alive) toast.error(errorMessage(e, 'Rehberlik verileri yüklenemedi.'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [schoolId]);

  const allProfiles = useMemo(
    () => buildRiskProfiles({ students, attendance, exams, entries, sessions, setup }),
    [students, attendance, exams, entries, sessions, setup],
  );

  /*
    Danışmanlık bölümünün kapısı ekranda yeniden yazılmaz: karar
    `lib/counseling.ts` içindeki `canEnterCounseling` fonksiyonundan gelir.
    Böylece sekme listesi ile kayıt katmanı aynı kuralı kullanır ve veliye
    yanlışlıkla verilmiş bir yetki (ya da işaretlenmiş bir kutu) danışmanlık
    görüşlerini açmaz.
  */
  const counselingViewer = useMemo<CounselingViewer>(
    () => ({
      email: user?.email ?? '',
      role: profile?.role,
      canViewAll: can('view_all_counseling'),
      canAssign: can('manage_counseling'),
    }),
    [user, profile, can],
  );

  const showCounseling = canEnterCounseling(counselingViewer);

  /**
   * Öğretmenin danışmanlığındaki öğrenci anahtarları.
   *
   * NEDEN: branş öğretmeni rehberlikte sınıfın tamamını ya da tüm okulu değil
   * yalnızca kendi danışmanlığındaki öğrencileri görmelidir. Rehber öğretmen ve
   * yönetici (`seesAllCounseling`) kapsam dışıdır; kural rol kararına bağlı
   * olduğu için yanlışlıkla verilmiş bir yetki kapsamı genişletemez.
   */
  const myKeys = useMemo(
    () => new Set(myStudentKeys(counselingViewer, assignments)),
    [counselingViewer, assignments],
  );

  /** Kapsam daraltması uygulanacak mı? (yalnızca branş öğretmeni) */
  const limitedScope = showCounseling && !seesAllCounseling(counselingViewer);

  /*
    360° görünümün öğrenci havuzu. Süzme tek noktada yapılır; aksi hâlde
    filtreler, sayaçlar ve raporlar farklı havuzlardan beslenir ve başlıkta
    "12 öğrenci" yazarken listede 3 satır görünürdü.
  */
  const profiles = useMemo(
    () => (limitedScope ? allProfiles.filter((p) => myKeys.has(p.studentKey)) : allProfiles),
    [allProfiles, limitedScope, myKeys],
  );

  const overview = useMemo(() => riskOverview(profiles), [profiles]);

  const guidanceViews = useMemo(() => {
    const list: { key: GuidanceView; label: string }[] = [
      { key: 'ogrenci', label: 'Öğrenci kartı (360°)' },
      { key: 'raporlar', label: 'Sınıf ve öğrenci raporları' },
      { key: 'odev', label: 'Ödev raporları' },
    ];
    if (showCounseling) list.push({ key: 'danismanlik', label: 'Danışmanlık' });
    return list;
  }, [showCounseling]);

  /* Danışmanlık sekmesi kapandığında (rol değişimi, çıkış) görünüm geri alınır. */
  useEffect(() => {
    if (!showCounseling) setView((prev) => (prev === 'danismanlik' ? 'ogrenci' : prev));
  }, [showCounseling]);

  const classNames = useMemo(() => {
    const set = new Map<string, string>();
    students.forEach((s) => {
      if (s.class_name) set.set(classKey(s.class_name), s.class_name);
    });
    return [...set.values()].sort((a, b) => a.localeCompare(b, 'tr'));
  }, [students]);

  const visible = useMemo(
    () => filterProfiles(profiles, { className, search, onlyRisky }),
    [profiles, className, search, onlyRisky],
  );

  useEffect(() => {
    if (!visible.length) {
      setSelectedKey('');
      return;
    }
    if (!visible.some((p) => p.studentKey === selectedKey)) {
      setSelectedKey(visible[0].studentKey);
    }
  }, [visible, selectedKey]);

  const selected = visible.find((p) => p.studentKey === selectedKey);
  const report = selected ? latestReportOf(reports, selected.studentKey) : undefined;

  /**
   * Ödev panelinin kadrosu: sınıfa toplu atama hedefi kayıt defterinden gelir.
   *
   * Panel sınav listesini değil kayıt defterini kullanır; sınav listesi yalnızca
   * denemeye girmiş öğrencileri taşır, kayıt defteri sınıfın tamamını taşır.
   * Kayıt defterinden okunmazsa "sınıfın tamamına ata" seçeneği sınavı olmayan
   * öğrencileri sessizce atlar ve ödev eksik atanmış olurdu.
   */
  const roster = useMemo<StudentRef[]>(
    () =>
      students.map((record) => ({
        key: studentKeyOf(record.full_name),
        name: record.full_name,
        className: record.class_name,
        examCount: 0,
      })),
    [students],
  );

  /**
   * Ödev kaydının yazma kapısı: ekran ve kalıcı depo birlikte güncellenir.
   *
   * Yalnızca ekranı güncellemek, sayfa yenilendiğinde ödevin kaybolmasına yol
   * açardı; yazma başarısız olursa kullanıcı sessizce yanıltılmaz, uyarılır.
   */
  const handleRecordsChange = useCallback((next: SchoolRecords) => {
    setSchoolRecords(next);
    void pushRecords(next).then((ok) => {
      if (!ok) {
        toast.error('Ödev kaydı kalıcı depoya yazılamadı; değişiklik bu cihazda kaldı.');
      }
    });
  }, []);

  /**
   * Seçili öğrencinin son denemedeki eksik konuları.
   *
   * Deneme sırası eskiden yeniye doğru olduğu için geriye doğru taranır ve
   * öğrencinin katıldığı EN SON deneme seçilir; böylece ödev, güncel eksikliğe
   * göre atanır. Hiç denemesi olmayan öğrencide liste boş kalır — konu
   * uydurulmaz, öğretmen ödevi elle yazar.
   */
  const weakTopics = useMemo(() => {
    if (!selected) return [];
    for (let i = exams.length - 1; i >= 0; i -= 1) {
      const exam = exams[i];
      if (!exam.students.some((s) => studentKeyOf(s.name) === selected.studentKey)) continue;
      return analyzeStudentExam(exams, selected.studentKey, exam.key)?.weakTopics ?? [];
    }
    return [];
  }, [exams, selected]);

  /*
    Sınıf raporu bilinçli olarak yalnızca sınıf seçimini uygular; arama ve
    "yalnızca uyarı alanlar" filtreleri dışarıda bırakılır. Bu filtreler sınıf
    toplamına uygulansaydı öğrenci sayısı, katılım ortalaması ve risk dağılımı
    sınıfın tamamını değil filtrelenmiş alt kümeyi anlatır; tablo "sınıf raporu"
    adını taşıdığı hâlde sessizce yanlış bir tabloya dönüşürdü.
  */
  const classScoped = useMemo(
    () => filterProfiles(profiles, { className }),
    [profiles, className],
  );

  const classReports = useMemo(() => buildClassReports(classScoped), [classScoped]);

  /* Öğrenci raporu listeleme amaçlı olduğu için tüm filtreleri uygular. */
  const studentRows = useMemo(() => buildStudentReportRows(visible, reports), [visible, reports]);

  /*
    Ödev raporları.

    Ödev kaydında sınıf bilgisi yoktur, yalnızca `studentKey` vardır; sınıf ve
    ders kırılımları öğrenci kayıt defterinden gelen eşlemeyle üretilir. Sınıf
    seçimi yapılmadığında kayıt defterinde bulunamayan ödevler de kapsama
    alınır, aksi hâlde kurum toplamı sessizce eksik çıkardı.
  */
  const classRefs = useMemo<HomeworkStudentRef[]>(
    () =>
      classScoped.map((profile) => ({
        studentKey: profile.studentKey,
        studentName: profile.studentName,
        className: profile.className,
      })),
    [classScoped],
  );

  const visibleRefs = useMemo<HomeworkStudentRef[]>(
    () =>
      visible.map((profile) => ({
        studentKey: profile.studentKey,
        studentName: profile.studentName,
        className: profile.className,
      })),
    [visible],
  );

  /*
    Ödev havuzu öğretmen kapsamına indirilir: kendi verdiği ödevler VEYA kendi
    danışmanlığındaki öğrencilerin ödevleri. Süzme rapor üretiminden ÖNCE
    yapılır; sonradan süzülseydi özet sayaçları geniş havuzdan hesaplanır ve
    başlıkta "24 ödev" yazarken tabloda 3 satır görünürdü.
  */
  const homeworkPool = useMemo(() => {
    const all = schoolRecords.homework ?? [];
    if (!limitedScope) return all;
    return all.filter((item) =>
      isHomeworkVisibleToTeacher(item, { email: user?.email, studentKeys: myKeys }),
    );
  }, [schoolRecords, limitedScope, user, myKeys]);

  const homeworkScoped = useMemo(
    () => scopeHomework(homeworkPool, classRefs, { includeUnmatched: !className }),
    [homeworkPool, classRefs, className],
  );

  /* Öğrenci tablosu arama ve "yalnızca uyarı alanlar" filtrelerine uyar. */
  const homeworkStudentScoped = useMemo(
    () => scopeHomework(homeworkPool, visibleRefs),
    [homeworkPool, visibleRefs],
  );

  const homeworkOverview = useMemo(() => buildHomeworkOverview(homeworkScoped), [homeworkScoped]);
  const homeworkSubjectRows = useMemo(() => buildSubjectRows(homeworkScoped), [homeworkScoped]);
  const homeworkClassRows = useMemo(() => buildClassHomeworkRows(homeworkScoped), [homeworkScoped]);
  const homeworkSubjectClassRows = useMemo(
    () => buildSubjectClassRows(homeworkScoped),
    [homeworkScoped],
  );
  const homeworkAssignmentRows = useMemo(() => buildAssignmentRows(homeworkScoped), [homeworkScoped]);
  const homeworkStudentRows = useMemo(
    () => buildStudentHomeworkRows(homeworkStudentScoped),
    [homeworkStudentScoped],
  );

  /*
    Ödev raporu filtreleri.

    NEDEN ayrı durum: soldaki 360° filtreleri "hangi öğrencinin kartı açılacak"
    sorusunu yanıtlar ve "yalnızca uyarı alanlar" gibi risk odaklı bir ölçüt
    taşır. Ödev raporunda aynı duruma bağlansaydı risk filtresi açıkken ödev
    tabloları sessizce yalnızca uyarılı öğrencilerin ödevlerini gösterir ve
    başlıktaki toplam ile tablo birbirini tutmazdı.

    NEDEN sınıf listesi rapor satırlarından türetiliyor: kayıt defterinden
    türetilseydi branş öğretmeninin göremediği sınıflar açılır listede görünür
    ve kapsam dışı sınıf adları sızardı.
  */
  const [hwClass, setHwClass] = useState('');
  const [hwSearch, setHwSearch] = useState('');

  const hwClassNames = useMemo(() => {
    const set = new Set<string>();
    homeworkStudentRows.forEach((row) => {
      const name = (row.className ?? '').trim();
      if (name) set.add(name);
    });
    return [...set].sort((a, b) => a.localeCompare(b, 'tr'));
  }, [homeworkStudentRows]);

  /** Seçili sınıf listeden kalkarsa tablo sessizce boş kalmamalı. */
  useEffect(() => {
    if (hwClass && !hwClassNames.includes(hwClass)) setHwClass('');
  }, [hwClass, hwClassNames]);

  /** Sınıf seçimi tüm ödev tablolarına uygulanır (kapsam daraltma). */
  const homeworkFiltered = useMemo(
    () => (hwClass ? homeworkScoped.filter((row) => row.className === hwClass) : homeworkScoped),
    [homeworkScoped, hwClass],
  );

  const hwOverview = useMemo(() => buildHomeworkOverview(homeworkFiltered), [homeworkFiltered]);
  const hwSubjectRows = useMemo(() => buildSubjectRows(homeworkFiltered), [homeworkFiltered]);
  const hwClassRows = useMemo(() => buildClassHomeworkRows(homeworkFiltered), [homeworkFiltered]);
  const hwSubjectClassRows = useMemo(
    () => buildSubjectClassRows(homeworkFiltered),
    [homeworkFiltered],
  );
  const hwAssignmentRows = useMemo(() => buildAssignmentRows(homeworkFiltered), [homeworkFiltered]);

  /*
    Öğrenci araması yalnızca ÖĞRENCİ tablosuna uygulanır; ders, sınıf ve
    verilen ödev tabloları sınıf/kurum toplamını anlatır, arama oraya da
    işleseydi "sınıf raporu" adını taşıyan tablo tek öğrencinin sayılarını
    gösterirdi.
  */
  const hwStudentRowsFiltered = useMemo(() => {
    const q = hwSearch.trim().toLocaleLowerCase('tr');
    return homeworkStudentRows.filter((row) => {
      if (hwClass && (row.className ?? '').trim() !== hwClass) return false;
      if (q && !(row.studentName ?? '').toLocaleLowerCase('tr').includes(q)) return false;
      return true;
    });
  }, [homeworkStudentRows, hwClass, hwSearch]);

  /** Öğrencinin sınıfına ait bugünkü ve haftalık ders saatleri. */
  const lessons = useMemo(() => {
    if (!selected || !scheduleReady) return { weekly: 0, today: [] as string[] };
    const target = classKey(selected.className);
    const today = listOccurrencesForDate(todayDateKey())
      .filter((o) => classKey(o.className) === target)
      .map((o) => `${o.startTime} ${o.lessonName}`);
    const weekly = weekDateKeys(todayDateKey()).reduce(
      (sum, date) =>
        sum + listOccurrencesForDate(date).filter((o) => classKey(o.className) === target).length,
      0,
    );
    return { weekly, today };
  }, [selected, scheduleReady]);

  /*
    Gidişat tek bir sınav modu içinde çizilir. Farklı modların toplam netleri
    aynı grafikte birleştirilirse (LGS 90 net → TYT 45 net) düz bir düşüş
    çizgisi görünür; oysa öğrenci gerileme yaşamamıştır, yalnızca sınav türü
    değişmiştir.
  */
  const activeSeries = useMemo(() => {
    const series = selected?.modeSeries ?? [];
    if (!series.length) return undefined;
    return series.find((s) => s.modeId === seriesModeId) ?? series[0];
  }, [selected, seriesModeId]);

  const chartData = useMemo(
    () =>
      (activeSeries?.points ?? [])
        .filter((p) => p.net !== undefined)
        .map((p) => ({ name: p.examName, net: p.net as number })),
    [activeSeries],
  );

  const removeEntry = async (entry: GuidanceEntry) => {
    if (!window.confirm('Bu rehberlik kaydı silinsin mi?')) return;
    try {
      await deleteGuidanceEntry(entry.id);
      await reloadGuidance();
      toast.success('Kayıt silindi.');
    } catch (e) {
      toast.error(errorMessage(e, 'Kayıt silinemedi.'));
    }
  };

  /** Yapay zekâ risk analizi: 360° özet gönderilir, doğrulanan sonuç kalıcı kaydedilir. */
  const runAiRisk = async () => {
    if (!selected) return;
    const prompt = buildRiskPrompt(selected, lessons);
    const schema =
      'Yanıtı SADECE geçerli JSON olarak ver: {"risk_level":"dusuk|orta|yuksek|kritik",' +
      '"summary":"3-5 cümle Türkçe değerlendirme","actions":["somut rehberlik aksiyonu", "..."]}';
    setAiBusy(true);
    try {
      const ask = async (extra?: string) => {
        const response = await client.ai.gentxt({
          messages: [
            {
              role: 'system',
              content: `Sen bir okul rehber öğretmenine destek veren uzman psikolojik danışmansın. ${schema}`,
            },
            { role: 'user', content: extra ? `${extra}\n\n${prompt}` : prompt },
          ],
          model: AI_MODEL,
          stream: false,
        });
        return String(response?.data?.content ?? '');
      };

      let raw = await ask();
      let parsed;
      try {
        parsed = parseAiRisk(raw, selected.level);
      } catch {
        raw = await ask('Önceki yanıt geçersizdi. Yalnızca istenen JSON şemasını döndür.');
        parsed = parseAiRisk(raw, selected.level);
      }

      const saved = await saveRiskReport({
        school_id: schoolId,
        student_key: selected.studentKey,
        student_name: selected.studentName,
        class_name: selected.className,
        risk_level: parsed.level,
        risk_score: selected.score,
        signals: selected.signals.map((s) => `${s.label}: ${s.detail}`).join(' | '),
        summary: parsed.summary,
        actions: parsed.actions.join('\n'),
        model_name: AI_MODEL,
        author_name: profile?.full_name ?? '',
      });
      setReports((prev) => [saved, ...prev]);
      toast.success('Risk analizi oluşturuldu ve kaydedildi.');
    } catch (e) {
      toast.error(errorMessage(e, 'Risk analizi tamamlanamadı.'));
    } finally {
      setAiBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <HeartHandshake className="h-5 w-5 text-primary" />
        <h1 className="mr-auto text-xl font-extrabold">Rehberlik · 360° öğrenci analizi</h1>
        <span className="rounded-full border px-2.5 py-1 text-[11px] font-bold">
          {overview.flagged}/{overview.total} öğrencide uyarı
        </span>
      </div>

      {/* Görünüm seçimi: 360° kart, raporlar, ödev raporları ve danışmanlık */}
      <div className="flex flex-wrap gap-1.5">
        {guidanceViews.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setView(item.key)}
            className={`rounded-full border px-3 py-1.5 text-[12px] font-bold transition ${
              view === item.key
                ? 'border-primary bg-primary/10 text-primary'
                : 'hover:border-primary/40'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Erken uyarı özeti */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard
          label="Öğrenci"
          value={String(overview.total)}
          tone="bg-muted text-foreground"
        />
        <MetricCard
          label="Uyarılı"
          value={String(overview.flagged)}
          tone="bg-amber-100 text-amber-900"
        />
        <MetricCard
          label="Kritik"
          value={String(overview.counts.kritik)}
          tone="bg-red-100 text-red-800"
        />
        <MetricCard
          label="Yüksek"
          value={String(overview.counts.yuksek)}
          tone="bg-amber-100 text-amber-800"
        />
        <MetricCard
          label="Orta"
          value={String(overview.counts.orta)}
          tone="bg-blue-100 text-blue-800"
        />
        <MetricCard
          label="Düşük"
          value={String(overview.counts.dusuk)}
          tone="bg-emerald-100 text-emerald-800"
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {(Object.keys(WARNING_RULES) as (keyof typeof WARNING_RULES)[]).map((code) => (
          <div key={code} className="rounded-xl border bg-card px-3 py-2">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              {WARNING_RULES[code].label}
            </p>
            <p className="text-lg font-extrabold tabular-nums">{overview.byRule[code]}</p>
            <p className="text-[11px] text-muted-foreground">{WARNING_RULES[code].rule}</p>
          </div>
        ))}
      </div>

      {view === 'danismanlik' ? (
        <CounselingPanel
          schoolId={schoolId}
          students={students}
          profile={profile}
          role={profile?.role}
          email={user?.email}
          can={can}
        />
      ) : view === 'ogrenci' ? (
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* Erken uyarı listesi */}
        <aside className="space-y-3">
          <div className="rounded-2xl border bg-card p-3">
            <FilterControls
              search={search}
              onSearch={setSearch}
              className={className}
              onClassName={setClassName}
              onlyRisky={onlyRisky}
              onOnlyRisky={setOnlyRisky}
              classNames={classNames}
            />
          </div>

          <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
            {visible.length === 0 && (
              <p className="rounded-2xl border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
                Ölçütlere uyan öğrenci yok.
              </p>
            )}
            {visible.map((p) => (
              <button
                key={p.studentKey}
                type="button"
                onClick={() => setSelectedKey(p.studentKey)}
                className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                  p.studentKey === selectedKey
                    ? 'border-primary bg-primary/5'
                    : 'hover:border-primary/40'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="mr-auto text-sm font-bold">{p.studentName}</span>
                  <RiskChip level={p.level} />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {p.className || 'Sınıf yok'} · risk {p.score}/100 · {p.signals.length} uyarı
                </p>
              </button>
            ))}
          </div>
        </aside>

        {/* 360° tek ekran */}
        {!selected ? (
          <div className="rounded-2xl border border-dashed px-4 py-16 text-center text-sm text-muted-foreground">
            Soldaki listeden bir öğrenci seçin.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card px-4 py-3">
              <div className="mr-auto">
                <p className="text-lg font-extrabold">{selected.studentName}</p>
                <p className="text-[11px] text-muted-foreground">
                  {selected.className || 'Sınıf yok'} · risk puanı {selected.score}/100
                </p>
              </div>
              <RiskChip level={selected.level} />
              {manage && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditing(undefined);
                      setDialogOpen(true);
                    }}
                  >
                    <Plus className="mr-1.5 h-4 w-4" />
                    Kayıt ekle
                  </Button>
                  <Button size="sm" onClick={runAiRisk} disabled={aiBusy}>
                    {aiBusy ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="mr-1.5 h-4 w-4" />
                    )}
                    Yapay zekâ risk analizi
                  </Button>
                </>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {/*
                Katılım ve üst üste gün, ders saati özeti olmadan hesaplanamaz.
                Bu durumda sayı yerine "—" gösterilir; %0 yazmak öğrenciyi hiç
                derse girmemiş gibi gösterirdi.
              */}
              <MetricCard
                label="Katılım"
                value={selected.attendanceExact ? `%${selected.attendanceRate}` : '—'}
                tone="bg-primary/10 text-primary"
              />
              <MetricCard
                label="Devamsız ders"
                value={String(selected.absentLessons)}
                tone="bg-red-100 text-red-800"
              />
              <MetricCard
                label="Üst üste gün"
                value={selected.attendanceExact ? String(selected.longestStreak) : '—'}
                tone="bg-amber-100 text-amber-900"
              />
              <MetricCard
                label="Deneme"
                value={String(selected.examPoints.length)}
                tone="bg-muted text-foreground"
              />
            </div>

            <SectionCard icon={AlertTriangle} title="Erken uyarı sinyalleri">
              {selected.signals.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Tanımlı kuralların hiçbiri tetiklenmedi.
                </p>
              ) : (
                <ul className="space-y-2">
                  {selected.signals.map((s) => (
                    <li
                      key={s.code}
                      className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 px-3 py-2"
                    >
                      <span className="text-sm font-bold text-amber-900">{s.label}</span>
                      <span className="mr-auto text-[12px] text-amber-800">{s.detail}</span>
                      <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-bold text-amber-900">
                        +{s.weight}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            {/*
              Ödev modülü Rehberlik bölümüne taşındı. Karne ekranıyla AYNI
              bileşen kullanılır; burada açık başlar (karne içinde kapalı),
              çünkü bu ekranın işi öğrenci takibidir ve ödev o takibin parçasıdır.
              Kapanış kuralı (görüş yazılmadan ödev kapatılamaz) ve grup anahtarı
              ortak katmandan geldiği için iki ekran ayrışmaz.
            */}
            <HomeworkPanel
              records={schoolRecords}
              onChange={handleRecordsChange}
              studentKey={selected.studentKey}
              studentName={selected.studentName}
              className={selected.className}
              roster={roster}
              weakTopics={weakTopics}
              defaultOpen
              visibleFilter={
                limitedScope
                  ? (item) =>
                      isHomeworkVisibleToTeacher(item, {
                        email: user?.email,
                        studentKeys: myKeys,
                      })
                  : undefined
              }
            />

            <div className="grid gap-4 lg:grid-cols-2">
              <SectionCard icon={CalendarDays} title="Ders programı">
                {!scheduleReady ? (
                  <p className="text-sm text-muted-foreground">
                    Kurum için ders programı henüz oluşturulmamış.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm">
                      Haftalık ders saati:{' '}
                      <span className="font-extrabold tabular-nums">{lessons.weekly}</span>
                    </p>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      Bugün
                    </p>
                    {lessons.today.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Bugün ders yok.</p>
                    ) : (
                      <ul className="flex flex-wrap gap-1.5">
                        {lessons.today.map((item) => (
                          <li
                            key={item}
                            className="rounded-full border px-2.5 py-1 text-[11px] font-semibold"
                          >
                            {item}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </SectionCard>

              <SectionCard icon={ClipboardList} title="Devamsızlık">
                <div className="space-y-1.5 text-sm">
                  <p>
                    Devamsız ders:{' '}
                    <span className="font-bold tabular-nums text-red-700">
                      {selected.absentLessons}
                    </span>{' '}
                    · geç gelme:{' '}
                    <span className="font-bold tabular-nums">{selected.lateLessons}</span>
                  </p>
                  {selected.attendanceExact ? (
                    <>
                      <p>
                        İşlenen ders saati:{' '}
                        <span className="font-bold tabular-nums">{selected.lessonCount}</span>
                      </p>
                      <p>
                        Tam devamsız gün:{' '}
                        <span className="font-bold tabular-nums">{selected.absentDays.length}</span>
                      </p>
                      {selected.streakDates.length > 0 && (
                        <p className="text-[12px] text-muted-foreground">
                          En uzun seri: {selected.streakDates.map(formatDateShort).join(' → ')}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-[12px] text-muted-foreground">
                      Bu sınıfta henüz yoklama alınmadığı için katılım oranı, tam devamsız gün ve
                      üst üste devamsızlık hesaplanamıyor. Yoklama alındıkça bu bölüm dolar.
                    </p>
                  )}
                </div>
              </SectionCard>
            </div>

            <SectionCard icon={RefreshCw} title="Deneme gidişatı">
              {/*
                Mod seçimi: öğrenci birden fazla sınav türüne girdiyse her tür
                kendi grafiğinde gösterilir, netler karıştırılmaz.
              */}
              {selected.modeSeries.length > 1 && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {selected.modeSeries.map((group) => (
                    <button
                      key={group.modeId}
                      type="button"
                      onClick={() => setSeriesModeId(group.modeId)}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition ${
                        group.modeId === activeSeries?.modeId
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'hover:border-primary/40'
                      }`}
                    >
                      {group.modeLabel} ({group.points.length})
                    </button>
                  ))}
                </div>
              )}
              {chartData.length < 2 ? (
                <p className="text-sm text-muted-foreground">
                  {activeSeries
                    ? `${activeSeries.modeLabel} modunda gidişat için en az iki deneme sonucu gerekiyor.`
                    : 'Gidişat için en az iki deneme sonucu gerekiyor.'}
                </p>
              ) : (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: -16 }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <ChartTooltip />
                      <Line
                        type="monotone"
                        dataKey="net"
                        name={
                          activeSeries?.modeLabel
                            ? `Toplam net · ${activeSeries.modeLabel}`
                            : 'Toplam net'
                        }
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
              {selected.subjectDrops.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {selected.subjectDrops.map((d) => (
                    <li
                      key={d.subject}
                      className="rounded-full bg-red-100 px-2.5 py-1 text-[11px] font-bold text-red-800"
                    >
                      {d.subject}: {d.previous} → {d.current} ({d.delta})
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            <SectionCard
              icon={HeartHandshake}
              title="Rehberlik kayıtları"
              action={
                manage ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditing(undefined);
                      setDialogOpen(true);
                    }}
                  >
                    <Plus className="mr-1.5 h-4 w-4" />
                    Ekle
                  </Button>
                ) : undefined
              }
            >
              {selected.entries.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Bu öğrenci için gözlem, veli görüşmesi, ölçek veya disiplin kaydı yok.
                </p>
              ) : (
                <ul className="space-y-2">
                  {selected.entries.map((entry) => (
                    <li key={entry.id} className="rounded-xl border px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                            GUIDANCE_KIND_TONES[entry.kind]
                          }`}
                        >
                          {GUIDANCE_KIND_LABELS[entry.kind]}
                        </span>
                        <span className="mr-auto text-sm font-bold">{entry.title}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {formatDateShort(entry.entry_date)}
                        </span>
                        {manage && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => {
                                setEditing(entry);
                                setDialogOpen(true);
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-red-600"
                              onClick={() => void removeEntry(entry)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                      {entry.detail && <p className="mt-1 text-[12px]">{entry.detail}</p>}
                      <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                        {entry.kind === 'olcek' && (
                          <span>
                            {entry.scale_name || 'Ölçek'}: {entry.scale_score ?? '—'}/
                            {entry.scale_max ?? '—'}
                          </span>
                        )}
                        {entry.subject && <span>Ders: {entry.subject}</span>}
                        {entry.action && <span>Aksiyon: {entry.action}</span>}
                        {entry.follow_up_date && (
                          <span>Takip: {formatDateShort(entry.follow_up_date)}</span>
                        )}
                        {entry.author_name && <span>Kaydeden: {entry.author_name}</span>}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            <SectionCard icon={Sparkles} title="Yapay zekâ risk değerlendirmesi">
              {!report ? (
                <p className="text-sm text-muted-foreground">
                  Henüz risk analizi yapılmadı.
                  {manage ? ' Üstteki butonla analiz çalıştırabilirsiniz.' : ''}
                </p>
              ) : (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <RiskChip level={report.risk_level} />
                    <span className="text-[11px] text-muted-foreground">
                      {report.created_at ? formatDateShort(report.created_at) : ''}
                      {report.author_name ? ` · ${report.author_name}` : ''}
                    </span>
                  </div>
                  <p className="whitespace-pre-line text-sm">{report.summary}</p>
                  {report.actions && (
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                        Önerilen aksiyonlar
                      </p>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                        {report.actions
                          .split('\n')
                          .filter(Boolean)
                          .map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </SectionCard>
          </div>
        )}
      </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl border bg-card p-3">
            <FilterControls
              search={search}
              onSearch={setSearch}
              className={className}
              onClassName={setClassName}
              onlyRisky={onlyRisky}
              onOnlyRisky={setOnlyRisky}
              classNames={classNames}
              horizontal
            />
          </div>
          {view === 'raporlar' ? (
            <>
              <TableFilter placeholder="Sınıf raporunda ara">
                <ClassReportTable reports={classReports} />
              </TableFilter>
              <TableFilter placeholder="Öğrenci raporunda ara">
                <StudentReportTable
                  rows={studentRows}
                  onSelect={(key) => {
                    setSelectedKey(key);
                    setView('ogrenci');
                  }}
                />
              </TableFilter>
            </>
          ) : (
            <div className="space-y-4">
              {/*
                Ödev raporlarının kendi sınıf/öğrenci filtreleri: üstteki
                360° filtreleri risk odaklıdır, burada ise kapsam daraltılır.
              */}
              <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card p-3">
                <Input
                  value={hwSearch}
                  placeholder="Öğrenci ara"
                  className="w-full sm:w-56"
                  onChange={(e) => setHwSearch(e.target.value)}
                />
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm sm:w-48"
                  value={hwClass}
                  onChange={(e) => setHwClass(e.target.value)}
                >
                  <option value="">Tüm sınıflar</option>
                  {hwClassNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <span className="text-[11px] text-muted-foreground">
                  {hwStudentRowsFiltered.length}/{homeworkStudentRows.length} öğrenci · öğrenci
                  araması yalnızca öğrenci tablosuna uygulanır
                </span>
                {(hwClass || hwSearch) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setHwClass('');
                      setHwSearch('');
                    }}
                  >
                    Filtreleri temizle
                  </Button>
                )}
              </div>

              <HomeworkReports
                overview={hwOverview}
                subjectRows={hwSubjectRows}
                classRows={hwClassRows}
                subjectClassRows={hwSubjectClassRows}
                assignmentRows={hwAssignmentRows}
                studentRows={hwStudentRowsFiltered}
                onSelect={(key) => {
                  setSelectedKey(key);
                  setView('ogrenci');
                }}
              />
            </div>
          )}
        </div>
      )}

      <EntryDialog
        open={dialogOpen}
        student={selected?.record}
        editing={editing}
        onClose={() => {
          setDialogOpen(false);
          setEditing(undefined);
        }}
        onSaved={reloadGuidance}
        authorName={profile?.full_name}
        schoolId={schoolId}
      />

      <PageGuide storageKey="rehberlik" {...GUIDANCE_GUIDE} />
    </div>
  );
}

function GuidanceGate() {
  const { can } = useSession();
  if (!can('view_guidance') && !can('manage_guidance')) {
    return (
      <div className="rounded-2xl border border-dashed bg-card px-4 py-16 text-center">
        <p className="text-sm text-muted-foreground">
          Rehberlik ekranını görüntüleme yetkiniz yok. Kurum yöneticinizden “Rehberlik” yetkisi
          talep edebilirsiniz.
        </p>
      </div>
    );
  }
  return <GuidanceBody />;
}

export default function GuidancePage() {
  return (
    <SiteLayout requireAuth wide>
      <GuidanceGate />
    </SiteLayout>
  );
}