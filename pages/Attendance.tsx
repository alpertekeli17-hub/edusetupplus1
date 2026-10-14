/**
 * Yoklama sayfası.
 *
 * - Yoklama alma (yetki: `take_attendance`): seçilen günün ders programındaki
 *   ders saatleri listelenir; bir ders saati seçilince o sınıfın kayıt
 *   defterindeki öğrencileri gelir ve durumları işaretlenip kaydedilir.
 * - Tüm yoklama ve raporlar (yetki: `view_all_attendance`): kurumdaki bütün
 *   kayıtlar tarih aralığı / sınıf / arama ile süzülür, öğrenci-sınıf-ders
 *   bazlı devam raporları çıkarılır.
 * - Veli / öğrenci: yalnızca kendisine (çocuğuna) ait yoklama kayıtlarını
 *   görür; sorgu öğrenci anahtarı ve giriş e-postasıyla daraltıldığı için
 *   başka öğrencilerin kaydı hiç indirilmez.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, ClipboardCheck, Loader2, Save, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import SiteLayout, { useSession } from '@/components/SiteLayout';
import TeacherLessonReport from '@/components/TeacherLessonReport';
import PageGuide from '@/components/PageGuide';
import CollapsibleSection from '@/components/CollapsibleSection';
import { ATTENDANCE_GUIDE } from '@/lib/pageGuides';
import { pullScheduler } from '@/lib/cloud';
import { useLinkedStudents } from '@/hooks/use-linked-students';
import { errorMessage, formatDateShort } from '@/lib/site';
import { fetchStudentRecords, scopeRecordsToSchool, type StudentRecord } from '@/lib/students';
import {
  ATTENDANCE_STATUSES,
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUS_TONES,
  archiveCutoffKey,
  dayNameOfDate,
  fetchAttendanceBySession,
  fetchAttendanceForViewer,
  fetchAttendanceInRange,
  fetchAttendanceSessions,
  filterByRange,
  groupByClassSessions,
  groupByLesson,
  groupByLessonSessions,
  groupByStudent,
  groupByStudentWithSessions,
  hasSchedule,
  listOccurrencesForDate,
  matchScheduleTeacher,
  monthStartKey,
  personKey,
  saveAttendanceSession,
  scopeOccurrencesToTeacher,
  scopeRecordsToTeacher,
  studentsForClass,
  summarize,
  summarizeSessions,
  todayDateKey,
  type AttendanceGroup,
  type AttendanceRecord,
  type AttendanceSessionSummary,
  type AttendanceStatus,
  type AttendanceSummary,
  type LessonOccurrence,
  type RosterEntry,
} from '@/lib/attendance';

/* -------------------------------- Parçacıklar ------------------------------- */

function StatusChip({ status }: { status: AttendanceStatus }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${ATTENDANCE_STATUS_TONES[status]}`}
    >
      {ATTENDANCE_STATUS_LABELS[status]}
    </span>
  );
}

/**
 * Yoklama özet kartları.
 *
 * `variant` neden gerekli: "geldi" bilgisi artık satır olarak saklanmıyor,
 * yalnızca devamsızlık / geç / izin kayıtları yazılıyor. Bu yüzden özet iki
 * ayrı kaynaktan gelebiliyor:
 *
 * - `full`       : Ders saati özetlerinden hesaplanmış tam tablo. "Var" ve
 *                  "Katılım" gerçek değerlerdir.
 * - `exceptions` : Yalnızca istisna satırlarından hesaplanmış tablo (veli /
 *                  öğrenci görünümü). Burada "Var" ve "Katılım" gösterilemez,
 *                  çünkü öğrencinin geldiği derslerin kaydı yoktur; bu kartları
 *                  göstermek %0 katılım gibi yanlış bir tablo çizerdi.
 */
function SummaryCards({
  summary,
  variant = 'full',
}: {
  summary: AttendanceSummary;
  variant?: 'full' | 'exceptions';
}) {
  const cards =
    variant === 'full'
      ? [
          { label: 'Kayıt', value: summary.total, tone: 'bg-muted text-foreground' },
          { label: 'Var', value: summary.present, tone: 'bg-emerald-100 text-emerald-800' },
          { label: 'Yok', value: summary.absent, tone: 'bg-red-100 text-red-800' },
          { label: 'Geç geldi', value: summary.late, tone: 'bg-amber-100 text-amber-800' },
          { label: 'İzinli', value: summary.excused, tone: 'bg-blue-100 text-blue-800' },
          { label: 'Katılım', value: `%${summary.rate}`, tone: 'bg-primary/10 text-primary' },
        ]
      : [
          { label: 'Yok', value: summary.absent, tone: 'bg-red-100 text-red-800' },
          { label: 'Geç geldi', value: summary.late, tone: 'bg-amber-100 text-amber-800' },
          { label: 'İzinli', value: summary.excused, tone: 'bg-blue-100 text-blue-800' },
          {
            label: 'Devamsızlık kaydı',
            value: summary.total,
            tone: 'bg-muted text-foreground',
          },
        ];
  const columns = variant === 'full' ? 'lg:grid-cols-6' : 'lg:grid-cols-4';
  return (
    <div className={`grid grid-cols-2 gap-2 sm:grid-cols-3 ${columns}`}>
      {cards.map((c) => (
        <div key={c.label} className={`rounded-xl px-3 py-2 ${c.tone}`}>
          <p className="text-[11px] font-bold uppercase tracking-wide opacity-80">{c.label}</p>
          <p className="text-xl font-extrabold tabular-nums">{c.value}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * Devam tablosu.
 *
 * `variant` neden gerekli: satırlarda yalnızca devamsızlık / geç / izin
 * kayıtları tutulur. Ders saati özeti olmadan hesaplanan bir tabloda "Ders",
 * "Var" ve "Katılım" sütunları anlamsızdır (öğrencinin girdiği dersler
 * sayılamaz, oran %0 çıkar). Bu yüzden istisna kaynaklı tablolarda o üç sütun
 * hiç gösterilmez.
 */
function GroupTable({
  title,
  rows,
  firstLabel,
  variant = 'full',
  storageKey,
}: {
  title: string;
  rows: AttendanceGroup[];
  firstLabel: string;
  variant?: 'full' | 'exceptions';
  /** Açık/kapalı tercihini hatırlatmak için bölüm anahtarı. */
  storageKey?: string;
}) {
  if (!rows.length) return null;
  const full = variant === 'full';
  return (
    <CollapsibleSection
      title={title}
      badge={`${rows.length} satır`}
      storageKey={storageKey}
      bodyClassName="px-0 py-0"
    >
      {/* NEDEN başlık tekrar yazılmaz: katlanabilir kart başlığı zaten gösteriyor. */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-bold">{firstLabel}</th>
              {full && <th className="px-3 py-2 text-right font-bold">Ders</th>}
              {full && <th className="px-3 py-2 text-right font-bold">Var</th>}
              <th className="px-3 py-2 text-right font-bold">Yok</th>
              <th className="px-3 py-2 text-right font-bold">Geç</th>
              <th className="px-3 py-2 text-right font-bold">İzinli</th>
              {full && <th className="px-3 py-2 text-right font-bold">Katılım</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t">
                <td className="px-3 py-2 font-semibold">
                  {row.label}
                  {row.extra ? (
                    <span className="ml-1.5 text-[11px] text-muted-foreground">{row.extra}</span>
                  ) : null}
                </td>
                {full && (
                  <td className="px-3 py-2 text-right tabular-nums">{row.summary.total}</td>
                )}
                {full && (
                  <td className="px-3 py-2 text-right tabular-nums">{row.summary.present}</td>
                )}
                <td className="px-3 py-2 text-right font-bold tabular-nums text-red-700">
                  {row.summary.absent}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{row.summary.late}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.summary.excused}</td>
                {full && (
                  <td className="px-3 py-2 text-right font-bold tabular-nums">
                    %{row.summary.rate}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CollapsibleSection>
  );
}

function RecordList({ records }: { records: AttendanceRecord[] }) {
  if (!records.length) {
    return (
      <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
        Bu aralıkta yoklama kaydı bulunmuyor.
      </div>
    );
  }
  return (
    <CollapsibleSection
      title="Yoklama kayıtları"
      badge={`${records.length} kayıt`}
      storageKey="attendance.records"
      bodyClassName="px-0 py-0"
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-bold">Tarih</th>
              <th className="px-3 py-2 text-left font-bold">Saat</th>
              <th className="px-3 py-2 text-left font-bold">Sınıf</th>
              <th className="px-3 py-2 text-left font-bold">Ders</th>
              <th className="px-3 py-2 text-left font-bold">Öğrenci</th>
              <th className="px-3 py-2 text-left font-bold">Durum</th>
              <th className="px-3 py-2 text-left font-bold">Not</th>
            </tr>
          </thead>
          <tbody>
            {records.slice(0, 300).map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2 whitespace-nowrap">{formatDateShort(r.date)}</td>
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                  {r.start_time || '—'}
                  {r.period_index !== undefined ? (
                    <span className="ml-1 text-[11px] text-muted-foreground">
                      {Number(r.period_index) + 1}. ders
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2">{r.class_name}</td>
                <td className="px-3 py-2">{r.lesson_name || '—'}</td>
                <td className="px-3 py-2 font-semibold">{r.student_name}</td>
                <td className="px-3 py-2">
                  <StatusChip status={r.status} />
                </td>
                <td className="px-3 py-2 text-muted-foreground">{r.note || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {records.length > 300 && (
        <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
          İlk 300 kayıt gösteriliyor. Tarih aralığını daraltarak listeyi küçültebilirsiniz.
        </p>
      )}
    </CollapsibleSection>
  );
}

/* ------------------------------ Yoklama alma ------------------------------ */

function TakePanel({
  schoolId,
  takenBy,
  scopeToTeacher = false,
  teacherName,
}: {
  schoolId?: number;
  takenBy?: string;
  /** true ise yalnızca giriş yapan öğretmene yazılmış ders saatleri listelenir. */
  scopeToTeacher?: boolean;
  teacherName?: string;
}) {
  const [date, setDate] = useState(todayDateKey());
  const [records, setRecords] = useState<StudentRecord[]>([]);
  const [occurrences, setOccurrences] = useState<LessonOccurrence[]>([]);
  const [selected, setSelected] = useState<LessonOccurrence | null>(null);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [scheduleReady, setScheduleReady] = useState(false);
  const [myTeacher, setMyTeacher] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      await pullScheduler();
      const all = await fetchStudentRecords().catch(() => [] as StudentRecord[]);
      if (!alive) return;
      setRecords(scopeRecordsToSchool(all, schoolId));
      setScheduleReady(hasSchedule());
      // Ders programındaki öğretmen kaydı, program yüklendikten SONRA çözülür.
      setMyTeacher(matchScheduleTeacher({ fullName: teacherName, email: takenBy }));
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [schoolId, teacherName, takenBy]);

  useEffect(() => {
    if (loading) return;
    const all = listOccurrencesForDate(date);
    // Öğretmen yalnızca kendi ders saatlerinin yoklamasını alabilir; tüm yoklama
    // yetkisi olan yönetici/rehber kısıtlanmaz.
    setOccurrences(
      scopeToTeacher
        ? scopeOccurrencesToTeacher(all, myTeacher ?? { name: teacherName })
        : all,
    );
    setSelected(null);
    setRoster([]);
    setSavedKeys(new Set());

    /*
      "Alındı" işareti ders saati özetlerinden okunur.

      Artık yalnızca devamsızlık/geç/izin satırları yazıldığı için "herkes
      geldi" durumunda o ders saatinin hiç satırı olmaz. Satırlara bakan eski
      mantık bu dersi "alınmadı" gösterir ve öğretmen aynı yoklamayı tekrar
      almaya çalışırdı. Özet ise yoklama kaydedildiğinde her zaman yazıldığı
      için doğru cevabı verir.
    */
    let alive = true;
    fetchAttendanceSessions({ schoolId, from: date, to: date })
      .then((items) => {
        if (!alive) return;
        setSavedKeys(new Set(items.map((s) => s.sessionKey)));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [date, loading, scopeToTeacher, myTeacher, teacherName, schoolId]);

  const openSession = useCallback(
    async (occ: LessonOccurrence) => {
      setBusy(true);
      try {
        const existing = await fetchAttendanceBySession(occ.sessionKey);
        const byStudent = new Map<number, AttendanceRecord>();
        existing.forEach((r) => {
          if (r.student_record_id) byStudent.set(Number(r.student_record_id), r);
        });
        /*
          Kayıt bulunmayan öğrenci "var" kabul edilir.

          Bu, istisna bazlı depolamanın okuma tarafındaki karşılığıdır: geldiği
          dersler için öğrencinin satırı olmadığından varsayılan durum "var"
          olmalıdır. Öğretmen ekranı bu sayede eskisiyle aynı görünür.
        */
        const list = studentsForClass(records, occ.className).map<RosterEntry>((student) => {
          const prev = byStudent.get(student.id);
          return {
            student,
            status: prev?.status ?? 'var',
            note: prev?.note ?? '',
            existingId: prev?.id,
          };
        });
        setSelected(occ);
        setRoster(list);
        if (!list.length) {
          toast.error(`${occ.className} sınıfı için kayıt defterinde öğrenci bulunmuyor.`);
        }
      } catch (e) {
        toast.error(errorMessage(e, 'Yoklama listesi hazırlanamadı.'));
      } finally {
        setBusy(false);
      }
    },
    [records],
  );

  const setStatus = (studentId: number, status: AttendanceStatus) => {
    setRoster((prev) =>
      prev.map((row) => (row.student.id === studentId ? { ...row, status } : row)),
    );
  };

  const setNote = (studentId: number, note: string) => {
    setRoster((prev) => prev.map((row) => (row.student.id === studentId ? { ...row, note } : row)));
  };

  const markAll = (status: AttendanceStatus) => {
    setRoster((prev) => prev.map((row) => ({ ...row, status })));
  };

  const save = async () => {
    if (!selected || !roster.length) return;
    setBusy(true);
    try {
      const count = await saveAttendanceSession({
        occurrence: selected,
        roster,
        schoolId,
        takenBy,
      });
      setSavedKeys((prev) => new Set(prev).add(selected.sessionKey));
      // Kayıt kimlikleri tazelensin ki tekrar kaydetmede kopya oluşmasın.
      await openSession(selected);
      toast.success(`${count} öğrenci için yoklama kaydedildi.`);
    } catch (e) {
      toast.error(errorMessage(e, 'Yoklama kaydedilemedi.'));
    } finally {
      setBusy(false);
    }
  };

  const rosterSummary = useMemo(() => {
    const row = { var: 0, yok: 0, gec: 0, izinli: 0 } as Record<AttendanceStatus, number>;
    roster.forEach((r) => {
      row[r.status] += 1;
    });
    return row;
  }, [roster]);

  if (loading) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border bg-card px-4 py-3">
        <div className="space-y-1.5">
          <Label htmlFor="attendance-date">Yoklama tarihi</Label>
          <Input
            id="attendance-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value || todayDateKey())}
            className="w-[180px]"
          />
        </div>
        <div className="mr-auto">
          <p className="text-sm font-extrabold">{dayNameOfDate(date)}</p>
          <p className="text-[11px] text-muted-foreground">
            {occurrences.length} ders saati · ders programından geliyor
          </p>
        </div>
      </div>

      {!scheduleReady ? (
        <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
          Henüz ders programı oluşturulmamış. Yoklama, programdaki ders saatlerine göre alındığı
          için önce ders programını hazırlayın.
        </div>
      ) : !occurrences.length ? (
        <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
          {scopeToTeacher
            ? `${dayNameOfDate(date)} günü ders programında size yazılmış bir ders bulunmuyor. Yoklama yalnızca kendi ders saatleriniz için alınabilir.`
            : `${dayNameOfDate(date)} günü için programda ders bulunmuyor.`}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <div className="space-y-2">
            {occurrences.map((occ) => {
              const active = selected?.sessionKey === occ.sessionKey;
              const done = savedKeys.has(occ.sessionKey);
              return (
                <button
                  key={occ.sessionKey}
                  type="button"
                  onClick={() => void openSession(occ)}
                  className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors duration-150 ${
                    active ? 'border-primary bg-primary/5' : 'bg-card hover:md:bg-accent'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-bold tabular-nums">
                      {occ.periodIndex + 1}. ders
                    </span>
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      {occ.startTime} - {occ.endTime}
                    </span>
                    {done && (
                      <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                        Alındı
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm font-extrabold">
                    {occ.className} · {occ.lessonName}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {occ.teacherName || 'Öğretmen atanmadı'}
                  </p>
                </button>
              );
            })}
          </div>

          <div className="space-y-3">
            {!selected ? (
              <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
                Yoklama almak için soldaki listeden bir ders saati seçin.
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card px-4 py-3">
                  <div className="mr-auto">
                    <p className="text-sm font-extrabold">
                      {selected.className} · {selected.lessonName}
                    </p>
                    <p className="text-[11px] text-muted-foreground tabular-nums">
                      {formatDateShort(selected.date)} · {selected.startTime}-{selected.endTime} ·{' '}
                      {roster.length} öğrenci
                    </p>
                  </div>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                    Var {rosterSummary.var}
                  </span>
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-800">
                    Yok {rosterSummary.yok}
                  </span>
                  <Button variant="outline" size="sm" onClick={() => markAll('var')}>
                    Tümü var
                  </Button>
                  <Button size="sm" onClick={() => void save()} disabled={busy || !roster.length}>
                    {busy ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Yoklamayı kaydet
                  </Button>
                </div>

                {roster.length ? (
                  <div className="overflow-hidden rounded-2xl border bg-card">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/60 text-[11px] uppercase text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-left font-bold">Öğrenci</th>
                          <th className="px-3 py-2 text-left font-bold">Durum</th>
                          <th className="px-3 py-2 text-left font-bold">Not</th>
                        </tr>
                      </thead>
                      <tbody>
                        {roster.map((row) => (
                          <tr key={row.student.id} className="border-t">
                            <td className="px-3 py-2">
                              <p className="font-semibold">{row.student.full_name}</p>
                              <p className="text-[11px] text-muted-foreground">
                                {row.student.student_no
                                  ? `No: ${row.student.student_no}`
                                  : row.student.class_name}
                              </p>
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap gap-1">
                                {ATTENDANCE_STATUSES.map((status) => {
                                  const active = row.status === status;
                                  return (
                                    <button
                                      key={status}
                                      type="button"
                                      onClick={() => setStatus(row.student.id, status)}
                                      className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors duration-150 ${
                                        active
                                          ? ATTENDANCE_STATUS_TONES[status]
                                          : 'border text-muted-foreground hover:md:bg-accent'
                                      }`}
                                    >
                                      {ATTENDANCE_STATUS_LABELS[status]}
                                    </button>
                                  );
                                })}
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                value={row.note ?? ''}
                                onChange={(e) => setNote(row.student.id, e.target.value)}
                                placeholder="Açıklama (isteğe bağlı)"
                                className="h-8"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
                    Bu sınıf için kayıt defterinde öğrenci yok. Öğrenci kayıtları sayfasından
                    öğrencileri ekleyin.
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Ders saati kapsama özeti.
 *
 * Arşive taşınmış günlerde "var" satırları veritabanında bulunmadığı için
 * yalnızca satırlara bakan bir ekran "yoklama alınmadı" ile "herkes geldi"
 * durumlarını karıştırır. Bu tablo sunucudaki ders saati özetlerini kullanarak
 * ayrımı korur ve arşivden okunan günleri açıkça işaretler.
 */
function SessionCoverage({
  sessions,
  className,
}: {
  sessions: AttendanceSessionSummary[];
  className?: string;
}) {
  const rows = useMemo(() => {
    const scoped = className
      ? sessions.filter((s) => (s.className ?? '') === className)
      : sessions;
    return scoped.slice(0, 60);
  }, [sessions, className]);

  if (!rows.length) {
    return (
      <div className="rounded-2xl border bg-card px-4 py-3 text-sm text-muted-foreground">
        Seçili aralıkta yoklama alınmış ders saati bulunmuyor.
      </div>
    );
  }

  const archivedCount = rows.filter((s) => s.archived).length;

  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <h3 className="text-sm font-bold">Yoklama alınan ders saatleri</h3>
        <span className="text-[11px] text-muted-foreground">
          {rows.length} ders saati
          {archivedCount ? ` · ${archivedCount} tanesi arşivden okunuyor` : ''}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Tarih</th>
              <th className="px-3 py-2">Sınıf</th>
              <th className="px-3 py-2">Ders</th>
              <th className="px-3 py-2 text-right">Toplam</th>
              <th className="px-3 py-2 text-right">Var</th>
              <th className="px-3 py-2 text-right">Yok</th>
              <th className="px-3 py-2">Kaynak</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.sessionKey} className="border-t">
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                  {formatDateShort(s.date)}
                  {s.startTime ? (
                    <span className="ml-1.5 text-[11px] text-muted-foreground">{s.startTime}</span>
                  ) : null}
                </td>
                <td className="px-3 py-2">{s.className ?? '—'}</td>
                <td className="px-3 py-2">{s.lessonName ?? '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{s.total}</td>
                <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{s.present}</td>
                <td className="px-3 py-2 text-right font-bold tabular-nums text-red-700">
                  {s.absent}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      s.archived
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {s.archived ? 'Arşiv' : 'Güncel'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------- Tüm kayıtlar ve raporlar ------------------------ */

function AllReportsPanel({
  schoolId,
  teacher,
}: {
  schoolId?: number;
  /** Verilirse yalnızca bu öğretmenin derslerine ait kayıtlar raporlanır. */
  teacher?: { name?: string; email?: string };
}) {
  /*
    NEDEN program adı ayrıca çözülür: yoklama satırındaki `teacher_name` ders
    programındaki addan yazılır. Giriş hesabının adı programdaki adla birebir
    aynı değilse eşleşme yalnızca "yoklamayı ben aldım" durumunda kuruluyordu;
    yönetici veya rehber öğretmen aldığında ders öğretmeni kendi dersinin
    raporunu göremiyordu.
  */
  const [scheduleName, setScheduleName] = useState<string>('');
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [sessions, setSessions] = useState<AttendanceSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(monthStartKey());
  const [to, setTo] = useState(todayDateKey());
  const [className, setClassName] = useState('');
  const [search, setSearch] = useState('');
  const teacherName = teacher?.name;
  const teacherEmail = teacher?.email;
  const scoped = Boolean(teacher);

  /**
   * Rapor verisi yalnızca seçili tarih aralığı için okunur.
   *
   * Aralık son 20 günün içinde kalıyorsa veritabanı yeterlidir. Daha eski bir
   * aralık seçildiğinde arşive taşınmış "var" satırları da istenir; böylece eski
   * dönem raporları eksik çıkmaz ama günlük kullanımda nesne deposu okunmaz.
   * Ders saati özetleri her durumda alınır: arşivlenmiş günlerde "yoklama
   * alınmadı" ile "herkes geldi" ayrımı bu özetlerden yapılır.
   */
  useEffect(() => {
    let alive = true;
    if (!scoped) {
      setScheduleName('');
      return;
    }
    // Program yüklenmeden öğretmen kaydı çözülemez.
    void pullScheduler().then(() => {
      if (!alive) return;
      const match = matchScheduleTeacher({ fullName: teacherName, email: teacherEmail });
      setScheduleName(match?.name ?? '');
    });
    return () => {
      alive = false;
    };
  }, [scoped, teacherName, teacherEmail]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const needsArchive = Boolean(from) && from < archiveCutoffKey();
    Promise.all([
      fetchAttendanceInRange({ schoolId, from, to, includeArchived: needsArchive }),
      fetchAttendanceSessions({ schoolId, from, to }),
    ])
      .then(([all, summaries]) => {
        if (!alive) return;
        setRecords(
          scoped
            ? scopeRecordsToTeacher(all, {
                name: teacherName,
                email: teacherEmail,
                scheduleName,
              })
            : all,
        );
        // Ders saati özetleri de aynı ad kümesiyle süzülür; aksi hâlde tablo ile
        // kart sayıları farklı kapsamdan beslenip birbirini tutmazdı.
        const owners = new Set(
          [personKey(teacherName), personKey(scheduleName)].filter(Boolean),
        );
        setSessions(
          scoped && owners.size
            ? summaries.filter((s) => owners.has(personKey(s.teacherName)))
            : summaries,
        );
      })
      .catch(() => {
        if (!alive) return;
        setRecords([]);
        setSessions([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [schoolId, scoped, teacherName, teacherEmail, from, to]);

  const classNames = useMemo(
    () => [...new Set(records.map((r) => r.class_name).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, 'tr'),
    ),
    [records],
  );

  /** Sınıf filtresi uygulanmış ders saati özetleri (tabloların ortak kaynağı). */
  const scopedSessions = useMemo(
    () => (className ? sessions.filter((s) => (s.className ?? '') === className) : sessions),
    [sessions, className],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('tr');
    return filterByRange(records, from, to).filter((r) => {
      if (className && r.class_name !== className) return false;
      if (!term) return true;
      return `${r.student_name} ${r.lesson_name ?? ''} ${r.class_name}`
        .toLocaleLowerCase('tr')
        .includes(term);
    });
  }, [records, from, to, className, search]);

  if (loading) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border bg-card px-4 py-3">
        <div className="space-y-1.5">
          <Label htmlFor="report-from">Başlangıç</Label>
          <Input
            id="report-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-[160px]"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="report-to">Bitiş</Label>
          <Input
            id="report-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-[160px]"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="report-class">Sınıf</Label>
          <select
            id="report-class"
            value={className}
            onChange={(e) => setClassName(e.target.value)}
            className="h-10 w-[160px] rounded-md border bg-background px-3 text-sm"
          >
            <option value="">Tüm sınıflar</option>
            {classNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[200px] flex-1 space-y-1.5">
          <Label htmlFor="report-search">Ara</Label>
          <Input
            id="report-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Öğrenci veya ders adı"
          />
        </div>
      </div>

      <SessionCoverage sessions={sessions} className={className} />
      {/*
        Katılım özeti ders saati özetlerinden hesaplanır. Satırlarda yalnızca
        devamsızlık kayıtları bulunduğu için satır saymak katılımı %0 gösterirdi.
      */}
      <SummaryCards summary={summarizeSessions(scopedSessions)} />
      {/*
        Tablolar da ders saati özetlerine dayanır. Satır saymak "Var" ve
        "Katılım" sütunlarını sıfır gösterirdi; sınıf ve ders tabloları ise
        katılım sayılarını doğrudan özetten okur.
      */}
      <GroupTable
        title="Öğrenci bazlı devamsızlık"
        rows={groupByStudentWithSessions(filtered, scopedSessions)}
        firstLabel="Öğrenci"
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <GroupTable
          title="Sınıf bazlı devam"
          rows={groupByClassSessions(scopedSessions)}
          firstLabel="Sınıf"
        />
        <GroupTable
          title="Ders bazlı devam"
          rows={groupByLessonSessions(scopedSessions)}
          firstLabel="Ders"
        />
      </div>
      <RecordList records={filtered} />
    </div>
  );
}

/* --------------------------- Veli / öğrenci görünümü ------------------------ */

function MyAttendancePanel({ email, schoolId, fallbackName }: {
  email?: string;
  schoolId?: number;
  fallbackName?: string;
}) {
  const linked = useLinkedStudents({ email, schoolId, fallbackName });
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(monthStartKey());
  const [to, setTo] = useState(todayDateKey());

  const keys = useMemo(() => [...linked.keys], [linked.keys]);

  useEffect(() => {
    if (linked.loading) return;
    let alive = true;
    setLoading(true);
    fetchAttendanceForViewer({ keys, email })
      .then((all) => {
        if (alive) setRecords(all);
      })
      .catch(() => {
        if (alive) setRecords([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [keys, email, linked.loading]);

  if (linked.loading || loading) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!keys.length) {
    return (
      <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
        Hesabınız henüz bir öğrenci kaydına bağlanmamış. Kurum yöneticinizden kayıt defterine
        e-postanızı eklemesini isteyin.
      </div>
    );
  }

  const filtered = filterByRange(records, from, to);
  const byStudent = groupByStudent(filtered);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border bg-card px-4 py-3">
        <div className="mr-auto">
          <p className="text-sm font-extrabold">
            {linked.primaryName ? `${linked.primaryName} · Yoklama` : 'Yoklamalarım'}
          </p>
          <p className="text-[11px] text-muted-foreground">
            Yalnızca size ait yoklama kayıtları gösterilir.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="my-from">Başlangıç</Label>
          <Input
            id="my-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-[160px]"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="my-to">Bitiş</Label>
          <Input
            id="my-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-[160px]"
          />
        </div>
      </div>

      {/*
        Veli / öğrenci yalnızca kendi istisna kayıtlarını indirir; geldiği
        derslerin satırı olmadığı için katılım oranı bu veriden çıkarılamaz.
        Bu yüzden kartlar devamsızlık odaklı gösterilir.
      */}
      <SummaryCards summary={summarize(filtered)} variant="exceptions" />
      {byStudent.length > 1 && (
        <GroupTable
          title="Öğrenci özeti"
          rows={byStudent}
          firstLabel="Öğrenci"
          variant="exceptions"
        />
      )}
      <GroupTable
        title="Ders bazlı devamsızlık"
        rows={groupByLesson(filtered)}
        firstLabel="Ders"
        variant="exceptions"
      />
      <RecordList records={filtered} />
    </div>
  );
}

/* ---------------------------------- Sayfa ---------------------------------- */

function AttendanceBody() {
  const { can, member, account } = useSession();
  const canTake = can('take_attendance');
  const canViewAll = can('view_all_attendance');
  const schoolId = member ? Number(member.school_id) : undefined;
  const [tab, setTab] = useState<'take' | 'report'>(canTake ? 'take' : 'report');
  // Tüm yoklama yetkisi olmayan (branş) öğretmen yalnızca kendi ders saatlerini görür.
  const scopeToTeacher = canTake && !canViewAll;
  const teacherName = account?.full_name;

  const tabs: { key: 'take' | 'report'; label: string; icon: typeof Users }[] = [
    ...(canTake ? [{ key: 'take' as const, label: 'Yoklama al', icon: ClipboardCheck }] : []),
    {
      key: 'report' as const,
      label: canViewAll
        ? 'Tüm yoklama ve raporlar'
        : canTake
          ? 'Derslerimin raporları'
          : 'Yoklamalarım',
      icon: CalendarDays,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card px-4 py-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ClipboardCheck className="h-5 w-5" />
        </span>
        <div className="mr-auto">
          <p className="text-base font-extrabold">Yoklama</p>
          <p className="text-[11px] text-muted-foreground">
            {canViewAll
              ? 'Ders programındaki derslere göre yoklama alınır; tüm kayıt ve raporlar burada görünür.'
              : scopeToTeacher
                ? 'Yoklama, ders programında size yazılmış sınıf ve ders saatleri için alınır.'
                : 'Yalnızca sizinle ilgili yoklama kayıtları listelenir.'}
          </p>
        </div>
      </div>

      {tabs.length > 1 && (
        <div className="inline-flex gap-1 rounded-xl bg-muted p-1">
          {tabs.map((item) => {
            const Icon = item.icon;
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors duration-150 ${
                  active ? 'bg-card shadow-sm' : 'text-muted-foreground'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>
      )}

      {tab === 'take' && canTake ? (
        <TakePanel
          schoolId={schoolId}
          takenBy={account?.email}
          scopeToTeacher={scopeToTeacher}
          teacherName={teacherName}
        />
      ) : canViewAll ? (
        <AllReportsPanel schoolId={schoolId} />
      ) : canTake ? (
        <AllReportsPanel
          schoolId={schoolId}
          teacher={{ name: teacherName, email: account?.email }}
        />
      ) : (
        <MyAttendancePanel
          email={account?.email}
          schoolId={schoolId}
          fallbackName={member?.student_name}
        />
      )}

      {tab === 'report' && canViewAll && <TeacherLessonReport schoolId={schoolId} />}
      <PageGuide storageKey="yoklama" {...ATTENDANCE_GUIDE} />
    </div>
  );
}

export default function AttendancePage() {
  return (
    <SiteLayout requireAuth>
      <AttendanceBody />
    </SiteLayout>
  );
}