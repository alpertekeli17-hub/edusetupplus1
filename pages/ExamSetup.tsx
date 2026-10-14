/**
 * Sınav bölümü ekranı (`/sinavlar`).
 *
 * Yetkili yönetici (süper admin / kurum yöneticisi) bu ekranda:
 * 1. Kurumun sınav bölümü, sınıf ve ders listelerini elle veya liste dosyası
 *    yükleyerek yönetir,
 * 2. Bir sınav tanımlar (bölüm, sınıf, tarih, yanlış-doğru götürme oranı) ve
 *    hangi dersten kaç soru olduğunu girer,
 * 3. Soru başına konu + cevap anahtarını girer,
 * 4. Optik okuyucudan gelen txt sonuç dosyasını yükler; sistem cevap anahtarına
 *    göre otomatik analiz üretir ve analiz paneline yansıtır.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  ChevronDown,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';

import SiteLayout, { useSession } from '@/components/SiteLayout';
import PageGuide from '@/components/PageGuide';
// NEDEN: sınav kurgusu bölümleri de ok ile açılıp kapansın.
import CollapsibleSection from '@/components/CollapsibleSection';
import { EXAM_GUIDE } from '@/lib/pageGuides';
import TopicMultiSelect from '@/components/TopicMultiSelect';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ANSWER_OPTIONS,
  answerKeyProgress,
  blueprintToTemplate,
  buildQuestionRows,
  DEFAULT_SUBJECTS,
  emptySetup,
  examModes,
  loadSetup,
  mergeAnswerSheets,
  mergeNames,
  newBlueprintId,
  persistSetup,
  setSubjectCoefficient,
  setSubjectTopics,
  subjectTopicPool,
  syncSetup,
  templateNameTaken,
  toArchivedSheet,
  type ExamAnswerSheet,
  type ExamBlueprint,
  type ExamSetupData,
  type ExamSubjectPlan,
} from '@/lib/examSetup';
import ManualResultEntry from '@/components/ManualResultEntry';
import ExamSheetManager from '@/components/ExamSheetManager';
import ExamTemplateBuilder from '@/components/ExamTemplateBuilder';
import {
  dropExamRecord,
  exportResultWorkbook,
  forgetResultFile,
  ingestParsedSheets,
  parseAnswerSheets,
  rescoreBlueprint,
  type IngestResultOutcome,
} from '@/lib/examResults';
import type { ExamPreset } from '@/lib/examPresets';
import ResultMatchDialog, { type MatchRow } from '@/components/ResultMatchDialog';
import { foldName, matchStudent, readResultText, suggestStudents, type RosterStudent } from '@/lib/studentMatch';
import { fetchStudentRecords } from '@/lib/students';
import { fetchStudentList } from '@/lib/examStore';
import type { AnswerSheet } from '@/lib/examResults';
import ExcelToolbar from '@/components/ExcelToolbar';
import {
  EXAM_KEY_HEADERS,
  examKeySheet,
  examTemplateSheets,
  readExamKey,
} from '@/lib/moduleExcel';
import {
  catalogClasses,
  catalogSections,
  catalogSubjects,
  catalogTopics,
  loadTopicCatalog,
  matchCatalogClass,
  topicCatalogStatus,
  type TopicRow,
} from '@/lib/topics';
import type { ExamRecord } from '@/lib/types';

/**
 * Yükleme zamanını kısa yerel biçimde gösterir.
 * Bozuk/boş tarihlerde satırın kırılmaması için ham değer döner.
 */
function formatUploadedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Tek ders satırı. Konu listesi varsayılan olarak kapalıdır; sağdaki ok ile
 * açılır. Böylece 10-15 dersli bir sınavda ekran konu etiketleriyle dolmaz.
 */
function SubjectPlanRow({
  plan,
  catalog,
  className,
  onQuestionsChange,
  onCoefficientChange,
  onTopicsChange,
  onRemove,
}: {
  plan: ExamSubjectPlan;
  catalog: string[];
  className: string;
  onQuestionsChange: (value: number) => void;
  onCoefficientChange: (value: number) => void;
  onTopicsChange: (next: string[]) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = plan.topics ?? [];

  return (
    <div className="rounded-xl border bg-background/60">
      <div className="flex items-center gap-2 p-2.5">
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${plan.subject} konularını ${open ? 'kapat' : 'aç'}`}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition hover:bg-muted"
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>

        <button
          type="button"
          className="flex min-w-0 flex-1 flex-col items-start text-left"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="w-full truncate text-sm font-bold">{plan.subject}</span>
          <span className="text-[10px] font-semibold text-muted-foreground">
            {selected.length > 0
              ? `${selected.length} konu seçili`
              : catalog.length > 0
                ? `konu seçilmedi (tüm ${catalog.length} konu)`
                : 'katalogda konu yok'}
          </span>
        </button>

        <Input
          type="number"
          min={1}
          max={200}
          value={plan.questions}
          title="Soru sayısı"
          className="h-9 w-16 shrink-0"
          onChange={(e) => onQuestionsChange(Number(e.target.value) || 1)}
        />
        <span className="shrink-0 text-[11px] text-muted-foreground">soru</span>
        <Input
          type="number"
          min={0}
          max={100}
          step={0.01}
          value={plan.coefficient ?? 1}
          title="Ders katsayısı (standart puan bu katsayıyla ağırlıklandırılır)"
          className="h-9 w-16 shrink-0"
          onChange={(e) => onCoefficientChange(Number(e.target.value) || 0)}
        />
        <span className="shrink-0 text-[11px] text-muted-foreground">katsayı</span>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="shrink-0"
          aria-label={`${plan.subject} dersini kaldır`}
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {open && (
        <div className="border-t px-2.5 pb-2.5 pt-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="text-[10px] font-bold uppercase text-muted-foreground">
              Sınava giren konular ({className ? `${className}. sınıf · ` : ''}
              {catalog.length} konu)
            </p>
            {catalog.length > 0 && (
              <button
                type="button"
                className="text-[10px] font-bold text-primary underline"
                onClick={() => onTopicsChange(catalog)}
              >
                Tümünü seç
              </button>
            )}
          </div>
          <TopicMultiSelect
            options={catalog}
            selected={selected}
            placeholder="Konu seçin (boş = tüm konular)"
            emptyHint="Bu ders için katalogda konu yok."
            onChange={onTopicsChange}
          />
        </div>
      )}
    </div>
  );
}

/** Sınavın ders planı: hangi dersten kaç soru ve sınava giren konular. */
function SubjectPlanEditor({
  subjects,
  options,
  topicRows,
  className,
  onChange,
}: {
  subjects: ExamSubjectPlan[];
  options: string[];
  topicRows: TopicRow[];
  className: string;
  onChange: (next: ExamSubjectPlan[]) => void;
}) {
  const available = options.filter((o) => !subjects.some((s) => s.subject === o));
  const [subject, setSubject] = useState('');
  const [count, setCount] = useState('20');

  return (
    <div className="space-y-3">
      {subjects.map((plan, index) => (
        <SubjectPlanRow
          key={plan.subject}
          plan={plan}
          className={className}
          catalog={catalogTopics(topicRows, plan.subject, undefined, className)}
          onQuestionsChange={(value) => {
            const next = [...subjects];
            next[index] = { ...plan, questions: Math.max(1, Math.min(200, value)) };
            onChange(next);
          }}
          onCoefficientChange={(value) =>
            onChange(setSubjectCoefficient(subjects, plan.subject, value))
          }
          onTopicsChange={(topics) =>
            onChange(setSubjectTopics(subjects, plan.subject, topics))
          }
          onRemove={() => onChange(subjects.filter((s) => s.subject !== plan.subject))}
        />
      ))}

      <div className="flex flex-wrap items-center gap-2 border-t pt-2">
        <select
          value={subject}
          className="h-9 flex-1 min-w-[140px] rounded-md border bg-background px-2 text-sm"
          onChange={(e) => setSubject(e.target.value)}
        >
          <option value="">Ders seçin…</option>
          {available.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <Input
          type="number"
          min={1}
          max={200}
          value={count}
          className="h-9 w-20"
          onChange={(e) => setCount(e.target.value)}
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            const questions = Math.max(1, Math.min(200, Number(count) || 0));
            if (!subject) {
              toast.error('Ders seçin.');
              return;
            }
            // Seçilen sınıfın bu dersteki tüm konuları hazır seçili gelir;
            // kullanıcı istemediklerini etiketlerden kaldırabilir.
            const topics = catalogTopics(topicRows, subject, undefined, className);
            onChange([...subjects, { subject, questions, topics }]);
            setSubject('');
            if (topics.length) {
              toast.success(`${subject}: ${topics.length} konu yüklendi.`);
            }
          }}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Ders ekle
        </Button>
      </div>
    </div>
  );
}

function ExamSetupBody() {
  const { can } = useSession();
  const navigate = useNavigate();
  const allowed = can('manage_exams') || can('manage_users');

  const [setup, setSetup] = useState<ExamSetupData>(() => emptySetup());
  const [activeId, setActiveId] = useState('');
  const [topicRows, setTopicRows] = useState<TopicRow[]>([]);
  const [catalogError, setCatalogError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  /* Öğrenci eşleştirme penceresinin bekleyen yüklemesi */
  const [pendingMatch, setPendingMatch] = useState<{
    file: File;
    sheets: AnswerSheet[];
    warnings: string[];
    rows: MatchRow[];
    roster: RosterStudent[];
    /** Dolu ise mevcut bir dosyanın yerine yükleniyor. */
    replaceTarget?: string;
  } | null>(null);
  const [lastResult, setLastResult] = useState<{
    blueprint: ExamBlueprint;
    record: ExamRecord;
    warnings: string[];
  } | null>(null);
  const resultRef = useRef<HTMLInputElement>(null);
  /*
   * Yüklenen sonuç dosyaları listesi varsayılan olarak kapalıdır: bir sınavda
   * onlarca sınıf dosyası olabildiği için ekran dolmasın. Yükleme düğmesi ise
   * liste kapalı olsa da her zaman görünür kalır.
   */
  const [resultsOpen, setResultsOpen] = useState(false);
  /** Değiştirme/silme sırasında işlem gören dosya adı (satır bazlı bekleme). */
  const [busyFile, setBusyFile] = useState('');
  const replaceRef = useRef<HTMLInputElement>(null);
  const replaceTargetRef = useRef('');

  // Konu kataloğu, sınav kurgusu senkronundan BAĞIMSIZ yüklenir.
  // (Daha önce ikisi aynı Promise.all içindeydi; senkron hata verdiğinde
  // katalog da yüklenmiyor ve ders listesi varsayılanlara düşüyordu.)
  const reloadCatalog = useCallback(async (force = false) => {
    const rows = await loadTopicCatalog(force);
    setTopicRows(rows);
    setCatalogError(rows.length ? '' : topicCatalogStatus().error || 'Konu kataloğu okunamadı.');
    return rows;
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const local = loadSetup();
      if (alive) setSetup(local);

      void reloadCatalog();

      try {
        const merged = await syncSetup(local);
        if (!alive) return;
        setSetup(merged);
        setActiveId((prev) => prev || merged.blueprints[0]?.id || '');
      } catch {
        if (!alive) return;
        setActiveId((prev) => prev || local.blueprints[0]?.id || '');
      }
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [reloadCatalog]);

  const active = useMemo(
    () => setup.blueprints.find((b) => b.id === activeId) ?? null,
    [setup.blueprints, activeId],
  );

  const progress = useMemo(
    () => answerKeyProgress(active?.questions ?? []),
    [active?.questions],
  );

  // Ekranda listelenen sınav modları: kurumun kendi şablonları + hazır modlar.
  const modes = useMemo(() => examModes(setup), [setup]);

  // Bölüm / sınıf / ders seçenekleri öncelikle konu kodları kataloğundan
  // (kurumun yüklediği Excel) üretilir; katalog boşsa elle girilen liste kullanılır.
  const sectionOptions = useMemo(
    () => mergeNames(catalogSections(topicRows), setup.catalog.sections),
    [topicRows, setup.catalog.sections],
  );

  // Sınıf listesi katalogdaki tüm sınıflardır; bölüm seçimi sınıfı kısıtlamaz.
  const classOptions = useMemo(() => {
    const fromCatalog = catalogClasses(topicRows);
    return fromCatalog.length ? mergeNames(fromCatalog, setup.catalog.classes) : setup.catalog.classes;
  }, [topicRows, setup.catalog.classes]);

  // Ders listesi yalnızca seçili sınıfa göre daralır (bölümden bağımsız).
  const subjectOptions = useMemo(() => {
    const fromCatalog = catalogSubjects(topicRows, undefined, active?.className);
    if (!fromCatalog.length) return setup.catalog.subjects;
    // Katalogda olmayıp kurumun elle eklediği dersler de listede kalsın.
    const extra = setup.catalog.subjects.filter(
      (s) => !DEFAULT_SUBJECTS.includes(s) && !fromCatalog.includes(s),
    );
    return mergeNames(fromCatalog, extra);
  }, [topicRows, active?.className, setup.catalog.subjects]);

  const patchActive = useCallback(
    (patch: Partial<ExamBlueprint>) => {
      setSetup((prev) => ({
        ...prev,
        blueprints: prev.blueprints.map((b) =>
          b.id === activeId ? { ...b, ...patch, updatedAt: new Date().toISOString() } : b,
        ),
      }));
    },
    [activeId],
  );

  /**
   * Sınıf değiştiğinde ders planındaki konular ve soru satırlarındaki seçimler
   * yeni sınıfın katalog konularına göre yenilenir. Aksi halde ekranda önceki
   * sınıfın konuları kalıyor ve "sınıfa göre gelmiyor" izlenimi oluşuyordu.
   */
  const changeClass = useCallback(
    (nextClass: string) => {
      if (!active) return;
      const subjects = active.subjects.map((plan) => ({
        ...plan,
        topics: catalogTopics(topicRows, plan.subject, undefined, nextClass),
      }));
      const allowedBySubject = new Map(subjects.map((p) => [p.subject, new Set(p.topics)]));
      const questions = active.questions.map((q) => {
        const allowed = allowedBySubject.get(q.subject);
        if (!allowed || !allowed.size) return q;
        return { ...q, topics: q.topics.filter((t) => allowed.has(t)) };
      });
      patchActive({ className: nextClass, subjects, questions });
    },
    [active, topicRows, patchActive],
  );

  const createBlueprint = () => {
    const blueprint: ExamBlueprint = {
      id: newBlueprintId(),
      name: `Yeni sınav ${setup.blueprints.length + 1}`,
      section: setup.catalog.sections[0] ?? '',
      className: setup.catalog.classes[0] ?? '',
      date: new Date().toISOString().slice(0, 10),
      penalty: 3,
      subjects: [],
      questions: [],
      sheets: [],
      results: [],
      updatedAt: new Date().toISOString(),
    };
    setSetup((prev) => ({ ...prev, blueprints: [...prev.blueprints, blueprint] }));
    setActiveId(blueprint.id);
  };

  /**
   * Sınavı listeden kaldırır. Sınavla birlikte o sınavın ders planı, soru
   * listesi ve cevap anahtarı da silinir; silme işlemi anında kaydedilir.
   */
  const removeBlueprint = async (id: string) => {
    const target = setup.blueprints.find((b) => b.id === id);
    if (!target) return;
    const confirmed = window.confirm(
      `“${target.name}” sınavı silinsin mi?\n\nSınavın ders planı, soru listesi ve cevap anahtarı da silinir. Daha önce üretilmiş analiz sonuçları analiz ekranında kalır.`,
    );
    if (!confirmed) return;

    const next: ExamSetupData = {
      ...setup,
      blueprints: setup.blueprints.filter((b) => b.id !== id),
    };
    setSetup(next);
    if (activeId === id) setActiveId(next.blueprints[0]?.id ?? '');

    const ok = await persistSetup(next);
    if (ok) toast.success(`“${target.name}” silindi.`);
    else toast.warning('Sınav bu cihazdan silindi; sunucuya yazılamadı.');
  };

  /**
   * Hazır sınav modunu uygular: ders dağılımı, soru sayıları, katsayılar,
   * yanlış götürme oranı, puan ölçeği ve modun sınıfına ait konular kurulur.
   */
  const applyPreset = useCallback(
    (preset: ExamPreset) => {
      const className =
        (topicRows.length ? matchCatalogClass(topicRows, preset.className) : null) ??
        preset.className;

      const subjects: ExamSubjectPlan[] = preset.subjects.map((s) => ({
        subject: s.subject,
        questions: s.questions,
        coefficient: s.coefficient,
        topics: catalogTopics(topicRows, s.subject, undefined, className),
      }));

      const blueprint: ExamBlueprint = {
        id: newBlueprintId(),
        name: `${preset.name} — ${new Date().toLocaleDateString('tr')}`,
        section: preset.section,
        className,
        date: new Date().toISOString().slice(0, 10),
        penalty: preset.penalty,
        presetId: preset.id,
        scaleMin: preset.scaleMin,
        scaleMax: preset.scaleMax,
        subjects,
        questions: buildQuestionRows(subjects),
        sheets: [],
        results: [],
        updatedAt: new Date().toISOString(),
      };

      setSetup((prev) => ({
        ...prev,
        catalog: preset.section
          ? {
              ...prev.catalog,
              sections: mergeNames(prev.catalog.sections, [preset.section]),
            }
          : prev.catalog,
        blueprints: [...prev.blueprints, blueprint],
      }));
      setActiveId(blueprint.id);

      const total = subjects.reduce((sum, s) => sum + s.questions, 0);
      toast.success(`${preset.name} kuruldu: ${subjects.length} ders, ${total} soru.`);
    },
    [topicRows],
  );

  /** Yeni kurum şablonunu listeye ekler ve kalıcı olarak kaydeder. */
  const addTemplate = useCallback(
    async (template: ExamPreset) => {
      const next: ExamSetupData = {
        ...setup,
        catalog: template.section
          ? {
              ...setup.catalog,
              sections: mergeNames(setup.catalog.sections, [template.section]),
            }
          : setup.catalog,
        templates: [...(setup.templates ?? []), template],
      };
      setSetup(next);
      const ok = await persistSetup(next);
      if (ok) toast.success(`“${template.name}” şablonu sınav modlarına eklendi.`);
      else toast.warning('Şablon bu cihaza kaydedildi; sunucuya yazılamadı.');
    },
    [setup],
  );

  /** Kurum şablonunu siler; o şablonla kurulmuş sınavlar etkilenmez. */
  const removeTemplate = async (template: ExamPreset) => {
    const confirmed = window.confirm(
      `“${template.name}” şablonu silinsin mi?\n\nBu şablonla daha önce kurulmuş sınavlar ve sonuçları etkilenmez.`,
    );
    if (!confirmed) return;

    const next: ExamSetupData = {
      ...setup,
      templates: (setup.templates ?? []).filter((t) => t.id !== template.id),
    };
    setSetup(next);
    const ok = await persistSetup(next);
    if (ok) toast.success(`“${template.name}” şablonu silindi.`);
    else toast.warning('Şablon bu cihazdan silindi; sunucuya yazılamadı.');
  };

  /** Açık sınavın kurgusunu yeniden kullanılabilir şablona çevirir. */
  const saveActiveAsTemplate = async () => {
    if (!active) return;
    if (!active.subjects.length) {
      toast.error('Şablon oluşturmak için önce ders planı ekleyin.');
      return;
    }
    const suggested = `${active.name} şablonu`;
    const entered = window.prompt('Şablon adı:', suggested);
    if (entered === null) return;
    const name = entered.trim() || suggested;
    if (templateNameTaken(setup, name)) {
      toast.error('Bu adla bir sınav modu zaten var. Farklı bir ad girin.');
      return;
    }
    await addTemplate(blueprintToTemplate(active, name));
  };

  const save = async () => {
    setSaving(true);
    const ok = await persistSetup(setup);
    setSaving(false);
    if (ok) toast.success('Sınav kurgusu kaydedildi.');
    else toast.warning('Kurgu bu cihaza kaydedildi; sunucuya yazılamadı.');
  };

  /**
   * Üretilen sonucu sınav kaydına damgalar ve sonuç kartını açar.
   * Optik dosya yükleme ile elle giriş aynı akışı paylaşır.
   */
  const stampResult = useCallback(
    async (blueprint: ExamBlueprint, sourceName: string, outcome: IngestResultOutcome) => {
      const stamped: ExamBlueprint = {
        ...blueprint,
        /*
         * Ham cevap kâğıtları sınavla birlikte arşivlenir. Aynı öğrenci
         * yeniden yüklenirse satır çoğaltılmaz, kâğıdı güncellenir; böylece
         * bir sınıfın eksik kalan kısmı sonradan yüklendiğinde önceki
         * öğrencilerin sonuçları korunur ve cevap anahtarı değiştiğinde tüm
         * sınav bu arşivden yeniden puanlanabilir.
         */
        sheets: mergeAnswerSheets(blueprint.sheets ?? [], outcome.sheets),
        results: [
          ...blueprint.results.filter((r) => r.fileName !== sourceName),
          {
            fileName: sourceName,
            uploadedAt: new Date().toISOString(),
            studentCount: outcome.studentCount,
          },
        ],
        updatedAt: new Date().toISOString(),
      };
      const nextSetup: ExamSetupData = {
        ...setup,
        blueprints: setup.blueprints.map((b) => (b.id === blueprint.id ? stamped : b)),
      };
      setSetup(nextSetup);
      await persistSetup(nextSetup);
      setLastResult({
        blueprint: stamped,
        record: outcome.record,
        warnings: outcome.warnings,
      });
    },
    [setup],
  );

  /**
   * Cevap kâğıdı arşivini günceller ve anında kalıcı olarak kaydeder.
   *
   * Düzeltme işi (eksik öğrenci ekleme, hatalı şık düzeltme, kâğıt silme)
   * kaydedilmeden kaybolmamalı; bu yüzden her değişiklik doğrudan kurguya
   * yazılıyor. Sonuçlar ise ancak “yeniden hesapla” çağrıldığında değişir,
   * böylece yarım kalan düzeltme analiz ekranını bozmaz.
   */
  const updateSheets = useCallback(
    async (sheets: ExamAnswerSheet[]) => {
      if (!active) return;
      const stamped: ExamBlueprint = {
        ...active,
        sheets,
        updatedAt: new Date().toISOString(),
      };
      const next: ExamSetupData = {
        ...setup,
        blueprints: setup.blueprints.map((b) => (b.id === active.id ? stamped : b)),
      };
      setSetup(next);
      await persistSetup(next);
    },
    [active, setup],
  );

  /**
   * Kâğıtlar için kayıtlı öğrenci listesini ve eşleştirme satırlarını hazırlar.
   * NEDEN ortak: yeni yükleme ve dosya değiştirme aynı onay penceresinden geçer.
   */
  const prepareMatch = async (sheets: AnswerSheet[]) => {
    /*
      NEDEN öğrenci kayıtları önce: "öğrenci kaydındaki sınıf" seçildiğinde
      sınıf, eski sınav sonuçlarından değil Öğrenciler sayfasındaki kayıttan
      gelmelidir. Kaydı olmayan ama daha önce sınava girmiş öğrenciler eklenir.
    */
    const roster: RosterStudent[] = [];
    const seen = new Set<string>();
    try {
      (await fetchStudentRecords()).forEach((r) => {
        const key = foldName(r.full_name);
        if (!key || seen.has(key)) return;
        seen.add(key);
        roster.push({ name: r.full_name, className: (r.class_name || '').trim() });
      });
    } catch {
      /* kayıt okunamazsa sınav listesiyle devam */
    }
    try {
      (await fetchStudentList()).forEach((s) => {
        const key = foldName(s.name);
        if (!key || seen.has(key)) return;
        seen.add(key);
        roster.push({ name: s.name, className: s.className });
      });
    } catch {
      /* liste okunamazsa kayıtlarla devam */
    }
    const rows: MatchRow[] = sheets.map((sheet) => {
      const matched = matchStudent(sheet.name, sheet.className, roster);
      return {
        original: sheet.name,
        className: sheet.className,
        matched,
        suggestions: matched ? [] : suggestStudents(sheet.name, sheet.className, roster),
      };
    });
    return { rows, roster };
  };

  const uploadResult = async (file: File) => {
    if (!active) return;
    if (!progress.ready) {
      toast.error('Önce tüm soruların cevap anahtarını tamamlayın.');
      return;
    }
    setUploading(true);
    try {
      const text = await readResultText(file);
      const parsed = parseAnswerSheets(text, active.questions.length);
      if (!parsed.sheets.length) {
        toast.error('Dosyadan öğrenci sonucu okunamadı. Cevap dizisi uzunluğunu kontrol edin.');
        return;
      }
      const { rows, roster } = await prepareMatch(parsed.sheets);
      setPendingMatch({ file, sheets: parsed.sheets, warnings: parsed.warnings, rows, roster });
    } catch {
      toast.error('Sonuç dosyası işlenemedi.');
    } finally {
      setUploading(false);
    }
  };

  /** Eşleştirme onaylanınca adları uygulayıp sonuçları işler. */
  const confirmMatch = async (finalRows: { name: string; className: string }[]) => {
    const pending = pendingMatch;
    if (!pending || !active) return;
    setPendingMatch(null);
    setUploading(true);
    try {
      const sheets = pending.sheets.map((sheet, i) => ({
        ...sheet,
        name: finalRows[i]?.name || sheet.name,
        className: finalRows[i]?.className || sheet.className,
      }));
      if (pending.replaceTarget) {
        await applyReplace(pending.replaceTarget, pending.file.name, sheets, pending.warnings);
        return;
      }
      const outcome = await ingestParsedSheets(active, sheets, pending.file.name, pending.warnings);
      toast.success(`${outcome.studentCount} öğrencinin sonucu analiz edildi.`);
      await stampResult(active, pending.file.name, outcome);
      setResultsOpen(true);
    } catch {
      toast.error('Sonuç dosyası işlenemedi.');
    } finally {
      setUploading(false);
    }
  };

  /**
   * Sınav kurgusunu doğrudan yazar.
   *
   * Dosya değiştirme ve silme işlemlerinde sonuç listesi elle kurulduğu için
   * `stampResult` kullanılamaz: aksi hâlde listeye “yeniden hesaplandı” gibi
   * sahte bir dosya satırı eklenirdi.
   */
  const applyBlueprint = useCallback(
    async (blueprint: ExamBlueprint, outcome: IngestResultOutcome | null) => {
      const next: ExamSetupData = {
        ...setup,
        blueprints: setup.blueprints.map((b) => (b.id === blueprint.id ? blueprint : b)),
      };
      setSetup(next);
      await persistSetup(next);
      setLastResult(
        outcome
          ? { blueprint, record: outcome.record, warnings: outcome.warnings }
          : null,
      );
    },
    [setup],
  );

  /**
   * Yüklenmiş bir optik sonuç dosyasını başka bir dosyayla değiştirir.
   *
   * Eski dosyadan gelen cevap kâğıtları arşivden çıkarılır, yeni dosyanın
   * kâğıtları eklenir ve sınav tüm arşivden yeniden puanlanır. Böylece yanlış
   * sınıf dosyası yüklendiğinde sınavı sıfırdan kurmak gerekmez ve aynı öğrenci
   * iki kez listelenmez.
   */
  const replaceResultFile = async (targetName: string, file: File) => {
    if (!active) return;
    if (!progress.ready) {
      toast.error('Önce tüm soruların cevap anahtarını tamamlayın.');
      return;
    }
    setBusyFile(targetName);
    try {
      const text = await readResultText(file);
      const parsed = parseAnswerSheets(text, active.questions.length);
      if (!parsed.sheets.length) {
        toast.error('Yeni dosyadan öğrenci sonucu okunamadı. Dosya değiştirilmedi.');
        return;
      }
      // NEDEN: dosya değiştirirken de ad eşleştirme ve sınıf kaynağı sorulur.
      const { rows, roster } = await prepareMatch(parsed.sheets);
      setPendingMatch({
        file,
        sheets: parsed.sheets,
        warnings: parsed.warnings,
        rows,
        roster,
        replaceTarget: targetName,
      });
    } catch {
      toast.error('Sonuç dosyası değiştirilemedi.');
    } finally {
      setBusyFile('');
      replaceTargetRef.current = '';
    }
  };

  /** Onaylanan kâğıtlarla eski dosyayı değiştirir ve sınavı yeniden puanlar. */
  const applyReplace = async (
    targetName: string,
    fileName: string,
    sheets: AnswerSheet[],
    warnings: string[],
  ) => {
    if (!active) return;
    setBusyFile(targetName);
    try {
      const kept = (active.sheets ?? []).filter((s) => (s.source ?? '') !== targetName);
      const merged = mergeAnswerSheets(
        kept,
        sheets.map((sheet) => toArchivedSheet(sheet, fileName)),
      );
      const updated: ExamBlueprint = {
        ...active,
        sheets: merged,
        results: [
          ...active.results.filter((r) => r.fileName !== targetName && r.fileName !== fileName),
          { fileName, uploadedAt: new Date().toISOString(), studentCount: sheets.length },
        ],
        updatedAt: new Date().toISOString(),
      };
      if (fileName !== targetName) forgetResultFile(targetName);
      const outcome = await rescoreBlueprint(updated);
      await applyBlueprint(updated, outcome);
      warnings.forEach((w) => toast.warning(w));
      toast.success(`“${targetName}” yerine “${fileName}” yüklendi; ${sheets.length} öğrenci yeniden puanlandı.`);
    } catch {
      toast.error('Sonuç dosyası değiştirilemedi.');
    } finally {
      setBusyFile('');
    }
  };

  /**
   * Tek bir optik sonuç dosyasını ve ondan gelen sonuçları siler.
   *
   * Geriye başka dosya kalırsa sınav kalan kâğıtlardan yeniden puanlanır; son
   * dosya da silinirse sınav kaydı analiz panelinden tamamen kaldırılır, aksi
   * hâlde öğrencisiz boş bir deneme görünürdü.
   */
  const removeResultFile = async (targetName: string) => {
    if (!active) return;
    const confirmed = window.confirm(
      `“${targetName}” dosyasından gelen sonuçlar silinecek. Devam edilsin mi?`,
    );
    if (!confirmed) return;

    setBusyFile(targetName);
    try {
      const remainingResults = active.results.filter((r) => r.fileName !== targetName);
      forgetResultFile(targetName);

      if (!remainingResults.length) {
        const drop = await dropExamRecord(active);
        await applyBlueprint(
          { ...active, sheets: [], results: [], updatedAt: new Date().toISOString() },
          null,
        );
        /*
          Sınavın kaydı sunucudan düşmediyse diğer hesaplar (öğretmen, veli,
          öğrenci, rehber öğretmen) sınavı görmeye devam eder; bu yüzden
          başarısızlıkta "silindi" denmez.
        */
        if (drop.synced) {
          toast.success(`“${targetName}” silindi; bu sınavın sonuçları temizlendi.`);
        } else {
          toast.error(
            drop.message ??
              `“${targetName}” bu cihazdan silindi, ancak sınav kaydı sunucudan kaldırılamadı. Bağlantı düzelince otomatik yeniden denenecek.`,
          );
        }
        return;
      }

      const trimmed: ExamBlueprint = {
        ...active,
        sheets: (active.sheets ?? []).filter((s) => (s.source ?? '') !== targetName),
        results: remainingResults,
        updatedAt: new Date().toISOString(),
      };
      const outcome = await rescoreBlueprint(trimmed);
      await applyBlueprint(trimmed, outcome);
      toast.success(
        `“${targetName}” silindi; kalan ${outcome.studentCount} öğrenci yeniden puanlandı.`,
      );
    } catch {
      toast.error('Sonuç dosyası silinemedi.');
    } finally {
      setBusyFile('');
    }
  };

  if (!allowed) {
    return (
      <div className="rounded-2xl border border-dashed bg-card px-4 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          Bu ekran için “Sınav kurgusu ve sonuç üretimi” yetkisi gerekiyor. Kurum yöneticinizden
          yetki talep edebilirsiniz.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-extrabold">Sınav bölümü</h1>
        <Button type="button" size="sm" onClick={save} disabled={saving}>
          {saving ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="mr-1 h-3.5 w-3.5" />
          )}
          Kurguyu kaydet
        </Button>
      </div>

      {catalogError ? (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800">
          <span className="mr-auto">
            Konu kataloğu okunamadı, dersler elle girilen listeden geliyor. ({catalogError})
          </span>
          <Button type="button" size="sm" variant="secondary" onClick={() => void reloadCatalog(true)}>
            Kataloğu yenile
          </Button>
        </div>
      ) : (
        <p className="text-[11px] font-semibold text-muted-foreground">
          Konu kataloğu yüklü: {topicRows.length} satır · {classOptions.length} sınıf ·{' '}
          {active?.className
            ? `“${active.className}” sınıfı için ${subjectOptions.length} ders`
            : 'sınıf seçince dersler daralır'}
        </p>
      )}

      <CollapsibleSection
        title="Hazır sınav modları"
        storageKey="exams.presets"
        className="space-y-0"
        bodyClassName="space-y-3"
      >
        <div>
          <p className="text-[11px] text-muted-foreground">
            Bir mod seçtiğinizde ders dağılımı, soru sayıları, yanlış götürme oranı, ders
            katsayıları ve o sınıfın konuları otomatik kurulur; soru listesi de hazır gelir.
            Sonuç dosyası yüklendiğinde puan şu zincirle hesaplanır: <strong>ham net</strong>{' '}
            (doğru − yanlış / götürme) → grup ortalaması → standart sapma →{' '}
            <strong>Z puanı</strong> → <strong>standart puan (50 + 10·Z)</strong> → ders katsayısı
            → ağırlıklı toplam → ölçeklenmiş sınav puanı.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {modes.map((preset) => {
            const total = preset.subjects.reduce((sum, s) => sum + s.questions, 0);
            return (
              <div key={preset.id} className="relative">
                <button
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className="h-full w-full rounded-xl border bg-background p-3 text-left transition hover:border-primary hover:bg-muted/50"
                >
                  <span className="flex items-center gap-1.5 pr-7 text-sm font-extrabold">
                    <Wand2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                    {preset.name}
                  </span>
                  {preset.custom && (
                    <span className="mt-1 inline-block rounded-full border border-primary/40 px-2 py-0.5 text-[10px] font-extrabold text-primary">
                      Kurum şablonu
                    </span>
                  )}
                  <span className="mt-1 block text-[11px] font-bold text-primary">
                    {preset.subjects.length} ders · {total} soru ·{' '}
                    {preset.penalty > 0 ? `${preset.penalty} yanlış = 1 doğru` : 'ceza yok'} ·{' '}
                    {preset.scaleMin}-{preset.scaleMax} puan
                  </span>
                  <span className="mt-1 block text-[11px] text-muted-foreground">{preset.note}</span>
                  <span className="mt-1.5 block text-[11px] text-muted-foreground">
                    {preset.subjects
                      .map((s) => `${s.subject} ${s.questions} (×${s.coefficient})`)
                      .join(' · ')}
                  </span>
                </button>

                {preset.custom && (
                  <button
                    type="button"
                    aria-label={`${preset.name} şablonunu sil`}
                    title="Şablonu sil"
                    className="absolute right-2 top-2 rounded-full p-1 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => void removeTemplate(preset)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <ExamTemplateBuilder
          setup={setup}
          subjectOptions={subjectOptions}
          sectionOptions={sectionOptions}
          classOptions={classOptions}
          onCreate={addTemplate}
        />
      </CollapsibleSection>

      <CollapsibleSection
        title="Sınavlar"
        storageKey="exams.list"
        badge={`${setup.blueprints.length} sınav`}
        actions={
          <Button type="button" size="sm" variant="secondary" onClick={createBlueprint}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Yeni sınav
          </Button>
        }
      >
        <div className="flex flex-wrap gap-1.5">
          {setup.blueprints.length === 0 && (
            <span className="text-xs text-muted-foreground">
              Henüz sınav tanımlanmadı. “Yeni sınav” ile başlayın.
            </span>
          )}
          {setup.blueprints.map((b) => {
            const isActive = b.id === activeId;
            return (
              <span
                key={b.id}
                className={`inline-flex items-center gap-1 rounded-full border pl-3 pr-1 py-1 text-[11px] font-bold transition ${
                  isActive
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'bg-background hover:bg-muted'
                }`}
              >
                <button type="button" onClick={() => setActiveId(b.id)}>
                  {b.name}
                </button>
                <button
                  type="button"
                  aria-label={`${b.name} sınavını sil`}
                  title="Sınavı sil"
                  className={`rounded-full p-0.5 transition ${
                    isActive
                      ? 'text-primary-foreground/80 hover:bg-primary-foreground/20 hover:text-primary-foreground'
                      : 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
                  }`}
                  onClick={() => void removeBlueprint(b.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>
            );
          })}
        </div>
      </CollapsibleSection>

      {active && (
        <>
          <section className="space-y-4 rounded-2xl border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="mr-auto text-sm font-extrabold">Sınav bilgileri</h2>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void saveActiveAsTemplate()}
              >
                <Wand2 className="mr-1 h-3.5 w-3.5" />
                Şablon olarak kaydet
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="!bg-transparent !hover:bg-transparent text-destructive"
                onClick={() => void removeBlueprint(active.id)}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                Bu sınavı sil
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
              <div className="space-y-1 lg:col-span-2">
                <Label className="text-[11px]">Sınav adı</Label>
                <Input
                  value={active.name}
                  className="h-9"
                  onChange={(e) => patchActive({ name: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Bölüm</Label>
                <select
                  value={active.section}
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  onChange={(e) =>
                    /*
                      Bölüm değiştirmek mod seçimini de değiştirir: kurgu bir
                      şablona bağlıysa bağ kaldırılır ve sınav bölüm adıyla
                      listelenir. Bağ "kaldırıldı" olarak işaretlenir ki
                      otomatik onarım bu bilinçli kararı geri almasın.
                    */
                    patchActive({
                      section: e.target.value,
                      presetId: undefined,
                      presetLinkCleared: e.target.value ? true : undefined,
                    })
                  }
                >
                  <option value="">—</option>
                  {sectionOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Sınıf (ders ve konuları belirler)</Label>
                <select
                  value={active.className}
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  onChange={(e) => changeClass(e.target.value)}
                >
                  <option value="">—</option>
                  {classOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Tarih</Label>
                <Input
                  type="date"
                  value={active.date ?? ''}
                  className="h-9"
                  onChange={(e) => patchActive({ date: e.target.value })}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-[11px]">Ders planı (soru sayıları)</Label>
                <SubjectPlanEditor
                  subjects={active.subjects}
                  options={subjectOptions}
                  topicRows={topicRows}
                  className={active.className}
                  onChange={(next) => patchActive({ subjects: next })}
                />
                <p className="text-[11px] text-muted-foreground">
                  Ders listesi seçtiğiniz <strong>sınıfa</strong> göre konu kataloğundan gelir
                  ({subjectOptions.length} ders). Ders eklediğinizde o sınıfın o dersteki tüm
                  konuları seçilebilir olur; konu seçmezseniz soru satırlarında yine dersin
                  tüm konuları listelenir.
                </p>
              </div>
              <div className="space-y-2">
                <Label className="text-[11px]">Kaç yanlış bir doğruyu götürür</Label>
                <Input
                  type="number"
                  min={0}
                  max={10}
                  value={active.penalty}
                  className="h-9 w-24"
                  onChange={(e) => patchActive({ penalty: Math.max(0, Number(e.target.value) || 0) })}
                />
                <p className="text-[11px] text-muted-foreground">
                  0 girilirse net = doğru sayısı olarak hesaplanır (LGS için 3 önerilir).
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (!active.subjects.length) {
                      toast.error('Önce ders planı ekleyin.');
                      return;
                    }
                    patchActive({
                      questions: buildQuestionRows(active.subjects, active.questions),
                    });
                    toast.success('Soru listesi oluşturuldu.');
                  }}
                >
                  <FileSpreadsheet className="mr-1 h-3.5 w-3.5" />
                  Soru listesini oluştur
                </Button>

                <div className="space-y-1 border-t pt-3">
                  <Label className="text-[11px]">Analiz filtresindeki sınav modu</Label>
                  <select
                    value={active.presetId ?? ''}
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    onChange={(e) =>
                      /*
                        Şablon seçildiğinde sınav sonucu bu modun altında listelenir;
                        "Bağlı değil" seçildiğinde bölüm adı kullanılır ve bağın
                        bilinçli kaldırıldığı işaretlenir.
                      */
                      patchActive({
                        presetId: e.target.value || undefined,
                        presetLinkCleared: e.target.value ? undefined : true,
                      })
                    }
                  >
                    <option value="">Bağlı değil (bölüm adı kullanılır)</option>
                    {modes.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                        {m.custom ? ' (kurum şablonu)' : ''}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-muted-foreground">
                    Sonuçların analiz filtresinde hangi mod altında görüneceğini belirler.
                    Şablon kartına tıklayarak kurulan sınavlarda bu bağ otomatik kurulur.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-3 rounded-2xl border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="mr-auto text-sm font-extrabold">Konu ve cevap anahtarı</h2>
              <span className="rounded-full border px-2.5 py-1 text-[11px] font-bold">
                {progress.withAnswer}/{progress.total} cevap
              </span>
              <span className="rounded-full border px-2.5 py-1 text-[11px] font-bold">
                {progress.withTopic}/{progress.total} konu
              </span>
              {progress.ready && (
                <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold text-emerald-600">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Hazır
                </span>
              )}
            </div>

            {/* Cevap anahtarı Excel ile dışa aktarılır, doldurulup geri yüklenebilir. */}
            <ExcelToolbar
              compact
              fileName={`cevap-anahtari-${(active.name || 'sinav')
                .toLocaleLowerCase('tr-TR')
                .replace(/[^a-z0-9]+/gi, '-')
                .replace(/^-+|-+$/g, '') || 'sinav'}`}
              expectedHeaders={EXAM_KEY_HEADERS}
              /*
               * Şablon sınav türüne özgü üretilir: yalnızca bu sınavın dersleri,
               * bu sınavın soru numaraları ve derslerin sınava giren konuları
               * yazılır. Böylece LGS şablonunda TYT/KPSS dersleri görünmez ve
               * kullanıcı sadece konu + cevap kolonlarını doldurur.
               */
              buildTemplateSheets={() =>
                examTemplateSheets({
                  examName: active.name,
                  examDate: active.date,
                  className: active.className,
                  section: active.section,
                  subjects: active.subjects.map((plan) => ({
                    subject: plan.subject,
                    questionCount: plan.questions,
                    // Havuz boşsa dersin sınıfa uygun katalog konuları yazılır.
                    topics: subjectTopicPool(active.subjects, plan.subject).length
                      ? subjectTopicPool(active.subjects, plan.subject)
                      : catalogTopics(topicRows, plan.subject, undefined, active.className),
                  })),
                  questions: active.questions.map((q) => ({
                    no: q.no,
                    subject: q.subject,
                    topics: q.topics,
                    answer: q.answer,
                  })),
                  allowedAnswers: ANSWER_OPTIONS,
                })
              }
              canImport
              buildSheets={() => [
                examKeySheet(
                  'Cevap Anahtarı',
                  active.questions.map((q) => ({
                    no: q.no,
                    subject: q.subject,
                    topics: q.topics,
                    answer: q.answer,
                  })),
                ),
              ]}
              onImport={async (sheet) => {
                const current = active.questions.map((q) => ({
                  no: q.no,
                  subject: q.subject,
                  topics: q.topics,
                  answer: q.answer,
                }));
                const { rows, outcome } = readExamKey(sheet, current, ANSWER_OPTIONS);
                // Var olan soru satırlarının diğer alanları korunur, anahtar güncellenir.
                const byNo = new Map(active.questions.map((q) => [q.no, q]));
                patchActive({
                  questions: rows.map((row) => {
                    const existing = byNo.get(row.no);
                    return existing
                      ? { ...existing, subject: row.subject, topics: row.topics, answer: row.answer }
                      : { no: row.no, subject: row.subject, topics: row.topics, answer: row.answer };
                  }),
                });
                return outcome;
              }}
            />

            {active.questions.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Ders planını girip “Soru listesini oluştur” düğmesine basın.
              </p>
            ) : (
              <div className="max-h-[26rem] overflow-auto rounded-xl border">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-muted/80 text-[11px] uppercase">
                    <tr>
                      <th className="px-3 py-2">Soru</th>
                      <th className="px-3 py-2">Ders</th>
                      <th className="px-3 py-2">Konu</th>
                      <th className="px-3 py-2">Cevap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.questions.map((question, index) => {
                      const pool = subjectTopicPool(active.subjects, question.subject);
                      const catalog = catalogTopics(
                        topicRows,
                        question.subject,
                        undefined,
                        active.className,
                      );
                      // Ders planında havuz seçildiyse önce o konular gelir; ardından
                      // dersin kalan tüm katalog konuları da seçilebilir kalır.
                      const topics = pool.length
                        ? [...pool, ...catalog.filter((t) => !pool.includes(t))]
                        : catalog;
                      return (
                        <tr key={question.no} className="border-t align-top">
                          <td className="px-3 py-1.5 font-bold">{question.no}</td>
                          <td className="px-3 py-1.5 text-xs">{question.subject}</td>
                          <td className="min-w-[16rem] px-3 py-1.5">
                            <TopicMultiSelect
                              dense
                              options={topics}
                              selected={question.topics}
                              placeholder="Konu seçin (çoklu)"
                              emptyHint="Ders planında konu seçilmedi."
                              onChange={(next) => {
                                const rows = [...active.questions];
                                rows[index] = { ...question, topics: next };
                                patchActive({ questions: rows });
                              }}
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <div className="flex gap-1">
                              {ANSWER_OPTIONS.map((option) => (
                                <button
                                  key={option}
                                  type="button"
                                  onClick={() => {
                                    const next = [...active.questions];
                                    next[index] = {
                                      ...question,
                                      answer: question.answer === option ? '' : option,
                                    };
                                    patchActive({ questions: next });
                                  }}
                                  className={`h-7 w-7 rounded-md border text-[11px] font-extrabold transition ${
                                    question.answer === option
                                      ? 'border-primary bg-primary text-primary-foreground'
                                      : 'bg-background hover:bg-muted'
                                  }`}
                                >
                                  {option}
                                </button>
                              ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <ManualResultEntry
            blueprint={active}
            ready={progress.ready}
            onSaved={(outcome) => stampResult(active, `${active.name} — elle giriş`, outcome)}
          />

          {/*
            Sonradan düzeltme: cevap anahtarı değişirse veya bir öğrenci sonuç
            listesine hiç girilmemişse tüm sınav yeniden girilmeden düzeltilir.
          */}
          <ExamSheetManager
            blueprint={active}
            ready={progress.ready}
            onChangeSheets={updateSheets}
            onRescored={(outcome) =>
              stampResult(active, `${active.name} — yeniden hesaplandı`, outcome)
            }
          />

          <section className="space-y-3 rounded-2xl border bg-card p-4">
            <h2 className="text-sm font-extrabold">Optik sonuç dosyası (txt)</h2>
            <p className="text-xs text-muted-foreground">
              Her satırda öğrenci bilgisi ve {active.questions.length || '—'} karakterlik cevap
              dizisi bulunmalıdır. Boş bırakılan sorular için boşluk, nokta veya tire kullanılabilir.
              Dosya yüklendiğinde sonuçlar otomatik analiz edilir ve analiz panelinde görünür.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => resultRef.current?.click()}
                disabled={uploading || !progress.ready}
              >
                {uploading ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="mr-1 h-3.5 w-3.5" />
                )}
                Sonuç dosyası yükle
              </Button>
              <ResultMatchDialog
                open={Boolean(pendingMatch)}
                rows={pendingMatch?.rows ?? []}
                roster={pendingMatch?.roster ?? []}
                onCancel={() => setPendingMatch(null)}
                onConfirm={(r) => void confirmMatch(r)}
              />
              <input
                ref={resultRef}
                type="file"
                accept=".txt,.csv,.dat"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadResult(file);
                  e.target.value = '';
                }}
              />
              {/* Değiştirme için gizli dosya seçici; hedef dosya adı ref'te tutulur. */}
              <input
                ref={replaceRef}
                type="file"
                accept=".txt,.csv,.dat"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  const target = replaceTargetRef.current;
                  if (file && target) void replaceResultFile(target, file);
                  e.target.value = '';
                }}
              />
              {active.results.length > 0 && (
                <button
                  type="button"
                  aria-expanded={resultsOpen}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-bold text-muted-foreground transition hover:bg-muted"
                  onClick={() => setResultsOpen((v) => !v)}
                >
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${resultsOpen ? 'rotate-180' : ''}`}
                  />
                  Yüklenen dosyalar ({active.results.length})
                </button>
              )}
              {!progress.ready && (
                <span className="text-[11px] text-muted-foreground">
                  Yükleme için cevap anahtarı tamamlanmalı.
                </span>
              )}
            </div>

            {resultsOpen && active.results.length > 0 && (
              <ul className="space-y-1.5">
                {active.results.map((r) => {
                  const busy = busyFile === r.fileName;
                  return (
                    <li
                      key={`${r.fileName}-${r.uploadedAt}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-background/60 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-foreground">{r.fileName}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {r.studentCount} öğrenci
                          {r.uploadedAt ? ` • ${formatUploadedAt(r.uploadedAt)}` : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy || uploading || !progress.ready}
                          onClick={() => {
                            replaceTargetRef.current = r.fileName;
                            replaceRef.current?.click();
                          }}
                        >
                          {busy ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="mr-1 h-3.5 w-3.5" />
                          )}
                          Değiştir
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="!bg-transparent !hover:bg-transparent text-destructive"
                          disabled={busy || uploading}
                          onClick={() => void removeResultFile(r.fileName)}
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" />
                          Sil
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {lastResult && lastResult.blueprint.id === active.id && (
              <div className="space-y-2 rounded-xl border bg-muted/40 p-3">
                <p className="text-sm font-bold">
                  {lastResult.record.students.length} öğrenci analiz edildi.
                </p>
                {lastResult.warnings.map((w) => (
                  <p key={w} className="text-[11px] text-amber-600">
                    {w}
                  </p>
                ))}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="secondary" onClick={() => navigate('/analiz')}>
                    <BarChart3 className="mr-1 h-3.5 w-3.5" />
                    Analiz panelini aç
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => exportResultWorkbook(lastResult.blueprint, lastResult.record)}
                  >
                    <Download className="mr-1 h-3.5 w-3.5" />
                    Analiz Excel'i indir
                  </Button>
                </div>
              </div>
            )}
          </section>
        </>
      )}

      <PageGuide storageKey="sinavlar" {...EXAM_GUIDE} />
    </div>
  );
}

export default function ExamSetupPage() {
  return (
    <SiteLayout requireAuth wide>
      <ExamSetupBody />
    </SiteLayout>
  );
}