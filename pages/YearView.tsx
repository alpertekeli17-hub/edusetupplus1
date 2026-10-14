/**
 * Yıllık görünüm sayfası.
 *
 * Analiz paneli bilinçli olarak tembel yükleme yapar: açılışta yalnızca son
 * denemelerin kırılımı indirilir. Bu doğru bir varsayılan, ama "bir öğrencinin
 * ya da sınıfın tüm yılı" sorusunu karşılamaz — tüm yılı tarayıcıda kurmak
 * geçmişin tamamını indirmek demektir ve ölçümde bu veri kümesi belleği
 * taşırıyordu.
 *
 * Bu sayfa aynı soruyu sunucu tarafında özetlenmiş veriyle çözer:
 * `/exam-store/student-year` ve `/exam-store/class-year` uçları taramayı
 * veritabanında yapar, istemciye yalnızca sınav başına birkaç sayı ile yıl boyu
 * birikimli ders/konu tablosu gelir. Böylece tüm yıl tek istekte görünür.
 *
 * Yetki:
 * - `view_school`: kurumdaki her öğrenci ve her sınıf.
 * - Veli / öğrenci: yalnızca kendisine (çocuğuna) bağlı öğrenciler; sınıf
 *   görünümü kapalıdır.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarRange,
  Filter,
  GraduationCap,
  Loader2,
  Minus,
  RotateCcw,
  Search,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import SiteLayout, { useSession } from '@/components/SiteLayout';
import PageGuide from '@/components/PageGuide';
import { YEAR_VIEW_GUIDE } from '@/lib/pageGuides';
import { useLinkedStudents } from '@/hooks/use-linked-students';
import { errorMessage } from '@/lib/site';
import { studentNameKey } from '@/lib/students';
import {
  ALL_MODES,
  filterExamsByMode,
  modeOptionsOf,
} from '@/lib/analysisModes';
import { emptySetup, loadSetup, syncSetup, type ExamSetupData } from '@/lib/examSetup';
import {
  fetchClassYear,
  fetchExamHeaders,
  fetchStudentYear,
  fetchYearRoster,
  type ClassYearSummary,
  type ExamHeader,
  type StudentYearSummary,
  type YearFilterMeta,
  type YearFilters,
  type YearRosterClass,
  type YearRosterStudent,
  type YearSubjectRow,
  type YearTopicRow,
} from '@/lib/examStore';
import type { ExamRecord } from '@/lib/types';

type Mode = 'student' | 'class';

/** Konu tablosunda ilk açılışta gösterilen satır sayısı. */
const TOPIC_PREVIEW = 15;

function num(value?: number | null, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toFixed(digits).replace(/\.00$/, '');
}

function intOf(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return String(Math.round(value));
}

function dateLabel(value?: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/* --------------------------------- Parçalar -------------------------------- */

function StatCard({
  label,
  value,
  hint,
  tone = 'bg-muted text-foreground',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className={`rounded-xl px-3 py-2 ${tone}`}>
      <p className="text-[11px] font-bold uppercase tracking-wide opacity-80">{label}</p>
      <p className="text-xl font-extrabold tabular-nums">{value}</p>
      {hint && <p className="text-[11px] opacity-80">{hint}</p>}
    </div>
  );
}

function ChangeBadge({ value }: { value?: number | null }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (value > 0) {
    return (
      <span className="inline-flex items-center gap-1 font-bold text-emerald-700">
        <ArrowUpRight className="h-3.5 w-3.5" />+{num(value)}
      </span>
    );
  }
  if (value < 0) {
    return (
      <span className="inline-flex items-center gap-1 font-bold text-red-700">
        <ArrowDownRight className="h-3.5 w-3.5" />
        {num(value)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 font-bold text-muted-foreground">
      <Minus className="h-3.5 w-3.5" />0
    </span>
  );
}

/** Başarı yüzdesini yatay çubukla gösterir (grafik kütüphanesi gerekmeden). */
function PercentBar({ percent }: { percent: number }) {
  const width = Math.max(0, Math.min(100, percent));
  const tone =
    width < 50 ? 'bg-red-500' : width < 70 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${tone}`} style={{ width: `${width}%` }} />
      </div>
      <span className="tabular-nums font-semibold">%{num(percent, 1)}</span>
    </div>
  );
}

function SubjectTable({ rows }: { rows: YearSubjectRow[] }) {
  if (!rows.length) return null;
  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <div className="border-b px-4 py-3">
        <p className="text-sm font-extrabold">Yıl boyu ders tablosu</p>
        <p className="text-[11px] text-muted-foreground">
          Tüm denemelerin toplamı; ortalama net sınav başına hesaplanır.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-bold">Ders</th>
              <th className="px-3 py-2 text-right font-bold">Sınav</th>
              <th className="px-3 py-2 text-right font-bold">Doğru</th>
              <th className="px-3 py-2 text-right font-bold">Yanlış</th>
              <th className="px-3 py-2 text-right font-bold">Boş</th>
              <th className="px-3 py-2 text-right font-bold">Toplam net</th>
              <th className="px-3 py-2 text-right font-bold">Ort. net</th>
              <th className="px-3 py-2 text-left font-bold">Başarı</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.subject} className="border-t">
                <td className="px-3 py-2 font-semibold">{row.subject}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.examCount}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.correct}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.wrong}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.blank}</td>
                <td className="px-3 py-2 text-right tabular-nums font-bold">{num(row.net)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{num(row.avgNet)}</td>
                <td className="px-3 py-2">
                  <PercentBar percent={row.percent} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TopicTable({ rows, title }: { rows: YearTopicRow[]; title: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, TOPIC_PREVIEW);
  if (!rows.length) return null;
  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <p className="text-sm font-extrabold">{title}</p>
          <p className="text-[11px] text-muted-foreground">
            Yıl boyunca sorulan tüm sorular birleştirildi; en zayıf konu başta.
          </p>
        </div>
        {rows.length > TOPIC_PREVIEW && (
          <Button variant="outline" size="sm" onClick={() => setAll((v) => !v)}>
            {all ? 'Yalnızca en zayıf konular' : `Tümünü göster (${rows.length})`}
          </Button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-bold">Ders</th>
              <th className="px-3 py-2 text-left font-bold">Konu</th>
              <th className="px-3 py-2 text-right font-bold">Soru</th>
              <th className="px-3 py-2 text-right font-bold">Doğru</th>
              <th className="px-3 py-2 text-right font-bold">Yanlış</th>
              <th className="px-3 py-2 text-right font-bold">Boş</th>
              <th className="px-3 py-2 text-right font-bold">Sınav</th>
              <th className="px-3 py-2 text-left font-bold">Başarı</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={`${row.subject}|${row.group}|${row.topic}`} className="border-t">
                <td className="px-3 py-2 font-semibold">{row.subject}</td>
                <td className="px-3 py-2">
                  {row.topic}
                  {row.group && (
                    <span className="block text-[11px] text-muted-foreground">{row.group}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{row.questions}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.correct}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.wrong}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.blank}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.examCount}</td>
                <td className="px-3 py-2">
                  <PercentBar percent={row.percent} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Sunucunun gerçekten uyguladığı kapsamı gösterir.
 *
 * Filtre sunucuda çalıştığı için ekranda "hangi denemeler toplandı" bilgisini
 * kullanıcıya açıkça söylemek gerekir; aksi halde daralan tablolar veri kaybı
 * gibi görünür. Tarihi boş olan denemeler tarih aralığı verildiğinde bilinçli
 * olarak dışarıda bırakılır ve sayısı burada bildirilir.
 */
function FilterNotice({ meta }: { meta?: YearFilterMeta }) {
  if (!meta) return null;
  const ranged = Boolean(meta.dateFrom || meta.dateTo);
  if (!ranged && !meta.modeFiltered) return null;

  return (
    <p className="rounded-xl border bg-muted/50 px-3 py-2 text-[12px] font-semibold text-muted-foreground">
      Seçili kapsamda <strong className="text-foreground">{meta.matchedExams}</strong> deneme
      toplandı (kayıtlı {meta.availableExams} deneme arasından).
      {meta.skippedUndated > 0 && (
        <span className="text-amber-700">
          {' '}
          {meta.skippedUndated} denemenin tarihi boş olduğu için tarih aralığına dahil edilmedi.
        </span>
      )}
    </p>
  );
}

/* ------------------------------ Öğrenci görünümü ---------------------------- */

function StudentYearPanel({ data }: { data: StudentYearSummary }) {
  const { totals, exams } = data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Sınav" value={intOf(totals.examCount)} />
        <StatCard
          label="Ortalama net"
          value={num(totals.avgNet)}
          tone="bg-primary/10 text-primary"
        />
        <StatCard label="En iyi net" value={num(totals.bestNet)} tone="bg-emerald-100 text-emerald-800" />
        <StatCard label="En düşük net" value={num(totals.worstNet)} tone="bg-red-100 text-red-800" />
        <StatCard label="Ortalama puan" value={num(totals.avgScore)} />
        <StatCard
          label="İlk → son"
          value={totals.netChange === null || totals.netChange === undefined ? '—' : num(totals.netChange)}
          hint={
            totals.firstNet !== null && totals.firstNet !== undefined
              ? `${num(totals.firstNet)} → ${num(totals.lastNet)}`
              : undefined
          }
          tone="bg-blue-100 text-blue-800"
        />
      </div>

      <div className="overflow-hidden rounded-2xl border bg-card">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-extrabold">Yıl boyunca girilen tüm denemeler</p>
          <p className="text-[11px] text-muted-foreground">
            {exams.length} deneme · sınav başına net, puan, sıralamalar ve başarı yüzdesi.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-bold">Deneme</th>
                <th className="px-3 py-2 text-left font-bold">Tarih</th>
                <th className="px-3 py-2 text-right font-bold">Net</th>
                <th className="px-3 py-2 text-right font-bold">Puan</th>
                <th className="px-3 py-2 text-right font-bold">Genel sıra</th>
                <th className="px-3 py-2 text-right font-bold">Sınıf sıra</th>
                <th className="px-3 py-2 text-left font-bold">Başarı</th>
              </tr>
            </thead>
            <tbody>
              {exams.map((exam) => (
                <tr key={exam.examKey} className="border-t">
                  <td className="px-3 py-2 font-semibold">
                    {exam.name}
                    <span className="ml-1 text-[11px] text-muted-foreground">D{exam.order}</span>
                  </td>
                  <td className="px-3 py-2">{dateLabel(exam.date)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-bold">{num(exam.net)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(exam.score)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{intOf(exam.generalRank)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{intOf(exam.classRank)}</td>
                  <td className="px-3 py-2">
                    {exam.percent === null || exam.percent === undefined ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <PercentBar percent={exam.percent} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <SubjectTable rows={data.subjects} />
      <TopicTable rows={data.topics} title="Yıl boyu konu tablosu (eksikten güçlüye)" />
    </div>
  );
}

/* ------------------------------- Sınıf görünümü ----------------------------- */

function ClassYearPanel({ data }: { data: ClassYearSummary }) {
  const totals = useMemo(() => {
    const nets = data.exams
      .map((exam) => exam.avgNet)
      .filter((value): value is number => value !== null && value !== undefined);
    return {
      examCount: data.exams.length,
      studentCount: data.students.length,
      avgNet: nets.length ? nets.reduce((sum, value) => sum + value, 0) / nets.length : null,
      firstNet: nets.length ? nets[0] : null,
      lastNet: nets.length ? nets[nets.length - 1] : null,
    };
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Sınıf" value={data.className} />
        <StatCard label="Öğrenci" value={intOf(totals.studentCount)} />
        <StatCard label="Deneme" value={intOf(totals.examCount)} />
        <StatCard
          label="Ortalama net"
          value={num(totals.avgNet)}
          tone="bg-primary/10 text-primary"
        />
        <StatCard
          label="İlk → son ortalama"
          value={
            totals.firstNet === null || totals.lastNet === null
              ? '—'
              : num(totals.lastNet - totals.firstNet)
          }
          hint={
            totals.firstNet === null ? undefined : `${num(totals.firstNet)} → ${num(totals.lastNet)}`
          }
          tone="bg-blue-100 text-blue-800"
        />
      </div>

      <div className="overflow-hidden rounded-2xl border bg-card">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-extrabold">Deneme bazında sınıf ortalaması</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-bold">Deneme</th>
                <th className="px-3 py-2 text-left font-bold">Tarih</th>
                <th className="px-3 py-2 text-right font-bold">Katılan</th>
                <th className="px-3 py-2 text-right font-bold">Ort. net</th>
                <th className="px-3 py-2 text-right font-bold">Ort. puan</th>
                <th className="px-3 py-2 text-left font-bold">Başarı</th>
              </tr>
            </thead>
            <tbody>
              {data.exams.map((exam) => (
                <tr key={exam.examKey} className="border-t">
                  <td className="px-3 py-2 font-semibold">
                    {exam.name}
                    <span className="ml-1 text-[11px] text-muted-foreground">D{exam.order}</span>
                  </td>
                  <td className="px-3 py-2">{dateLabel(exam.date)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{exam.studentCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-bold">{num(exam.avgNet)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(exam.avgScore)}</td>
                  <td className="px-3 py-2">
                    {exam.percent === null || exam.percent === undefined ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <PercentBar percent={exam.percent} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border bg-card">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-extrabold">Öğrenci başına yıl özeti</p>
          <p className="text-[11px] text-muted-foreground">
            Ortalama nete göre sıralı; ilk ve son denemedeki net farkı gidişatı gösterir.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-bold">Öğrenci</th>
                <th className="px-3 py-2 text-right font-bold">Sınav</th>
                <th className="px-3 py-2 text-right font-bold">Ort. net</th>
                <th className="px-3 py-2 text-right font-bold">İlk net</th>
                <th className="px-3 py-2 text-right font-bold">Son net</th>
                <th className="px-3 py-2 text-right font-bold">Değişim</th>
              </tr>
            </thead>
            <tbody>
              {data.students.map((student) => (
                <tr key={student.key} className="border-t">
                  <td className="px-3 py-2 font-semibold">{student.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{student.examCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-bold">
                    {num(student.avgNet)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(student.firstNet)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(student.lastNet)}</td>
                  <td className="px-3 py-2 text-right">
                    <ChangeBadge value={student.netChange} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <SubjectTable rows={data.subjects} />
      <TopicTable rows={data.topics} title="Sınıfın yıl boyu konu tablosu (eksikten güçlüye)" />
    </div>
  );
}

/* ---------------------------------- Sayfa ---------------------------------- */

function YearViewContent() {
  const { can, account, school, role, profile } = useSession();

  const canViewAll = can('view_school');
  const isViewerOnly = !canViewAll && (role === 'veli' || role === 'ogrenci');

  const linked = useLinkedStudents({
    email: account?.email,
    schoolId: school?.id,
    /*
     * Yedek ad üyelikten okunur (`profile.student_name`). Oturum nesnesindeki
     * `user` yalnızca kimlik/e-posta taşır ve öğrenci alanı içermez; buradan
     * okunduğunda değer her zaman `undefined` kalıyor, yani veli kayıt
     * defterinde eşleşmediğinde öğrenci listesi sessizce boş kalıyordu.
     */
    fallbackName: profile?.student_name,
    enabled: isViewerOnly,
  });

  const [mode, setMode] = useState<Mode>('student');
  const [students, setStudents] = useState<YearRosterStudent[]>([]);
  const [classes, setClasses] = useState<YearRosterClass[]>([]);
  const [rosterScoped, setRosterScoped] = useState(false);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [studentKey, setStudentKey] = useState('');
  const [className, setClassName] = useState('');
  const [studentData, setStudentData] = useState<StudentYearSummary | null>(null);
  const [classData, setClassData] = useState<ClassYearSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Süzgeç durumu: tarih aralığı + sınav modu.
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [modeId, setModeId] = useState<string>(ALL_MODES);
  const [headers, setHeaders] = useState<ExamHeader[]>([]);
  const [setup, setSetup] = useState<ExamSetupData>(() => emptySetup());

  /*
   * Sınav modu sunucuda saklanmaz; sınav kurgusundan (bölüm / şablon kimliği)
   * çözülür. Bu yüzden mod seçenekleri için sınav başlıkları ile kurgu birlikte
   * okunur. Başlıklar kırılım içermediği için bu okuma hafiftir.
   */
  useEffect(() => {
    let alive = true;
    const local = loadSetup();
    setSetup(local);
    void fetchExamHeaders().then((result) => {
      if (alive && result) setHeaders(result);
    });
    void syncSetup(local).then((merged) => {
      if (alive) setSetup(merged);
    });
    return () => {
      alive = false;
    };
  }, []);

  /** Mod çözümlemesi için başlıklardan hafif sınav kayıtları üretir. */
  const modeExams = useMemo<ExamRecord[]>(
    () =>
      headers.map((header) => ({
        key: header.key,
        name: header.name,
        date: header.date ?? undefined,
        order: header.order,
        // Yıllık görünüm mod seçeneklerini başlıklardan üretir; mod alanları
        // taşınmazsa yıl filtresi modları yalnızca kurgu adı eşleşmesinden
        // çözebilir ve adlar ayrıştığında "seçilen modda sınav yok" der.
        section: header.section ?? undefined,
        presetId: header.presetId ?? undefined,
        blueprintId: header.blueprintId ?? undefined,
        students: [],
      })),
    [headers],
  );

  const modeOptions = useMemo(() => modeOptionsOf(modeExams, setup), [modeExams, setup]);

  // Kurgu değişince kaybolan bir mod seçili kalmasın.
  useEffect(() => {
    if (modeId === ALL_MODES) return;
    if (!modeOptions.some((option) => option.id === modeId)) setModeId(ALL_MODES);
  }, [modeOptions, modeId]);

  /*
   * Mod seçimi sınav anahtarı listesine çevrilip sunucuya gönderilir.
   * `null` "mod süzgeci yok" demektir; boş dizi "bu modda sınav yok" demektir
   * ve bu ayrım korunur, aksi halde boş seçim sessizce tüm yılı gösterirdi.
   */
  const modeExamKeys = useMemo<string[] | null>(() => {
    if (modeId === ALL_MODES) return null;
    return filterExamsByMode(modeExams, setup, modeId).map((exam) => exam.key);
  }, [modeExams, setup, modeId]);

  const rangeInvalid = Boolean(dateFrom && dateTo && dateFrom > dateTo);
  const filtersActive = Boolean(dateFrom || dateTo || modeId !== ALL_MODES);

  const filters = useMemo<YearFilters>(
    () => ({ dateFrom, dateTo, examKeys: modeExamKeys }),
    [dateFrom, dateTo, modeExamKeys],
  );

  const resetFilters = () => {
    setDateFrom('');
    setDateTo('');
    setModeId(ALL_MODES);
  };

  // Seçim listesi kırılım okumadan geldiği için kurum büyüdükçe ağırlaşmaz.
  useEffect(() => {
    let alive = true;
    setRosterLoading(true);
    void fetchYearRoster()
      .then((result) => {
        if (!alive) return;
        setStudents(result.students);
        setClasses(result.classes);
        setRosterScoped(result.scoped);
      })
      .catch((err) => {
        if (alive) setError(errorMessage(err, 'Öğrenci ve sınıf listesi okunamadı.'));
      })
      .finally(() => {
        if (alive) setRosterLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  /*
   * Veli / öğrenci yalnızca kendisine bağlı öğrencileri görür. Liste artık
   * sunucuda da kişiye indirildiği için (`scoped` bayrağı) istemci ikinci kez
   * süzmez: kayıt defterindeki ad ile optik dosyadan gelen ad farklı
   * yazıldığında ikinci süzgeç bağlı öğrenciyi ekrandan sessizce düşürürdü.
   * Bayrak gelmezse (eski/kısıtlamasız yanıt) güvenli taraf olan istemci
   * süzgeci devrede kalır.
   */
  const visibleStudents = useMemo(() => {
    if (!isViewerOnly) return students;
    if (rosterScoped) return students;
    if (!linked.keys.size) return [];
    return students.filter((student) => linked.keys.has(studentNameKey(student.name)));
  }, [students, isViewerOnly, rosterScoped, linked.keys]);

  const filteredStudents = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('tr');
    if (!term) return visibleStudents;
    return visibleStudents.filter(
      (student) =>
        student.name.toLocaleLowerCase('tr').includes(term) ||
        student.className.toLocaleLowerCase('tr').includes(term),
    );
  }, [visibleStudents, search]);

  const selectStudent = (key: string) => {
    setStudentKey(key);
    setClassData(null);
  };

  const selectClass = (label: string) => {
    setClassName(label);
    setStudentData(null);
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError('');
    if (next === 'student') setClassData(null);
    else setStudentData(null);
  };

  // Veli / öğrenci tek öğrenciye bağlıysa yıl özeti doğrudan açılır.
  useEffect(() => {
    if (!isViewerOnly || studentKey || linked.loading) return;
    if (visibleStudents.length !== 1) return;
    setStudentKey(visibleStudents[0].key);
  }, [isViewerOnly, studentKey, linked.loading, visibleStudents]);

  const target = mode === 'student' ? studentKey : className;

  /*
   * Tek yükleme noktası: seçim veya süzgeç değişince veri sunucudan yeniden
   * istenir. Süzgeç isteğe girdiği için sınav listesi, toplam kartları, ders
   * tablosu, konu tablosu ve sınıf özeti aynı kapsamı gösterir. Eski sonuç
   * istek başlamadan temizlenir; böylece ekranda bir an için eski kapsamın
   * sayıları kalmaz.
   */
  useEffect(() => {
    if (!target) return;

    if (rangeInvalid) {
      setStudentData(null);
      setClassData(null);
      setError('Başlangıç tarihi bitiş tarihinden sonra olamaz.');
      setLoading(false);
      return;
    }

    let alive = true;
    setError('');
    setLoading(true);
    if (mode === 'student') setStudentData(null);
    else setClassData(null);

    const request =
      mode === 'student'
        ? fetchStudentYear(target, filters).then((result) => {
            if (!alive) return;
            setStudentData(result);
            if (!result) setError('Bu öğrenci için kayıtlı deneme sonucu bulunamadı.');
          })
        : fetchClassYear(target, filters).then((result) => {
            if (!alive) return;
            setClassData(result);
            if (!result) setError('Bu sınıf için kayıtlı deneme sonucu bulunamadı.');
          });

    void request
      .catch((err) => {
        if (!alive) return;
        setStudentData(null);
        setClassData(null);
        setError(errorMessage(err, 'Yıllık veri okunamadı.'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [mode, target, filters, rangeInvalid]);

  const showClassTab = canViewAll;
  const activeMeta = mode === 'student' ? studentData?.filters : classData?.filters;
  const emptyByFilter =
    !loading &&
    !error &&
    filtersActive &&
    ((mode === 'student' && Boolean(studentData) && studentData!.exams.length === 0) ||
      (mode === 'class' && Boolean(classData) && classData!.exams.length === 0));

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-extrabold">
              <CalendarRange className="h-5 w-5 text-primary" />
              Yıllık görünüm
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Analiz paneli hız için yalnızca son denemeleri açar. Bu ekran bir öğrencinin veya
              sınıfın <strong>tüm yılını</strong> gösterir: girilen bütün denemeler, yıl boyu
              birikimli ders tablosu ve en çok eksik kalan konular.
            </p>
          </div>
          {showClassTab && (
            <div className="flex gap-2">
              <Button
                variant={mode === 'student' ? 'default' : 'outline'}
                size="sm"
                onClick={() => switchMode('student')}
              >
                <GraduationCap className="mr-1 h-4 w-4" />
                Öğrenci
              </Button>
              <Button
                variant={mode === 'class' ? 'default' : 'outline'}
                size="sm"
                onClick={() => switchMode('class')}
              >
                <Users className="mr-1 h-4 w-4" />
                Sınıf
              </Button>
            </div>
          )}
        </div>
      </div>

      {mode === 'student' ? (
        <div className="rounded-2xl border bg-card p-4">
          <Label htmlFor="year-student-search" className="text-xs font-bold uppercase">
            Öğrenci seç
          </Label>
          <div className="relative mt-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="year-student-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Öğrenci adı veya sınıf"
              className="pl-9"
            />
          </div>
          {rosterLoading || (isViewerOnly && linked.loading) ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Öğrenci listesi hazırlanıyor...
            </p>
          ) : filteredStudents.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              {isViewerOnly
                ? 'Hesabınıza bağlı öğrenci bulunamadı. Kurum yöneticinizin kayıt defterine e-postanızı tanımlaması gerekir.'
                : 'Eşleşen öğrenci yok.'}
            </p>
          ) : (
            <div className="mt-3 flex max-h-64 flex-wrap gap-2 overflow-y-auto">
              {filteredStudents.slice(0, 300).map((student) => (
                <Button
                  key={student.key}
                  size="sm"
                  variant={studentKey === student.key ? 'default' : 'outline'}
                  onClick={() => selectStudent(student.key)}
                >
                  {student.name}
                  <span className="ml-1 text-[11px] opacity-70">
                    {student.className} · {student.examCount} sınav
                  </span>
                </Button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-xs font-bold uppercase text-muted-foreground">Sınıf seç</p>
          {rosterLoading ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Sınıf listesi hazırlanıyor...
            </p>
          ) : classes.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Kayıtlı sınıf bulunamadı.</p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {classes.map((item) => (
                <Button
                  key={item.className}
                  size="sm"
                  variant={className === item.className ? 'default' : 'outline'}
                  onClick={() => selectClass(item.className)}
                >
                  {item.className}
                  <span className="ml-1 text-[11px] opacity-70">
                    {item.studentCount} öğrenci
                  </span>
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      {/*
        Süzgeç paneli. Tarih aralığı ve sınav modu birlikte uygulanır ve istek
        sunucuya gider; bu yüzden panelin altındaki her tablo (sınav listesi,
        toplam kartları, ders, konu, sınıf özeti) aynı kapsamı gösterir.
      */}
      <div className="rounded-2xl border bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="year-date-from" className="text-xs font-bold uppercase">
              Başlangıç tarihi
            </Label>
            <Input
              id="year-date-from"
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(event) => setDateFrom(event.target.value)}
              className="mt-1 w-[170px]"
            />
          </div>
          <div>
            <Label htmlFor="year-date-to" className="text-xs font-bold uppercase">
              Bitiş tarihi
            </Label>
            <Input
              id="year-date-to"
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(event) => setDateTo(event.target.value)}
              className="mt-1 w-[170px]"
            />
          </div>
          {filtersActive && (
            <Button variant="outline" size="sm" onClick={resetFilters}>
              <RotateCcw className="mr-1 h-4 w-4" />
              Filtreleri temizle
            </Button>
          )}
        </div>

        <div className="mt-3">
          <p className="flex items-center gap-1 text-xs font-bold uppercase text-muted-foreground">
            <Filter className="h-3.5 w-3.5" />
            Sınav modu
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={modeId === ALL_MODES ? 'default' : 'outline'}
              onClick={() => setModeId(ALL_MODES)}
            >
              Tüm sınavlar
              <span className="ml-1 text-[11px] opacity-70">{modeExams.length}</span>
            </Button>
            {modeOptions.map((option) => (
              <Button
                key={option.id}
                size="sm"
                variant={modeId === option.id ? 'default' : 'outline'}
                onClick={() => setModeId(option.id)}
              >
                {option.label}
                <span className="ml-1 text-[11px] opacity-70">{option.examCount}</span>
              </Button>
            ))}
          </div>
          {modeOptions.length === 0 && (
            <p className="mt-2 text-[12px] text-muted-foreground">
              Sınav modu, sınav kurgusundaki bölüm veya şablon bilgisinden çözülür. Kurgu
              tanımlanmadığı için şimdilik yalnızca tüm sınavlar listelenir.
            </p>
          )}
        </div>
      </div>

      {loading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Yıllık veri sunucuda özetleniyor...
        </p>
      )}

      {!loading && !error && <FilterNotice meta={activeMeta} />}

      {emptyByFilter && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
          Seçili tarih aralığı ve sınav modunda deneme bulunmuyor. Aralığı genişletin veya
          filtreleri temizleyin.
        </p>
      )}

      {!loading && error && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
          {error}
        </p>
      )}

      {!loading && mode === 'student' && studentData && studentData.exams.length > 0 && (
        <>
          <p className="text-sm font-extrabold">
            {studentData.student?.name}
            <span className="ml-2 text-xs font-semibold text-muted-foreground">
              {studentData.student?.className}
            </span>
          </p>
          <StudentYearPanel data={studentData} />
        </>
      )}

      {!loading && mode === 'class' && classData && classData.exams.length > 0 && (
        <ClassYearPanel data={classData} />
      )}

      <PageGuide storageKey="yillik" {...YEAR_VIEW_GUIDE} />
    </div>
  );
}

export default function YearViewPage() {
  return (
    <SiteLayout requireAuth wide>
      <YearViewContent />
    </SiteLayout>
  );
}