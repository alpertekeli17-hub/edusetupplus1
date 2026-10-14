/**
 * Online ders sayfası.
 *
 * - Ders açma (yetki: `manage_online_lessons` — rehber öğretmen ve yönetici):
 *   bir öğretmen, ders ve konu(lar) seçilir; tarih aralığı + haftanın günleri +
 *   saat aralığı verilir; seçilen öğrenciler derse eklenir. Aralık ve günler
 *   birden fazla tarihe düşüyorsa her tarih için ayrı ders oturumu oluşur.
 * - Katılım: ders kartında her öğrenci "katıldı / katılmadı" olarak işaretlenir,
 *   ders "tamamlandı" veya "iptal" durumuna alınabilir.
 * - Öğrenci / veli: yalnızca kendisine (çocuğuna) atanmış dersleri ve katılım
 *   bağlantısını görür; sorgu giriş e-postasıyla daraltıldığı için başka
 *   öğrencilerin kaydı hiç indirilmez.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarPlus,
  Check,
  ExternalLink,
  Loader2,
  Radio,
  Trash2,
  Users,
  Video,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import SiteLayout, { useSession } from '@/components/SiteLayout';
import PageGuide from '@/components/PageGuide';
import { ONLINE_LESSON_GUIDE } from '@/lib/pageGuides';
import { useLinkedStudents } from '@/hooks/use-linked-students';
import LiveLessonRoom from '@/components/LiveLessonRoom';
import TopicMultiSelect from '@/components/TopicMultiSelect';
import { pullScheduler } from '@/lib/cloud';
import { errorMessage, formatDateShort } from '@/lib/site';
import { fetchMemberships } from '@/lib/tenant';
import { fetchStudentRecords, scopeRecordsToSchool, type StudentRecord } from '@/lib/students';
import { loadTeachers } from '@/scheduler/lib/store';
import {
  catalogSubjects,
  catalogTopics,
  loadTopicCatalog,
  type TopicRow,
} from '@/lib/topics';
import {
  JOIN_STATE_LABELS,
  JOIN_STATE_TONES,
  JOIN_STATES,
  LESSON_PLATFORMS,
  LESSON_STATUS_LABELS,
  LESSON_STATUS_TONES,
  LIVE_PLATFORM,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT,
  createLessons,
  deleteLesson,
  expandDates,
  fetchLessons,
  fetchLessonsForViewer,
  fetchParticipants,
  filterLessonsForTeacher,
  isUpcoming,
  joinParticipants,
  joinStateOf,
  lessonStatusOf,
  liveRoomName,
  minutesOf,
  scopeLessonsToSchool,
  setJoinState,
  setLessonStatus,
  todayKey,
  topicList,
  usesLiveRoom,
  weekdayIndex,
  type JoinState,
  type LessonDraft,
  type LessonParticipant,
  type LessonStatus,
  type LessonWithPeople,
  type OnlineLesson,
} from '@/lib/onlineLessons';

/* -------------------------------- Parçacıklar ------------------------------- */

function StatusChip({ status }: { status: LessonStatus }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${LESSON_STATUS_TONES[status]}`}>
      {LESSON_STATUS_LABELS[status]}
    </span>
  );
}

function JoinChip({ state }: { state: JoinState }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${JOIN_STATE_TONES[state]}`}>
      {JOIN_STATE_LABELS[state]}
    </span>
  );
}

/** Derse katılacak öğrencilerin sınıf sınıf seçildiği panel. */
function StudentPicker({
  records,
  selected,
  onChange,
}: {
  records: StudentRecord[];
  selected: number[];
  onChange: (next: number[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [classFilter, setClassFilter] = useState('');

  const classes = useMemo(
    () => [...new Set(records.map((r) => r.class_name).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, 'tr'),
    ),
    [records],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr');
    return records.filter((r) => {
      if (classFilter && r.class_name !== classFilter) return false;
      if (!q) return true;
      return `${r.full_name} ${r.class_name}`.toLocaleLowerCase('tr').includes(q);
    });
  }, [records, query, classFilter]);

  const chosen = new Set(selected);
  const toggle = (id: number) =>
    onChange(chosen.has(id) ? selected.filter((s) => s !== id) : [...selected, id]);

  return (
    <div className="space-y-2 rounded-xl border bg-muted/30 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[8rem] flex-1 space-y-1">
          <Label htmlFor="ol-student-search" className="text-xs">
            Öğrenci ara
          </Label>
          <Input
            id="ol-student-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ad veya sınıf"
            className="h-9"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ol-class-filter" className="text-xs">
            Sınıf
          </Label>
          <select
            id="ol-class-filter"
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="">Tümü</option>
            {classes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange([...new Set([...selected, ...visible.map((r) => r.id)])])}
          >
            Görünenleri ekle
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => onChange([])}>
            Temizle
          </Button>
        </div>
      </div>

      <p className="text-xs font-semibold text-muted-foreground">
        {selected.length} öğrenci seçildi · {visible.length} kayıt listeleniyor
      </p>

      <div className="max-h-56 space-y-1 overflow-auto rounded-lg border bg-background p-1">
        {visible.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            Kayıt defterinde uygun öğrenci bulunamadı.
          </p>
        )}
        {visible.map((record) => {
          const active = chosen.has(record.id);
          return (
            <button
              key={record.id}
              type="button"
              onClick={() => toggle(record.id)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-muted ${
                active ? 'font-bold' : ''
              }`}
            >
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                  active ? 'border-primary bg-primary text-primary-foreground' : 'bg-background'
                }`}
              >
                {active && <Check className="h-3 w-3" />}
              </span>
              <span className="flex-1 truncate">{record.full_name}</span>
              <span className="text-xs text-muted-foreground">{record.class_name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------- Ders açma formu ------------------------------ */

const EMPTY_DRAFT = {
  title: '',
  teacherName: '',
  subject: '',
  topics: [] as string[],
  className: '',
  fromDate: todayKey(),
  toDate: todayKey(),
  weekdays: [] as number[],
  startTime: '19:00',
  endTime: '20:00',
  meetingUrl: '',
  // Varsayılan: ders uygulama içindeki canlı ders odasında yapılır.
  platform: LIVE_PLATFORM,
  note: '',
};

function LessonForm({
  teachers,
  students,
  catalog,
  onCreated,
  createdBy,
  schoolId,
}: {
  teachers: string[];
  students: StudentRecord[];
  catalog: TopicRow[];
  onCreated: () => Promise<void>;
  createdBy?: string;
  schoolId?: number;
}) {
  const [form, setForm] = useState(EMPTY_DRAFT);
  const [selectedStudents, setSelectedStudents] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);

  const classes = useMemo(
    () => [...new Set(students.map((s) => s.class_name).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, 'tr'),
    ),
    [students],
  );

  // Dersler seçilen sınıfa göre daraltılır; sınıf boşsa katalogdaki tüm dersler.
  const subjects = useMemo(
    () => catalogSubjects(catalog, undefined, form.className || undefined),
    [catalog, form.className],
  );

  const topics = useMemo(
    () =>
      form.subject
        ? catalogTopics(catalog, form.subject, undefined, form.className || undefined)
        : [],
    [catalog, form.subject, form.className],
  );

  // Tarih aralığı + işaretli günlerden oluşacak gerçek ders tarihleri.
  const dates = useMemo(
    () =>
      expandDates({
        fromDate: form.fromDate,
        toDate: form.toDate || form.fromDate,
        weekdays: form.weekdays,
      }),
    [form.fromDate, form.toDate, form.weekdays],
  );

  const set = <K extends keyof typeof EMPTY_DRAFT>(key: K, value: (typeof EMPTY_DRAFT)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const toggleWeekday = (index: number) =>
    setForm((prev) => ({
      ...prev,
      weekdays: prev.weekdays.includes(index)
        ? prev.weekdays.filter((d) => d !== index)
        : [...prev.weekdays, index].sort((a, b) => a - b),
    }));

  const submit = async () => {
    if (!form.teacherName.trim()) {
      toast.error('Dersi verecek öğretmeni seçin.');
      return;
    }
    if (!form.subject.trim()) {
      toast.error('Ders seçin.');
      return;
    }
    if (!dates.length) {
      toast.error('Seçilen tarih aralığında ders günü bulunamadı.');
      return;
    }
    if (minutesOf(form.startTime) < 0 || minutesOf(form.endTime) < 0) {
      toast.error('Başlangıç ve bitiş saatini girin.');
      return;
    }
    if (minutesOf(form.endTime) <= minutesOf(form.startTime)) {
      toast.error('Bitiş saati başlangıç saatinden sonra olmalı.');
      return;
    }
    if (!selectedStudents.length) {
      toast.error('Derse katılacak en az bir öğrenci seçin.');
      return;
    }

    const chosen = students.filter((s) => selectedStudents.includes(s.id));
    const draft: LessonDraft = {
      title: form.title.trim() || `${form.subject} online ders`,
      teacherName: form.teacherName,
      subject: form.subject,
      topics: form.topics,
      className: form.className,
      startTime: form.startTime,
      endTime: form.endTime,
      meetingUrl: form.meetingUrl,
      platform: form.platform,
      status: 'planlandi',
      note: form.note,
    };

    setBusy(true);
    try {
      await createLessons({ draft, dates, students: chosen, schoolId, createdBy });
      toast.success(
        dates.length > 1
          ? `${dates.length} online ders oluşturuldu (${chosen.length} öğrenci).`
          : `Online ders oluşturuldu (${chosen.length} öğrenci).`,
      );
      setForm({ ...EMPTY_DRAFT, teacherName: form.teacherName, platform: form.platform });
      setSelectedStudents([]);
      await onCreated();
    } catch (error) {
      toast.error(errorMessage(error, 'Online ders oluşturulamadı.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 rounded-2xl border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <CalendarPlus className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-sm font-extrabold">Yeni online ders</h2>
          <p className="text-xs text-muted-foreground">
            Öğretmen, ders ve konuyu seçin; günleri ve saat aralığını verin, öğrencileri ekleyin.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="ol-teacher">Öğretmen</Label>
          <select
            id="ol-teacher"
            value={form.teacherName}
            onChange={(e) => set('teacherName', e.target.value)}
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          >
            <option value="">Öğretmen seçin</option>
            {teachers.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ol-class">Sınıf (isteğe bağlı)</Label>
          <select
            id="ol-class"
            value={form.className}
            onChange={(e) => {
              set('className', e.target.value);
              set('topics', []);
            }}
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          >
            <option value="">Sınıf seçilmedi</option>
            {classes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ol-subject">Ders</Label>
          <select
            id="ol-subject"
            value={form.subject}
            onChange={(e) => {
              set('subject', e.target.value);
              set('topics', []);
            }}
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          >
            <option value="">Ders seçin</option>
            {subjects.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
          <Label>Konu(lar)</Label>
          <TopicMultiSelect
            options={topics}
            selected={form.topics}
            onChange={(next) => set('topics', next)}
            placeholder={form.subject ? 'Konu seçin' : 'Önce ders seçin'}
            emptyHint={
              form.subject
                ? 'Bu ders için konu listesi bulunamadı.'
                : 'Konuları görmek için ders seçin.'
            }
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ol-from">Başlangıç tarihi</Label>
          <Input
            id="ol-from"
            type="date"
            value={form.fromDate}
            onChange={(e) => {
              set('fromDate', e.target.value);
              if (!form.toDate || form.toDate < e.target.value) set('toDate', e.target.value);
            }}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ol-to">Bitiş tarihi</Label>
          <Input
            id="ol-to"
            type="date"
            value={form.toDate}
            min={form.fromDate}
            onChange={(e) => set('toDate', e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ol-title">Ders başlığı (isteğe bağlı)</Label>
          <Input
            id="ol-title"
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="Örn. Paragraf tekrar dersi"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ol-start">Başlangıç saati</Label>
          <Input
            id="ol-start"
            type="time"
            value={form.startTime}
            onChange={(e) => set('startTime', e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ol-end">Bitiş saati</Label>
          <Input
            id="ol-end"
            type="time"
            value={form.endTime}
            onChange={(e) => set('endTime', e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ol-platform">Platform</Label>
          <select
            id="ol-platform"
            value={form.platform}
            onChange={(e) => set('platform', e.target.value)}
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          >
            {LESSON_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ol-url">
            {form.platform === LIVE_PLATFORM ? 'Ders bağlantısı (gerekmiyor)' : 'Ders bağlantısı'}
          </Label>
          <Input
            id="ol-url"
            value={form.meetingUrl}
            onChange={(e) => set('meetingUrl', e.target.value)}
            disabled={form.platform === LIVE_PLATFORM}
            placeholder={
              form.platform === LIVE_PLATFORM ? 'Canlı ders uygulama içinde açılır' : 'https://...'
            }
          />
          {form.platform === LIVE_PLATFORM && (
            <p className="text-xs text-muted-foreground">
              Ders saatinde ders kartındaki "Canlı dersi başlat" düğmesiyle görüntülü ders uygulama
              içinde açılır; öğrenciler aynı odaya "Canlı derse katıl" ile girer.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ol-note">Not</Label>
          <Input
            id="ol-note"
            value={form.note}
            onChange={(e) => set('note', e.target.value)}
            placeholder="Öğrencilere kısa açıklama"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Haftanın günleri</Label>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAY_SHORT.map((label, index) => {
            const active = form.weekdays.includes(index);
            return (
              <button
                key={label}
                type="button"
                onClick={() => toggleWeekday(index)}
                title={WEEKDAY_LABELS[index]}
                className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'bg-background hover:bg-muted'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Gün seçilmezse aralıktaki her gün için ders açılır. Tek bir ders için başlangıç ve bitiş
          tarihini aynı verin.
        </p>
        {dates.length > 0 && (
          <p className="text-xs font-semibold text-primary">
            {dates.length} ders oluşacak · {formatDateShort(dates[0])}
            {dates.length > 1 ? ` – ${formatDateShort(dates[dates.length - 1])}` : ''} ·{' '}
            {form.startTime}–{form.endTime}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label>Derse katılacak öğrenciler</Label>
        <StudentPicker
          records={students}
          selected={selectedStudents}
          onChange={setSelectedStudents}
        />
      </div>

      <Button onClick={submit} disabled={busy} className="w-full sm:w-auto">
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Online dersi oluştur
      </Button>
    </div>
  );
}

/* ------------------------------- Ders kartı -------------------------------- */

function LessonCard({
  lesson,
  manage,
  viewerName,
  onChanged,
}: {
  lesson: LessonWithPeople;
  manage: boolean;
  /** Canlı ders odasında görünecek ad. */
  viewerName: string;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);
  const status = lessonStatusOf(lesson);
  const topics = topicList(lesson);
  // Harici bağlantı verilmemişse ders uygulama içi canlı odada yapılır.
  const liveRoom = usesLiveRoom(lesson);

  const run = async (task: () => Promise<void>, failure: string) => {
    setBusy(true);
    try {
      await task();
      await onChanged();
    } catch (error) {
      toast.error(errorMessage(error, failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-[12rem] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-extrabold">{lesson.title}</h3>
            <StatusChip status={status} />
            {isUpcoming(lesson) && status === 'planlandi' && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
                Yaklaşan
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatDateShort(lesson.lesson_date)} ·{' '}
            {WEEKDAY_LABELS[weekdayIndex(lesson.lesson_date)]} · {lesson.start_time}–
            {lesson.end_time}
          </p>
          <p className="mt-0.5 text-xs">
            <span className="font-semibold">{lesson.subject || 'Ders belirtilmedi'}</span>
            {lesson.teacher_name ? ` · ${lesson.teacher_name}` : ''}
            {lesson.class_name ? ` · ${lesson.class_name}` : ''}
            {lesson.platform ? ` · ${lesson.platform}` : ''}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {liveRoom ? (
            <Button
              size="sm"
              onClick={() => setLive(true)}
              disabled={status === 'iptal'}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              <Radio className="mr-1.5 h-3.5 w-3.5" />
              {manage ? 'Canlı dersi başlat' : 'Canlı derse katıl'}
            </Button>
          ) : (
            <a
              href={lesson.meeting_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-bold text-primary-foreground transition hover:opacity-90"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Derse katıl
            </a>
          )}
          {manage && (
            <>
              {status !== 'tamamlandi' && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => setLessonStatus(Number(lesson.id), 'tamamlandi'),
                      'Ders güncellenemedi.',
                    )
                  }
                >
                  Tamamlandı
                </Button>
              )}
              {status !== 'iptal' && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    run(() => setLessonStatus(Number(lesson.id), 'iptal'), 'Ders güncellenemedi.')
                  }
                >
                  İptal et
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => run(() => deleteLesson(Number(lesson.id)), 'Ders silinemedi.')}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>

      {live && (
        <LiveLessonRoom
          roomName={liveRoomName(lesson)}
          title={lesson.title}
          subtitle={`${formatDateShort(lesson.lesson_date)} · ${lesson.start_time}–${lesson.end_time}${
            lesson.teacher_name ? ` · ${lesson.teacher_name}` : ''
          }`}
          displayName={viewerName}
          moderator={manage}
          onClose={() => setLive(false)}
        />
      )}

      {topics.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {topics.map((topic) => (
            <span
              key={topic}
              className="rounded-full border bg-muted/60 px-2 py-0.5 text-[10px] font-bold"
            >
              {topic}
            </span>
          ))}
        </div>
      )}

      {lesson.note ? <p className="text-xs text-muted-foreground">{lesson.note}</p> : null}

      <div className="rounded-xl border">
        <div className="flex items-center gap-1.5 border-b px-3 py-2 text-xs font-extrabold">
          <Users className="h-3.5 w-3.5" />
          Katılımcılar ({lesson.people.length})
        </div>
        <div className="divide-y">
          {lesson.people.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              Bu derse öğrenci eklenmemiş.
            </p>
          )}
          {lesson.people.map((person) => {
            const state = joinStateOf(person);
            return (
              <div key={person.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className="flex-1 truncate font-semibold">{person.student_name}</span>
                <span className="text-xs text-muted-foreground">{person.class_name}</span>
                {manage ? (
                  <div className="flex gap-1">
                    {JOIN_STATES.map((option) => (
                      <button
                        key={option}
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          run(
                            () => setJoinState(Number(person.id), option),
                            'Katılım güncellenemedi.',
                          )
                        }
                        className={`rounded-full px-2 py-0.5 text-[11px] font-bold transition ${
                          state === option
                            ? JOIN_STATE_TONES[option]
                            : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        {JOIN_STATE_LABELS[option]}
                      </button>
                    ))}
                  </div>
                ) : (
                  <JoinChip state={state} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- Sayfa ---------------------------------- */

function OnlineLessonsContent() {
  const { can, member, account, role } = useSession();
  const manage = can('manage_online_lessons');
  /**
   * Öğretmen kolu.
   *
   * Neden ayrı bir kol: öğretmen `manage_online_lessons` yetkisine sahip olmadığı
   * için sayfa onu "izleyici" sayıyordu. İzleyici sorgusu katılımcı e-postasına
   * (öğrenci/veli) baktığından öğretmen **kendi açtığı ya da kendisine atanmış
   * dersi hiç göremiyordu**: ekranda "Yaklaşan online ders yok" yazdığı için
   * kusur sessizdi ve kimse "yetkim yok" demeden dersin yok olduğunu sanıyordu.
   */
  const teacherView = role === 'ogretmen' && !manage;
  const schoolId = member ? Number(member.school_id) : undefined;

  const [loading, setLoading] = useState(true);
  const [lessons, setLessons] = useState<OnlineLesson[]>([]);
  const [participants, setParticipants] = useState<LessonParticipant[]>([]);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [teachers, setTeachers] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<TopicRow[]>([]);
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');

  // Veli/öğrenci kolunda bağlı öğrenciler kayıt defterinden çözülür.
  const linked = useLinkedStudents({
    email: account?.email,
    schoolId,
    fallbackName: member?.student_name,
    enabled: !manage && !teacherView,
  });

  /**
   * Veli/öğrenci sorgusuna verilecek öğrenci adları.
   *
   * Katılımcı satırı ders açıldığı andaki e-postaları taşıyor; kayıt defterine
   * veli e-postası sonradan girildiğinde satırdaki alan boş kalıyor. Ad anahtarı
   * yalnız **bağlı** öğrencilerden türediği için yabancı öğrenci kapsama girmez.
   */
  const viewerNames = useMemo(() => {
    const names = linked.records.map((r) => r.full_name).filter(Boolean);
    if (names.length) return names;
    const fallback = (member?.student_name || '').trim();
    return fallback ? [fallback] : [];
  }, [linked.records, member?.student_name]);

  const loadLessons = useCallback(async () => {
    if (manage) {
      const rows = scopeLessonsToSchool(await fetchLessons(), schoolId);
      setLessons(rows);
      setParticipants(await fetchParticipants(rows.map((l) => Number(l.id))));
      return;
    }
    if (teacherView) {
      const rows = scopeLessonsToSchool(await fetchLessons(), schoolId);
      // Ders sayfası ile bildirim merkezi aynı eşleştirmeyi kullanır.
      const mine = filterLessonsForTeacher(rows, {
        name: account?.full_name,
        email: account?.email,
      });
      setLessons(mine);
      setParticipants(await fetchParticipants(mine.map((l) => Number(l.id))));
      return;
    }
    const viewer = await fetchLessonsForViewer({
      emails: [account?.email],
      names: viewerNames,
      nameKeys: linked.keys,
    });
    setLessons(viewer.lessons);
    setParticipants(viewer.participants);
  }, [
    manage,
    teacherView,
    schoolId,
    account?.email,
    account?.full_name,
    viewerNames,
    linked.keys,
  ]);

  useEffect(() => {
    let alive = true;
    const boot = async () => {
      setLoading(true);
      try {
        await loadLessons();
      } catch (error) {
        toast.error(errorMessage(error, 'Online dersler yüklenemedi.'));
      } finally {
        if (alive) setLoading(false);
      }

      if (!manage || !alive) return;

      // Ders açma formunun kaynakları: kayıt defteri, öğretmen listesi, konu kataloğu.
      try {
        const records = scopeRecordsToSchool(await fetchStudentRecords(), schoolId);
        if (alive) setStudents(records);
      } catch {
        /* kayıt defteri okunamazsa form yine açılır */
      }
      try {
        const rows = await loadTopicCatalog();
        if (alive) setCatalog(rows);
      } catch {
        /* katalog okunamazsa ders listesi boş kalır */
      }
      try {
        // Program öğretmenleri + kurum üyelikleri birlikte listelenir.
        await pullScheduler().catch(() => undefined);
        const names = new Set(loadTeachers().map((t) => t.name).filter(Boolean));
        const members = await fetchMemberships(schoolId).catch(() => []);
        members
          .filter((m) => m.role === 'ogretmen' || m.role === 'rehber')
          .forEach((m) => names.add(m.full_name || m.email));
        if (alive) setTeachers([...names].sort((a, b) => a.localeCompare(b, 'tr')));
      } catch {
        /* öğretmen listesi boş kalırsa form yine kullanılabilir */
      }
    };
    void boot();
    return () => {
      alive = false;
    };
  }, [loadLessons, manage, schoolId]);

  const merged = useMemo(() => joinParticipants(lessons, participants), [lessons, participants]);
  const upcoming = useMemo(
    () => merged.filter((l) => isUpcoming(l) && lessonStatusOf(l) !== 'iptal'),
    [merged],
  );
  const past = useMemo(
    () => merged.filter((l) => !isUpcoming(l) || lessonStatusOf(l) === 'iptal'),
    [merged],
  );
  const shown = tab === 'upcoming' ? upcoming : past;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Video className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h1 className="text-xl font-extrabold">Online ders</h1>
          <p className="text-sm text-muted-foreground">
            {manage
              ? 'Öğretmen, ders ve konu seçerek istediğiniz gün ve saatlerde online ders açın, öğrencileri ekleyin.'
              : 'Size atanan online dersler, saatleri ve katılım bağlantıları.'}
          </p>
        </div>
      </div>

      {manage && (
        <LessonForm
          teachers={teachers}
          students={students}
          catalog={catalog}
          createdBy={account?.email}
          schoolId={schoolId}
          onCreated={loadLessons}
        />
      )}

      <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-1 sm:max-w-xs">
        <button
          type="button"
          onClick={() => setTab('upcoming')}
          className={`rounded-lg px-3 py-2 text-sm font-bold transition ${
            tab === 'upcoming' ? 'bg-card shadow-sm' : 'text-muted-foreground'
          }`}
        >
          Yaklaşan ({upcoming.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('past')}
          className={`rounded-lg px-3 py-2 text-sm font-bold transition ${
            tab === 'past' ? 'bg-card shadow-sm' : 'text-muted-foreground'
          }`}
        >
          Geçmiş ({past.length})
        </button>
      </div>

      {loading ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-2xl border bg-card p-8 text-center">
          <X className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-sm font-semibold">
            {tab === 'upcoming' ? 'Yaklaşan online ders yok.' : 'Geçmiş online ders kaydı yok.'}
          </p>
          {manage && tab === 'upcoming' && (
            <p className="mt-1 text-xs text-muted-foreground">
              Yukarıdaki formdan yeni bir online ders oluşturabilirsiniz.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {shown.map((lesson) => (
            <LessonCard
              key={lesson.id}
              lesson={lesson}
              manage={manage}
              viewerName={account?.full_name || account?.email || 'Katılımcı'}
              onChanged={loadLessons}
            />
          ))}
        </div>
      )}

      <PageGuide storageKey="online-ders" {...ONLINE_LESSON_GUIDE} />
    </div>
  );
}

export default function OnlineLessonsPage() {
  return (
    <SiteLayout requireAuth wide>
      <OnlineLessonsContent />
    </SiteLayout>
  );
}