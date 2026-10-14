import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Building2,
  Check,
  CloudUpload,
  GraduationCap,
  Layers,
  Loader2,
  RefreshCw,
  UserRound,
} from 'lucide-react';
import UploadPanel from '@/components/UploadPanel';
import PrintSettings from '@/components/PrintSettings';
import StudentSidebar from '@/components/StudentSidebar';
import ReportCard from '@/components/ReportCard';
import QuestionReportSheet from '@/components/QuestionReportSheet';
import TrendSection from '@/components/TrendSection';
import SchoolOverview from '@/components/SchoolOverview';
import GoalPanel from '@/components/GoalPanel';
import StudentRecords from '@/components/StudentRecords';
import { analyzeStudentExam, buildTrend, topicMovements } from '@/lib/analysis';
import {
  bootstrapSeed,
  emptyDataset,
  listStudents,
  loadDataset,
  unifyPartialExamsWithGroups,
} from '@/lib/store';
import { emptySetup, loadSetup, syncSetup, type ExamSetupData } from '@/lib/examSetup';
import {
  ALL_MODES,
  examModeLabelMap,
  filterExamsByMode,
  modeOptionsOf,
} from '@/lib/analysisModes';
import ExamPicker from '@/components/ExamPicker';
import { combineExams } from '@/lib/examCombine';
import { dropExamByKey } from '@/lib/examResults';
import { emptyRecords, loadRecords, suggestTarget } from '@/lib/records';
import {
  ensureExamDetails,
  pullDataset,
  pullRecords,
  pushDataset,
  pushRecords,
} from '@/lib/cloud';
import { studentBaseline, studentStanding } from '@/lib/school';
import type { ExamDataset, ExamRecord, SchoolRecords } from '@/lib/types';
import { formatDateTr, gradeOf, studentKeyOf } from '@/lib/text';

type View = 'student' | 'school';

interface AnalysisPanelProps {
  /** Sadece bu öğrencinin karnesi gösterilir (veli/öğrenci rolleri). */
  restrictToStudent?: string;
  /** Okul & sınıflar sekmesi gösterilsin mi (öğretmen/yönetici). */
  allowSchoolView?: boolean;
  /** Excel yükleme paneli gösterilsin mi. */
  allowUpload?: boolean;
  /**
   * Analiz bölümünden sınav silinebilsin mi. Silme yıkıcı ve kurum genelini
   * etkileyen bir işlem olduğu için varsayılan kapalıdır; yalnızca sonuç
   * yükleme yetkisi olan kullanıcıya açılır.
   */
  allowExamDelete?: boolean;
}

export default function Index({
  restrictToStudent,
  allowSchoolView = true,
  allowUpload = true,
  allowExamDelete = false,
}: AnalysisPanelProps = {}) {
  const [dataset, setDataset] = useState<ExamDataset>(emptyDataset);
  const [records, setRecords] = useState<SchoolRecords>(emptyRecords);
  const [studentKey, setStudentKey] = useState<string>();
  /**
   * Analizde açık denemeler. Tek anahtar varsa o denemenin analizi gösterilir;
   * iki veya daha fazla anahtar seçilirse sonuçlar birleştirilip tek analiz üretilir.
   */
  const [examKeys, setExamKeys] = useState<string[]>([]);
  const [view, setView] = useState<View>('student');
  const [sync, setSync] = useState<'idle' | 'loading' | 'saving' | 'saved'>('loading');
  const savedTimer = useRef<number>();
  /** Kırılımı istenen sınav anahtarları (tembel yüklemede tekrarı önler). */
  const attemptedDetails = useRef<Set<string>>(new Set());

  // Sınav kurgusu, analizdeki "sınav modu" filtresinin etiketlerini üretir.
  const [setup, setSetup] = useState<ExamSetupData>(() => emptySetup());
  const [modeId, setModeId] = useState<string>(ALL_MODES);

  /**
   * Açılışta önce tarayıcı önbelleği gösterilir (anında görünüm),
   * ardından kalıcı depodaki veriler çekilip birleştirilir.
   * Böylece kullanıcı her girişte dosyaları tekrar yüklemek zorunda kalmaz.
   */
  useEffect(() => {
    const stored = loadDataset();
    const storedRecords = loadRecords();
    setDataset(stored);
    setRecords(storedRecords);
    setSync('loading');

    void (async () => {
      const [remoteDataset, remoteRecords] = await Promise.all([
        pullDataset(stored),
        pullRecords(storedRecords),
      ]);
      setRecords(remoteRecords);

      if (remoteDataset.exams.length > 0) {
        setDataset(remoteDataset);
      } else {
        const seeded = await bootstrapSeed(remoteDataset);
        setDataset(seeded);
        if (seeded.exams.length > 0) await pushDataset(seeded);
      }
      setSync('idle');
    })();

    return () => {
      if (savedTimer.current) window.clearTimeout(savedTimer.current);
    };
  }, []);

  /**
   * Sınav kurgusunu okur. Sonuç kayıtlarında mod alanı bulunmayan eski
   * sınavların bölümü buradan çözülür; kurgu okunamazsa filtre yine çalışır,
   * yalnızca eski kayıtlar "Mod belirtilmemiş" grubunda toplanır.
   */
  useEffect(() => {
    let alive = true;
    const local = loadSetup();
    setSetup(local);
    void syncSetup(local)
      .then((merged) => {
        if (alive) setSetup(merged);
      })
      .catch(() => {
        /* çevrimdışı: yerel kurguyla devam */
      });
    return () => {
      alive = false;
    };
  }, []);

  /** "Kaydedildi" bilgisini kısa süre gösterip sakla. */
  const markSaved = useCallback(() => {
    setSync('saved');
    if (savedTimer.current) window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSync('idle'), 2500);
  }, []);

  /** Veri kümesi her değiştiğinde kalıcı depoya yazılır. */
  const handleDatasetChange = useCallback(
    (next: ExamDataset) => {
      setDataset(next);
      setSync('saving');
      void pushDataset(next).then(markSaved);
    },
    [markSaved],
  );

  /** Hedef / ödev / rehberlik kayıtları da kalıcı depoya yazılır. */
  const handleRecordsChange = useCallback(
    (next: SchoolRecords) => {
      setRecords(next);
      setSync('saving');
      void pushRecords(next).then(markSaved);
    },
    [markSaved],
  );

  /**
   * Aynı denemenin sıralı liste ve karne dosyaları ayrı kayıt olarak durabilir.
   * Analizlerde bunları tek denemede birleştirilmiş haliyle kullanıyoruz;
   * böylece gidişatta tek sütun kalır ve puan bilgisi karneyle aynı denemede olur.
   *
   * `groups` eşlemesi silme için zorunludur: listede görünen tek kayıt aslında
   * iki ham sınavdan oluşabilir. Yalnızca görünen anahtarı silmek birleşimin
   * diğer yarısını veri kümesinde bırakır ve silinen deneme tek başına geri
   * görünür.
   */
  const unified = useMemo(() => unifyPartialExamsWithGroups(dataset.exams), [dataset.exams]);
  const allExams = unified.exams;

  /** Filtrede gösterilecek sınav modları (yalnızca veride bulunanlar). */
  const modeOptions = useMemo(() => modeOptionsOf(allExams, setup), [allExams, setup]);

  /** Seçili mod veriden kalkarsa filtre "tüm sınavlar"a döner. */
  useEffect(() => {
    if (modeId === ALL_MODES) return;
    if (!modeOptions.some((m) => m.id === modeId)) setModeId(ALL_MODES);
  }, [modeOptions, modeId]);

  // Analizin tamamı (karne, gidişat, okul görünümü) seçili moda göre süzülür.
  const exams = useMemo(
    () => filterExamsByMode(allExams, setup, modeId),
    [allExams, setup, modeId],
  );

  const students = useMemo(() => {
    const all = listStudents(exams);
    if (!restrictToStudent?.trim()) return all;
    const target = studentKeyOf(restrictToStudent);
    const mine = all.filter((s) => s.key === target);
    return mine.length ? mine : [];
  }, [exams, restrictToStudent]);

  // Öğrencinin bulunduğu denemeler (kronolojik).
  const studentExams = useMemo(
    () =>
      studentKey
        ? exams.filter((e) => e.students.some((s) => studentKeyOf(s.name) === studentKey))
        : [],
    [exams, studentKey],
  );

  /** Seçili öğrencinin sonucu bulunan sınav anahtarları. */
  const studentExamKeys = useMemo(
    () => new Set(studentExams.map((e) => e.key)),
    [studentExams],
  );

  /**
   * "Deneme" şeridinde seçilebilecek sınavlar: geçerli mod filtresindeki TÜM
   * sınavlar (yalnızca seçili öğrencinin girdikleri değil). Böylece kullanıcı
   * herhangi bir denemeye tıklayıp o denemenin analizini açabilir.
   */
  const selectableExams = useMemo(
    () => [...exams].sort((a, b) => (a.order || 0) - (b.order || 0)),
    [exams],
  );

  /**
   * Kayıt defterinden gelen `?ogrenci=Ad Soyad` bağlantısı doğrudan o öğrencinin
   * karnesini açar. Eşleşme, muhasebeyle de aynı olan normalleştirilmiş ad anahtarıdır.
   */
  const [searchParams] = useSearchParams();
  const focusKey = useMemo(
    () => studentKeyOf(searchParams.get('ogrenci') ?? ''),
    [searchParams],
  );

  useEffect(() => {
    if (focusKey && students.some((s) => s.key === focusKey)) {
      setStudentKey(focusKey);
      setView('student');
    }
  }, [focusKey, students]);

  // İlk yüklemede otomatik seçim.
  useEffect(() => {
    if (!students.length) {
      setStudentKey(undefined);
      return;
    }
    if (!studentKey || !students.some((s) => s.key === studentKey)) {
      setStudentKey(students[0].key);
    }
  }, [students, studentKey]);

  /**
   * Seçim geçerliliği: filtreden düşen denemeler seçimden çıkarılır. Seçim
   * boşalırsa öğrencinin girdiği en son deneme (yoksa listedeki son deneme) açılır.
   */
  useEffect(() => {
    const available = new Set(exams.map((e) => e.key));
    setExamKeys((prev) => {
      const valid = prev.filter((k) => available.has(k));
      if (valid.length) return valid.length === prev.length ? prev : valid;
      if (studentExams.length) return [studentExams[studentExams.length - 1].key];
      if (exams.length) return [exams[exams.length - 1].key];
      return prev.length ? [] : prev;
    });
  }, [exams, studentExams]);

  /**
   * Tembel sınav yüklemesi.
   *
   * Açılışta yalnızca en yeni sınavların kırılımı indirilir; daha eski sınavlar
   * başlık düzeyinde yer tutucu (`pending`) olarak listelenir. Kullanıcı böyle
   * bir denemeyi seçtiğinde kırılımı tamamlanır. Kazanım detayı ise ayrı ve dar
   * bir istekle yalnızca karnede görüntülenen öğrenci için okunur; eski
   * sınavlarda paketler nesne deposunda olduğu için istek arşivden karşılanır.
   *
   * Yüklenen veri yalnızca ekrana yerleşir, tekrar sunucuya yazılmaz: içerik
   * değişmediği için yazma gereksizdir.
   */
  useEffect(() => {
    const chosen = new Set(examKeys);
    if (chosen.size === 0) return;

    // Birleştirilmiş sınavlarda görünen anahtar kaynak kaydın anahtarından
    // farklı olabilir; ad üzerinden de eşleştirilir.
    const chosenNames = new Set(
      exams.filter((exam) => chosen.has(exam.key)).map((exam) => exam.name),
    );
    /*
     * Kazanım artık sınavın tamamı için değil, yalnızca karnede görüntülenen
     * öğrenci için istenir: 1.000 öğrencilik bir sınavda tüm kazanım paketi
     * ~2,9 MB gzip ek veri demekti ve indirilenin %99,9'u hiç ekrana
     * gelmiyordu. Bu yüzden deneme kaydı sınav + öğrenci çiftine göre tutulur;
     * aynı sınav başka bir öğrenci seçildiğinde kazanımı yeniden istenir, aynı
     * çift için ikinci kez istenmez.
     */
    const focus = studentKey ?? '';
    const attemptKey = (key: string) => `${key}|${focus}`;
    const needsKazanim = (exam: ExamRecord) =>
      focus !== '' &&
      !exam.kazanimsLoaded &&
      !(exam.kazanimStudentKeys ?? []).includes(focus);

    const missing = dataset.exams.filter(
      (exam) =>
        (chosen.has(exam.key) || chosenNames.has(exam.name)) &&
        !attemptedDetails.current.has(attemptKey(exam.key)) &&
        (exam.pending || needsKazanim(exam)),
    );
    if (missing.length === 0) return;

    /*
     * İstek başarısız olursa sınav `pending` kalır. Deneme kaydı tutulmazsa
     * durum güncellemesi bu etkiyi yeniden tetikler ve sonsuz istek döngüsü
     * oluşur; bu yüzden her anahtar için tek deneme yapılır.
     */
    missing.forEach((exam) => attemptedDetails.current.add(attemptKey(exam.key)));

    let alive = true;
    setSync('loading');
    void ensureExamDetails(missing, { kazanimFor: focus })
      .then((loaded) => {
        if (!alive) return;
        const byKey = new Map(loaded.map((exam) => [exam.key, exam]));
        setDataset((prev) => ({
          ...prev,
          exams: prev.exams.map((exam) => byKey.get(exam.key) ?? exam),
        }));
      })
      .finally(() => {
        if (alive) setSync('idle');
      });

    return () => {
      alive = false;
    };
    // `studentKey` bağımlılıkta olmak zorunda: kazanım yalnızca görüntülenen
    // öğrenci için indirildiği için öğrenci değiştiğinde yeni kazanım isteği
    // bu etkiden çıkar. Bağımlılık eksik olsaydı karnedeki kazanım tablosu
    // ikinci öğrenciden itibaren sessizce boş kalırdı.
  }, [examKeys, exams, dataset.exams, studentKey]);

  /** Seçili denemeler (kronolojik sırada). */
  const selectedExams = useMemo(() => {
    const chosen = new Set(examKeys);
    return exams
      .filter((e) => chosen.has(e.key))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  }, [exams, examKeys]);

  /**
   * Birden fazla deneme seçiliyse sonuçlar tek sanal denemede birleştirilir:
   * soru / doğru / yanlış sayıları ve netler toplanır, puan ve sıralamalar
   * ortalanır. Sınıf karşılaştırmaları da birleşik havuzdan hesaplanır.
   */
  const combinedExam = useMemo(
    () => (selectedExams.length > 1 ? combineExams(selectedExams) : undefined),
    [selectedExams],
  );

  /**
   * Analiz hesaplarının çalıştığı deneme listesi. Birleşik kayıt, kaynak
   * denemelerin yerine geçer; böylece gidişat karşılaştırmasında aynı sonuçlar
   * iki kez sayılmaz.
   */
  const analysisExams = useMemo(() => {
    if (!combinedExam) return exams;
    const chosen = new Set(examKeys);
    return [...exams.filter((e) => !chosen.has(e.key)), combinedExam].sort(
      (a, b) => (a.order || 0) - (b.order || 0),
    );
  }, [exams, examKeys, combinedExam]);

  /** Karnede açık olan kayıt: tek deneme veya birleşik analiz. */
  const activeExamKey = combinedExam ? combinedExam.key : examKeys[0];

  const analysis = useMemo(
    () =>
      studentKey && activeExamKey
        ? analyzeStudentExam(analysisExams, studentKey, activeExamKey)
        : undefined,
    [analysisExams, studentKey, activeExamKey],
  );

  const trend = useMemo(
    () => (studentKey ? buildTrend(exams, studentKey) : []),
    [exams, studentKey],
  );

  const movements = useMemo(
    () =>
      studentKey && activeExamKey
        ? topicMovements(analysisExams, studentKey, activeExamKey)
        : { improved: [], declined: [] },
    [analysisExams, studentKey, activeExamKey],
  );

  const currentExam = useMemo(
    () =>
      analysisExams.find((e) => e.key === activeExamKey) ??
      analysisExams[analysisExams.length - 1],
    [analysisExams, activeExamKey],
  );

  /**
   * Karnede gösterilecek kaynak etiketi: sınavı doğuran yüklenen dosya adı.
   *
   * Kırılım yolunda (ham cevap kâğıdı arşivi olmayan sınavlarda) kaynağın
   * dosya adı gösterilir; eşleşme hem sınav anahtarı hem sınav adı üzerinden
   * denenir, çünkü birleştirilmiş kayıtlarda anahtar dosyadakiyle birebir
   * olmayabilir.
   */
  const reportSourceLabel = useMemo(() => {
    const target = combinedExam ?? currentExam;
    if (!target) return undefined;
    const names = new Set<string>();
    dataset.files.forEach((file) => {
      if (file.examKeys.includes(target.key) || file.examKeys.includes(target.name)) {
        names.add(file.fileName);
      }
    });
    return names.size ? [...names].join(', ') : undefined;
  }, [combinedExam, currentExam, dataset.files]);

  const standing = useMemo(
    () => (currentExam && studentKey ? studentStanding(currentExam, studentKey) : undefined),
    [currentExam, studentKey],
  );

  const baseline = useMemo(
    () => (studentKey ? studentBaseline(exams, studentKey) : { examCount: 0 }),
    [exams, studentKey],
  );

  /**
   * Gidişat grafiğinde gösterilecek hedefler.
   * Kullanıcı hedef girmişse o, girmemişse mevcut sonuca göre önerilen hedef kullanılır.
   */
  const goalLines = useMemo(() => {
    const saved = studentKey ? records.goals[studentKey] : undefined;
    const net = saved?.targetNet ?? suggestTarget(analysis?.summary.totalNet, 'net');
    const score = saved?.targetScore ?? suggestTarget(analysis?.summary.lgsScore, 'score');
    const estimated = saved?.targetNet === undefined && saved?.targetScore === undefined;
    return { net, score, estimated };
  }, [records.goals, studentKey, analysis]);

  const hasAnyData = allExams.length > 0;
  const hasData = exams.length > 0 && students.length > 0;
  const activeModeLabel =
    modeOptions.find((m) => m.id === modeId)?.label ?? 'Tüm sınavlar';

  /** Sınav listesindeki mod etiketleri ve filtrede görünen anahtarlar. */
  const modeLabels = useMemo(() => examModeLabelMap(allExams, setup), [allExams, setup]);
  const visibleKeys = useMemo(() => new Set(exams.map((e) => e.key)), [exams]);

  /**
   * Alttaki sınav listesinden bir sınavı analizde açar.
   *
   * Sınav geçerli mod filtresinin dışındaysa filtre kaldırılır; seçili öğrenci
   * o sınava girmemişse sınava giren ilk öğrenciye geçilir. Böylece "sonuç
   * kaydedildi ama analizde görünmüyor" durumu oluşmaz.
   */
  const openExam = useCallback(
    (key: string) => {
      const exam = allExams.find((e) => e.key === key);
      if (!exam) return;
      if (!visibleKeys.has(key)) setModeId(ALL_MODES);
      setView('student');

      const keysInExam = exam.students.map((s) => studentKeyOf(s.name));
      if (restrictToStudent?.trim()) {
        const mine = studentKeyOf(restrictToStudent);
        if (!keysInExam.includes(mine)) {
          setExamKeys([key]);
          return;
        }
        setStudentKey(mine);
      } else if (!studentKey || !keysInExam.includes(studentKey)) {
        if (keysInExam.length) setStudentKey(keysInExam[0]);
      }
      setExamKeys([key]);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [allExams, visibleKeys, restrictToStudent, studentKey],
  );

  /**
   * Denemeyi birleşik analize ekler veya çıkarır. En az bir deneme seçili kalır;
   * iki veya daha fazla deneme seçildiğinde analiz otomatik olarak birleşik
   * sonuca geçer.
   */
  const toggleExam = useCallback(
    (key: string) => {
      setExamKeys((prev) => {
        if (prev.includes(key)) {
          const next = prev.filter((k) => k !== key);
          return next.length ? next : prev;
        }
        const orderOf = new Map(exams.map((e) => [e.key, e.order || 0]));
        return [...prev, key].sort((a, b) => (orderOf.get(a) ?? 0) - (orderOf.get(b) ?? 0));
      });
      setView('student');
    },
    [exams],
  );

  /**
   * Analiz bölümünden sınav silme.
   *
   * Silme üç katmanı birlikte temizler: yerel veri kümesi, silinmiş sınav
   * işareti (aksi hâlde bir sonraki okumada JSON yedeğinden geri gelirdi) ve
   * kalıcı depodaki sınav kaydı. Dönen veri kümesi doğrudan state'e yazıldığı
   * için analiz ekranı sayfa yenilenmeden güncellenir.
   *
   * Birleştirilmiş kayıtlarda görünen anahtar kaynak kayıtların anahtarından
   * farklı olabilir. Silme bu yüzden önce **birleşme grubuna** bakar: listede
   * görünen tek kart aslında sıralı liste + karne olmak üzere iki ham sınavdan
   * oluşabilir ve yalnızca görünen anahtarı silmek birleşimin diğer yarısını
   * veri kümesinde bırakır; sonraki okumada silinen deneme tek başına geri
   * görünür. Grubun yanında aynı ada sahip diğer kayıtlar da silinir, çünkü
   * aynı denemenin mükerrer yüklemeleri farklı anahtarla duruyor olabilir ve
   * kartlardan biri silinip diğeri ekranda kalırsa kullanıcı silmenin
   * çalışmadığını görür.
   */
  const handleExamDelete = useCallback(
    async (exam: ExamRecord) => {
      const keys = new Set<string>(unified.groups.get(exam.key) ?? [exam.key]);
      dataset.exams.forEach((e) => {
        if (e.name === exam.name) keys.add(e.key);
      });

      let next = dataset;
      let unsynced = 0;
      let failure: string | undefined;
      for (const key of keys) {
        const result = await dropExamByKey(key);
        next = result.dataset;
        if (!result.synced) {
          unsynced += 1;
          failure = result.message ?? failure;
        }
      }
      setDataset(next);
      setExamKeys((prev) => prev.filter((k) => !keys.has(k)));
      attemptedDetails.current = new Set(
        [...attemptedDetails.current].filter(
          (entry) => !keys.has(entry.split('|')[0]),
        ),
      );
      /*
        Silme kararı sunucuya yazılamadıysa "silindi" demek yanıltıcı olurdu:
        öğretmen, veli, öğrenci ve rehber öğretmen hesapları sınavı sunucudan
        okuduğu için karar yazılmadan sınav onlarda görünmeye devam eder.
        Sınav bu cihazda kaldırıldı ama karar kuyrukta; kullanıcıya bunu
        söylemek, sessizce başarı bildirmekten doğrudur.
      */
      if (unsynced === 0) {
        toast.success(`"${exam.name}" analizden silindi.`);
      } else {
        toast.error(
          failure ??
            `"${exam.name}" bu cihazdan kaldırıldı, ancak silme kaydı sunucuya yazılamadı. Bağlantı düzelince otomatik yeniden denenecek.`,
        );
      }
    },
    [dataset, unified],
  );

  /** Okul geneli listeden isme tıklanınca öğrenci karnesine geç. */
  const openStudentByName = (name: string) => {
    const key = studentKeyOf(name);
    if (students.some((s) => s.key === key)) {
      setStudentKey(key);
      setView('student');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="no-print rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <GraduationCap className="h-5 w-5" />
          </span>
          <div className="mr-auto">
            <p className="text-sm font-extrabold leading-tight">Deneme Analiz Paneli</p>
            <p className="text-xs text-muted-foreground">
              {hasData
                ? `${exams.length} deneme · ${students.length} öğrenci${
                    modeId === ALL_MODES ? '' : ` · ${activeModeLabel}`
                  }`
                : hasAnyData
                  ? `${activeModeLabel} için sonuç yok`
                  : 'Excel yükleyerek başlayın'}
            </p>
          </div>

          {hasAnyData && modeOptions.length > 0 && (
            <div
              className="flex flex-wrap items-center gap-1 rounded-lg border p-1"
              title="Analizi yalnızca seçtiğiniz sınav moduna göre gösterir."
            >
              <span className="px-1.5 text-[11px] font-bold text-muted-foreground">
                Sınav modu:
              </span>
              <button
                type="button"
                onClick={() => setModeId(ALL_MODES)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors duration-150 ${
                  modeId === ALL_MODES
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:md:bg-accent'
                }`}
              >
                Tüm sınavlar ({allExams.length})
              </button>
              {modeOptions.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setModeId(mode.id)}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors duration-150 ${
                    modeId === mode.id
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:md:bg-accent'
                  }`}
                >
                  {mode.label} ({mode.examCount})
                </button>
              ))}
            </div>
          )}

          {hasData && allowSchoolView && (
            <div className="flex items-center gap-1 rounded-lg border p-1">
              <button
                type="button"
                onClick={() => setView('student')}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors duration-150 ${
                  view === 'student' ? 'bg-primary text-primary-foreground' : 'hover:md:bg-accent'
                }`}
              >
                <UserRound className="h-3.5 w-3.5" />
                Öğrenci karnesi
              </button>
              <button
                type="button"
                onClick={() => setView('school')}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors duration-150 ${
                  view === 'school' ? 'bg-primary text-primary-foreground' : 'hover:md:bg-accent'
                }`}
              >
                <Building2 className="h-3.5 w-3.5" />
                Okul & sınıflar
              </button>
            </div>
          )}

          <span
            className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold text-muted-foreground"
            title="Yüklenen veriler okul hesabınıza kaydedilir; her girişte otomatik yüklenir."
          >
            {sync === 'loading' && (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Veriler yükleniyor
              </>
            )}
            {sync === 'saving' && (
              <>
                <CloudUpload className="h-3.5 w-3.5 animate-pulse" />
                Kaydediliyor
              </>
            )}
            {sync === 'saved' && (
              <>
                <Check className="h-3.5 w-3.5 text-[hsl(var(--status-good))]" />
                Kaydedildi
              </>
            )}
            {sync === 'idle' && (
              <>
                <Check className="h-3.5 w-3.5 text-[hsl(var(--status-good))]" />
                Veriler kayıtlı
              </>
            )}
          </span>

          {hasData && <PrintSettings />}
        </div>
      </div>

      <div>
        {!hasAnyData ? (
          <div className="mx-auto max-w-2xl space-y-6">
            <div className="text-center">
              <h1>Öğrenci deneme karnesi tek sayfada</h1>
              <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
                Ders netlerini, konu bazlı eksikleri, öncelikli çalışma planını, sınıf/okul geneli
                durumu, hedef takibini, ödevleri ve rehberlik notlarını tek panelde toplar.
              </p>
            </div>
            {allowUpload ? (
              <UploadPanel dataset={dataset} onChange={handleDatasetChange} variant="hero" />
            ) : (
              <div className="rounded-xl border border-dashed bg-card px-4 py-10 text-center">
                <p className="text-sm text-muted-foreground">
                  Henüz size ait deneme sonucu yüklenmemiş. Deneme sonuçları okul tarafından
                  yüklendiğinde karneniz burada görünecek.
                </p>
              </div>
            )}
          </div>
        ) : !hasData ? (
          <div className="rounded-xl border border-dashed bg-card px-4 py-12 text-center">
            <p className="text-sm font-bold">“{activeModeLabel}” için sonuç bulunamadı.</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Bu sınav modunda kayıtlı deneme sonucu yok. Yukarıdaki filtreden{' '}
              <strong>Tüm sınavlar</strong>ı seçerek diğer sonuçları görebilirsiniz.
            </p>
          </div>
        ) : view === 'school' ? (
          <div className="space-y-6">
            {/* Veri işlemleri paneli sayfanın en altında toplanır. */}
            {currentExam ? (
              <SchoolOverview
                exam={currentExam}
                exams={analysisExams}
                onSelectStudentName={openStudentByName}
              />
            ) : (
              <div className="rounded-xl border border-dashed bg-card px-4 py-12 text-center">
                <p className="text-sm text-muted-foreground">Deneme verisi bulunamadı.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
            {/*
              Kolon sağdaki karne içeriği kadar uzar (`self-stretch`); içindeki
              liste kartı `lg:sticky` ile ekranda sabit kalır. Böylece sol taraf
              boş görünmez, sayfa aşağı kaydırılırken öğrenci listesi erişilebilir
              kalır ve uzun içerikte de tüm yükseklik kullanılır.
            */}
            <div className="no-print self-stretch">
              <div className="lg:sticky lg:top-4">
                <StudentSidebar
                  students={students}
                  selectedKey={studentKey}
                  onSelect={setStudentKey}
                />
              </div>
            </div>

            <div className="min-w-0 space-y-6">
              {selectableExams.length > 0 && (
                /* Deneme seçimi: mod filtresindeki tüm sınavlar listelenir.
                   Seçili öğrencinin girmediği bir denemeye tıklanırsa o denemeye
                   giren ilk öğrenci otomatik seçilir ve analiz o sınava geçer. */
                <div className="no-print rounded-xl border bg-card px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <RefreshCw className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="mr-1 text-sm font-semibold">Deneme:</span>
                    {selectableExams.map((e) => {
                      const active = examKeys.includes(e.key);
                      const attended = studentExamKeys.has(e.key);
                      return (
                        <span
                          key={e.key}
                          className={`flex max-w-[260px] items-center overflow-hidden rounded-md border text-xs font-semibold ${
                            active
                              ? 'border-primary bg-primary text-primary-foreground'
                              : attended
                                ? 'bg-background'
                                : 'border-dashed bg-background text-muted-foreground'
                          }`}
                        >
                          {/* Kutucuk: denemeyi birleşik analize ekler / çıkarır. */}
                          <button
                            type="button"
                            aria-pressed={active}
                            onClick={() => toggleExam(e.key)}
                            title={
                              active
                                ? `${e.name} · seçimden çıkar`
                                : `${e.name} · birleşik analize ekle`
                            }
                            className={`flex h-7 w-7 shrink-0 items-center justify-center border-r transition-colors duration-150 ${
                              active ? 'border-primary-foreground/30' : 'hover:md:bg-accent'
                            }`}
                          >
                            {active ? (
                              <Check className="h-3.5 w-3.5" />
                            ) : (
                              <span className="h-3 w-3 rounded-[3px] border" />
                            )}
                          </button>
                          {/* Etiket: yalnızca bu denemenin analizini açar. */}
                          <button
                            type="button"
                            onClick={() => openExam(e.key)}
                            title={`${e.name} · ${formatDateTr(e.date)}${
                              attended ? '' : ' · seçili öğrencinin bu denemede sonucu yok'
                            }`}
                            className={`min-w-0 px-2.5 py-1 text-left transition-colors duration-150 ${
                              active ? '' : 'hover:md:bg-accent'
                            }`}
                          >
                            <span className="block truncate">
                              D{e.order} · {formatDateTr(e.date)}
                            </span>
                          </button>
                        </span>
                      );
                    })}

                    {examKeys.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setExamKeys([examKeys[examKeys.length - 1]])}
                        className="rounded-md border px-2.5 py-1 text-xs font-semibold hover:md:bg-accent"
                      >
                        Tek denemeye dön
                      </button>
                    )}
                  </div>

                  {combinedExam ? (
                    <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
                      <Layers className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <strong className="text-foreground">
                        Birleşik analiz: {selectedExams.map((e) => `D${e.order}`).join(' + ')}
                      </strong>
                      <span>
                        · {selectedExams.length} deneme · {combinedExam.students.length} öğrenci ·
                        soru, doğru ve yanlış sayıları toplanır, netler toplanır; puan ve sıralamalar
                        ortalanır
                      </span>
                    </p>
                  ) : (
                    currentExam && (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        Analizde açık:{' '}
                        <strong className="text-foreground">{currentExam.name}</strong> ·{' '}
                        {currentExam.students.length} öğrenci sonucu · soldaki kutucukları
                        işaretleyerek iki veya daha fazla denemeyi birleştirebilirsiniz
                        {selectableExams.some((e) => !studentExamKeys.has(e.key)) && (
                          <>
                            {' '}
                            · kesikli çerçeveli denemelerde seçili öğrencinin sonucu yoktur
                          </>
                        )}
                      </p>
                    )
                  )}
                </div>
              )}

              {analysis && studentKey ? (
                <>
                  <ReportCard analysis={analysis} movements={movements} />

                  {/*
                    Sınav karnesi iki kaynaktan üretilir: arşivlenmiş ham cevap
                    kâğıdı varsa soru soru döküm, yoksa yüklenen sonuç dosyasının
                    ders/konu kırılımı. Birleşik (çok denemeli) seçimde tek bir
                    cevap anahtarı olmadığı için bileşen kendi boş durumunu gösterir.
                  */}
                  <QuestionReportSheet
                    exam={combinedExam ?? currentExam}
                    studentKey={studentKey}
                    studentName={analysis.name}
                    setup={setup}
                    merged={Boolean(combinedExam)}
                    sourceLabel={reportSourceLabel}
                  />

                  <GoalPanel
                    records={records}
                    onChange={handleRecordsChange}
                    studentKey={studentKey}
                    studentName={analysis.name}
                    grade={gradeOf(analysis.className)}
                    currentScore={analysis.summary.lgsScore}
                    currentNet={analysis.summary.totalNet}
                    baseline={baseline}
                    standing={standing}
                  />

                  <StudentRecords
                    records={records}
                    onChange={handleRecordsChange}
                    studentKey={studentKey}
                    studentName={analysis.name}
                    className={analysis.className}
                    roster={students}
                    standing={standing}
                    weakTopics={analysis.weakTopics}
                  />

                  <TrendSection
                    points={trend}
                    movements={movements}
                    targetNet={goalLines.net}
                    targetScore={goalLines.score}
                    targetEstimated={goalLines.estimated}
                  />
                </>
              ) : (
                <div className="rounded-xl border border-dashed bg-card px-4 py-12 text-center">
                  <p className="text-sm text-muted-foreground">
                    Soldaki listeden bir öğrenci seçin.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Kurumdaki tüm sınavlar: yeni yüklenen sınav her durumda buradan açılabilir. */}
      {hasAnyData && (
        <ExamPicker
          exams={allExams}
          modeLabels={modeLabels}
          visibleKeys={visibleKeys}
          selectedKeys={examKeys}
          onSelect={openExam}
          onDelete={allowExamDelete ? handleExamDelete : undefined}
        />
      )}

      {/*
        Veri işlemleri (Excel yükleme, şablonlar, kayıtlı dosyalar) sayfanın en
        altında yer alır: günlük kullanımda öğrenci listesi ve karne öne çıkar,
        yükleme işlemleri ise arandığında sabit bir yerde bulunur.
      */}
      {hasAnyData && allowUpload && (
        <div className="no-print">
          <UploadPanel dataset={dataset} onChange={handleDatasetChange} variant="compact" />
        </div>
      )}
    </div>
  );
}