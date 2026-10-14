/**
 * Bildirim merkezi kapsam kanıtı (veli / öğrenci / öğretmen / yönetici).
 *
 * Neden bu betik gerekli
 * ----------------------
 * Kullanıcı "veli ve öğrenci hesaplarında bildirim merkezi BOŞ görünüyor; yaklaşan
 * yüz yüze/online dersler, ödev teslimleri ve rehberlik takipleri görünmeli"
 * dedi. Belirtinin kritik özelliği şu: **boş liste hiçbir hata üretmez**.
 * Ekranda "bildirim yok" yazması ile "bildirim üretilmiyor" aynı görünür, bu
 * yüzden kusur canlıda sessizce yaşar ve gözle ayırt edilemez.
 *
 * Bu betik iddiaları ekran görüntüsüyle değil, uygulamanın **kendi**
 * fonksiyonlarıyla ölçer:
 *   - `loadNotifications` (lib/notifications.ts) — üretim + role göre süzme
 *   - `listOccurrencesForDate`, `classKey` (lib/attendance.ts) — ders saatleri
 *   - `matchesStudentName` (lib/scheduleView.ts) — ada dayalı eşleşme kuralı
 *   - `saveRecords` / `saveLessons` / `saveClasses` / ... — gerçek depo turu
 *   - `pullRecords` (lib/cloud.ts) — okul kayıtlarının uzak tazelemesi
 *   - `fetchAccounting` (lib/site.ts) — muhasebe/taksit kaynağı (11. bölüm)
 *
 * Her olumlu iddianın **olumsuz** karşılığı da ölçülür: başka sınıfın ders saati
 * veliye gösterilmemeli, eşleşmeyen hesaba uydurma ders üretilmemeli, başka
 * öğrencinin ödevi sızmamalı ve tamamlanmış ödev hatırlatılmamalıdır. Yalnız
 * "liste dolu" ölçülseydi fazla gösteren hata yeşil kalırdı.
 *
 * Ölçüm kapsamı (bu turda genişletildi)
 * -------------------------------------
 * Önceki sürümde online ders ve rehberlik kaynakları "ağ erişimi yok" gerekçesiyle
 * kapsam dışı bırakılmıştı ve betik bu iki kaynakta her zaman 0 kayıt görüyordu.
 * Bu, iki gerçek riski gizliyordu: (a) kusur "gösterilmiyor" biçiminde de olabilir
 * ve veli yalnız kendi dersini değil **başka öğrencinin dersini** görüyorsa bunu
 * yakalayan hiçbir iddia yoktu; (b) kaynak tamamen kırılsa betik yine yeşil kalırdı,
 * çünkü "0 kayıt" beklenen sonuç gibi okunuyordu.
 *
 * Artık iki kaynak da **gerçek uygulama fonksiyonlarıyla** ölçülür (9. ve 10.
 * bölümler): senaryo satırları `node-shim` içindeki axios adapter'ına verilir,
 * adapter **sunucu gibi** davranır ve yalnızca istemcinin gönderdiği sorguya uyan
 * satırları döner. Bu ayrım kritiktir: taklit istemcinin *her* satırı döndürseydi
 * "başka öğrencinin dersi sızmıyor" iddiası sunucu tarafından değil taklidin
 * kendi süzgecinden geçerdi, yani hiçbir şey ölçülmemiş olurdu.
 *
 * Bunun için iddialar iki katmanlıdır:
 *   1. isteğin gerçekten daraltılmış gitmesi (gözlenen sorgu parametreleri ve
 *      "tüm kurumun online dersleri hiç istenmemeli" envanter iddiası),
 *   2. dönen listeye yabancı kaydın girmemesi (olumsuz iddialar).
 *
 * Velinin yalnızca kendi dersini/takibini görmesi iki katmanın **birlikte**
 * tutmasını gerektirir: sunucu daraltılmış sorguya rağmen yabancı satır
 * döndürürse 2. katman, istemci tüm kurumu istemeye kalkarsa 1. katman kırmızı
 * yanar.
 *
 * Çalıştırma:
 *   BENCH_ENTRY=scripts/bench-notifications.ts \
 *     pnpm exec vite build --config vite.bench.notify.config.ts
 *   node .bench-notify/bench.mjs
 *
 * Not: çıktı bilinçli olarak `.bench-notify/` klasörüne yazılır; `.bench/` içinde
 * yük testi araçları (k6, raporlar, Python betikleri) duruyor ve o klasörü
 * boşaltmak onları silerdi.
 */
/*
  DİKKAT: shim importu EN ÜSTTE olmalıdır. Uygulama modülleri `window`/`localStorage`
  bekler; ESM içe aktarmaları sırayla değerlendirildiği için shim ilk sırada olmazsa
  Node "window is not defined" ile düşer.
*/
import { setAxiosResponder, type ObservedRequest } from './node-shim';

import { client } from '@/lib/api';
import { saveToken } from '@/lib/portalAuth';
import { saveRecords } from '@/lib/records';
import { studentNameKey } from '@/lib/students';
import { addDaysKey, nowMinutes, timeMinutes, todayKey } from '@/lib/date';
import { loadNotifications, type AppNotification } from '@/lib/notifications';
import {
  announcementIdOf,
  announcementIdsToSync,
  syncAnnouncementRead,
} from '@/lib/notificationRead';
import {
  participantBelongsToViewer,
  viewerEmailSet,
  viewerNameKeys,
  type LessonParticipant,
  type OnlineLesson,
} from '@/lib/onlineLessons';
import type { GuidanceEntry } from '@/lib/guidance';
import {
  effectiveStatus,
  formatTry,
  todayKey as siteTodayKey,
  type AccountingEntry,
} from '@/lib/site';
import { saveClasses, saveEntries, saveLessons, saveTeachers } from '@/scheduler/lib/store';
import type { Homework, SchoolRecords } from '@/lib/types';
import type { Lesson, ScheduleEntry, SchoolClass, Teacher } from '@/scheduler/lib/types';

/* ------------------------------------------------------------------ */
/* Küçük doğrulama çerçevesi                                           */
/* ------------------------------------------------------------------ */

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail: string): void {
  if (condition) {
    passed += 1;
    console.log(`  OK   ${label}`);
  } else {
    failures.push(`${label} — ${detail}`);
    console.log(`  FAIL ${label}\n       ${detail}`);
  }
}

/* ------------------------------------------------------------------ */
/* Sahne: üç sınıf + ada yazılmış bir ek ders                          */
/* ------------------------------------------------------------------ */

const MAT = 'mat';
const CLASS_A = 'a';
const CLASS_B = 'b';
const CLASS_C = 'c';
/** Kayıt defterinde karşılığı olmayan sınıf kimliği: "yalnızca öğrenci adına" ek ders. */
const EXTRA_CLASS = 'ek-1';
const T_AYSE = 't-ayse';
const T_MEHMET = 't-mehmet';

const ZEYNEP = 'Zeynep K.';
const ZEYNEP_CLASS = '8-A';

/** Her gün aynı ders saati: senaryo haftanın hangi günü koşarsa koşsun belirlidir. */
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

function dailyEntries(
  classId: string,
  teacherId: string,
  studentName?: string,
): ScheduleEntry[] {
  return ALL_DAYS.map((dayIndex) => ({
    id: `${classId}-${dayIndex}`,
    classId,
    dayIndex,
    periodIndex: 0,
    lessonId: MAT,
    teacherId,
    isExtra: Boolean(studentName),
    ...(studentName ? { studentName } : {}),
  }));
}

const lessons: Lesson[] = [{ id: MAT, name: 'Matematik', color: '#111111' }];

const teachers: Teacher[] = [
  {
    id: T_AYSE,
    name: 'Ayşe Yılmaz',
    email: 'ayse@okul.com',
    assignedLessons: [MAT],
    assignedClasses: [],
    offDays: [],
  },
  {
    id: T_MEHMET,
    name: 'Mehmet Demir',
    email: 'mehmet@okul.com',
    assignedLessons: [MAT],
    assignedClasses: [],
    offDays: [],
  },
];

const classes: SchoolClass[] = [
  {
    id: CLASS_A,
    name: ZEYNEP_CLASS,
    weeklyHours: { [MAT]: 2 },
    activeDays: ALL_DAYS,
    periodsForDay: {},
  },
  { id: CLASS_B, name: '8-B', weeklyHours: { [MAT]: 2 }, activeDays: ALL_DAYS, periodsForDay: {} },
  { id: CLASS_C, name: '8-C', weeklyHours: { [MAT]: 2 }, activeDays: ALL_DAYS, periodsForDay: {} },
];

const entries: ScheduleEntry[] = [
  ...dailyEntries(CLASS_A, T_AYSE),
  ...dailyEntries(CLASS_B, T_AYSE),
  ...dailyEntries(CLASS_C, T_MEHMET),
  // Sınıf bilgisi girilmeden yalnızca öğrenci adı yazılarak kaydedilmiş ek ders.
  ...dailyEntries(EXTRA_CLASS, T_AYSE, ZEYNEP),
];

saveLessons(lessons);
saveTeachers(teachers);
saveClasses(classes);
saveEntries(entries);

const TODAY = todayKey();
const HORIZON = 7; // offsets 0..7 → 8 gün penceresi
const PER_DAY = 2; // sınıf dersi + adına yazılmış ek ders

/* ------------------------------------------------------------------ */
/* Köprü taklidi: kayıtların uzak tazelemesini A/B ölçmek için         */
/* ------------------------------------------------------------------ */

/**
 * Node ortamında portal köprüsü yoktur; `pullRecords` bu yüzden hiç uzak veri
 * görmez ve "ödev bildirimi var mı" iddiası ölçülemezdi. Köprüyü taklit ederek
 * `readJson` yolunu gerçek `fetch` ile besliyoruz: dönen JSON **veri adresi**
 * biçiminde verilir, yani okunan içerik gerçekten uzaktan gelmiş sayılır.
 */
const bridgeCalls: Array<{ url: string; kind?: string }> = [];
let remoteRecordsUrl = '';

/**
 * Mesajlaşma uçlarına giden isteklerin dökümü.
 *
 * Neden gerekli: "okundu işareti sunucuya gidiyor" iddiası yalnızca yerel
 * listeye bakılarak kanıtlanamaz — okundu kararı tarayıcıda da tutulduğu için
 * sunucu isteği hiç atılmasa bile ekran doğru görünür. Kanıt **giden isteğin
 * kendisidir**; bu döküm o isteği yakalar ve ayrıca istenmeyen bir isteğin
 * (konuşmanın okundu sayılması gibi) atılmadığını da gösterir.
 */
const messagingCalls: { url: string; data: Record<string, unknown> }[] = [];

function installBridge(): boolean {
  const apiCall = client.apiCall as unknown as { invoke: (req: unknown) => Promise<unknown> };
  try {
    apiCall.invoke = async (req: unknown) => {
      const request = (req ?? {}) as { url?: string; data?: { kind?: string } };
      bridgeCalls.push({ url: request.url ?? '', kind: request.data?.kind });
      if (request.url?.startsWith('/api/v1/portal-data/')) {
        if (request.data?.kind === 'records' && remoteRecordsUrl) {
          return { data: { download_url: remoteRecordsUrl } };
        }
        // Köprü çalışıyor ama bu veri türünde dosya yok.
        return { data: {} };
      }
      if (request.url?.includes('/api/v1/messaging/')) {
        messagingCalls.push({
          url: request.url,
          data: (request.data ?? {}) as Record<string, unknown>,
        });
        if (request.url.includes('/overview')) {
          return { data: messagingOverviewPayload };
        }
        if (request.url.includes('/announcement-read')) {
          return { data: { ok: true, created: true } };
        }
        return { data: { ok: true } };
      }
      // Kapsam dışı uçlar: ağ erişimi olmadığı için çağıran taraf kendi
      // güvenli varsayılanına düşer (online ders, rehberlik, ders programı).
      throw new Error('bench: ag erisimi yok');
    };
    return true;
  } catch {
    // Donmuş/proxy nesne: atama sessizce yutulmaz, burada yakalanır.
    return false;
  }
}

/** Atamanın fiilen etkili olduğunu çağrıyla doğrular (varsayım yeterli değil). */
async function bridgeWorks(): Promise<boolean> {
  bridgeCalls.length = 0;
  try {
    await client.apiCall.invoke({
      url: '/api/v1/portal-data/download-url',
      data: { kind: 'records' },
    });
    return bridgeCalls.length === 1;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Sunucu taklidi: online ders + rehberlik uçları                      */
/* ------------------------------------------------------------------ */
/*
  Neden gerekli
  -------------
  Bu iki kaynak "ağ erişimi yok" gerekçesiyle kapsam dışı bırakıldığında betik
  her koşulda 0 kayıt görüyordu. Bu iki gerçek riski gizler: (a) kusur
  "gösterilmiyor" biçiminde de olabilir, (b) kaynak tamamen kırılsa bile sonuç
  yeşil kalır. Üstelik velinin **başka öğrencinin** dersini görmesi ihtimali
  hiçbir iddiayla ölçülmüyordu.

  Adapter **sunucu gibi** davranır: yalnızca istemcinin gönderdiği sorguya uyan
  satırları döner. Taklit her satırı döndürseydi "yabancı kayıt sızmıyor"
  iddiası taklidin kendi süzgecinden geçerdi, yani hiçbir şey ölçülmemiş olurdu.
*/

const LESSON_ENTITY = 'online_lessons';
const PARTICIPANT_ENTITY = 'online_lesson_participants';
const GUIDANCE_ENTITY = 'guidance_entries';
const ACCOUNTING_ENTITY = 'accounting_entries';

/** Zeynep'in kendi yaklaşan dersi. */
const L_OWN = 9001;
/** Başka öğrencinin dersi — veliye sızmamalı. */
const L_FOREIGN = 9002;
/** İptal edilmiş kendi dersi — hatırlatılmamalı. */
const L_CANCELLED = 9003;
/** Dün yapılmış kendi dersi — hatırlatılmamalı. */
const L_PAST = 9004;
/**
 * Aynı öğrencinin dersi, ancak katılım satırında **öğrenci e-postası** yazılı
 * (veli e-postası boş). Öğrenci hesabının kapsamı bu satırla ölçülür: veli
 * kolu `parent_email`, öğrenci kolu `student_email` bağından çözülür; yalnız
 * birini ölçmek diğer kolu hiç sınamamak olurdu.
 */
const L_STUDENT = 9005;

/** Zeynep'in kendi takibi (yaklaşan). */
const G_OWN = 8001;
/** Vadesi geçmiş kendi takibi. */
const G_LATE = 8002;
/** Başka öğrencinin takibi — veliye sızmamalı. */
const G_FOREIGN = 8003;
/** Pencere dışında (40 gün önce) kendi takibi — listeye girmemeli. */
const G_OLD = 8004;

const OWN_EMAIL = 'veli@okul.com';
/** Öğrencinin kendi giriş e-postası (katılımcı satırında `student_email`). */
const STUDENT_EMAIL = 'zeynep@okul.com';
const FOREIGN_EMAIL = 'baska-veli@okul.com';
const FOREIGN_STUDENT = 'Başka Öğrenci';

const lessonRows: OnlineLesson[] = [
  {
    id: L_OWN,
    school_id: 1,
    title: 'Paragraf tekrar dersi',
    teacher_name: 'Ayşe Yılmaz',
    teacher_email: 'ayse@okul.com',
    subject: 'Türkçe',
    class_name: ZEYNEP_CLASS,
    lesson_date: addDaysKey(TODAY, 2),
    start_time: '19:00',
    end_time: '20:00',
    platform: 'Canlı ders (uygulama içi)',
    status: 'planlandi',
  },
  {
    id: L_FOREIGN,
    school_id: 1,
    title: 'Yabancı öğrenci dersi',
    teacher_name: 'Mehmet Demir',
    teacher_email: 'mehmet@okul.com',
    subject: 'Matematik',
    // Aynı sınıf: sınıf eşleşmesine bakan bir süzgeç yabancı dersi sızdırırdı.
    class_name: ZEYNEP_CLASS,
    lesson_date: addDaysKey(TODAY, 2),
    start_time: '19:00',
    end_time: '20:00',
    status: 'planlandi',
  },
  {
    id: L_CANCELLED,
    school_id: 1,
    title: 'İptal edilmiş ders',
    teacher_name: 'Ayşe Yılmaz',
    teacher_email: 'ayse@okul.com',
    subject: 'Türkçe',
    class_name: ZEYNEP_CLASS,
    lesson_date: addDaysKey(TODAY, 2),
    start_time: '20:10',
    end_time: '21:00',
    status: 'iptal',
  },
  {
    id: L_PAST,
    school_id: 1,
    title: 'Dün yapılmış ders',
    teacher_name: 'Ayşe Yılmaz',
    teacher_email: 'ayse@okul.com',
    subject: 'Türkçe',
    class_name: ZEYNEP_CLASS,
    lesson_date: addDaysKey(TODAY, -1),
    start_time: '19:00',
    end_time: '20:00',
    status: 'planlandi',
  },
  {
    id: L_STUDENT,
    school_id: 1,
    title: 'Öğrenci hesabı dersi',
    teacher_name: 'Ayşe Yılmaz',
    teacher_email: 'ayse@okul.com',
    subject: 'Türkçe',
    class_name: ZEYNEP_CLASS,
    lesson_date: addDaysKey(TODAY, 3),
    start_time: '18:00',
    end_time: '19:00',
    status: 'planlandi',
  },
];

/**
 * Katılımcı satırları dersin **açıldığı andaki** kimlik bilgilerini taşır.
 * `p-own` satırında yalnız veli e-postası vardır; öğrenci e-postası gerçek
 * veride olduğu gibi boştur.
 */
const participantRows: LessonParticipant[] = [
  {
    id: 7001,
    school_id: 1,
    lesson_id: L_OWN,
    student_name: ZEYNEP,
    student_key: studentNameKey(ZEYNEP),
    class_name: ZEYNEP_CLASS,
    student_email: '',
    parent_email: OWN_EMAIL,
  },
  {
    id: 7002,
    school_id: 1,
    lesson_id: L_FOREIGN,
    student_name: FOREIGN_STUDENT,
    student_key: studentNameKey(FOREIGN_STUDENT),
    class_name: ZEYNEP_CLASS,
    student_email: 'baska@okul.com',
    parent_email: FOREIGN_EMAIL,
  },
  {
    id: 7003,
    school_id: 1,
    lesson_id: L_CANCELLED,
    student_name: ZEYNEP,
    student_key: studentNameKey(ZEYNEP),
    class_name: ZEYNEP_CLASS,
    student_email: '',
    parent_email: OWN_EMAIL,
  },
  {
    id: 7004,
    school_id: 1,
    lesson_id: L_PAST,
    student_name: ZEYNEP,
    student_key: studentNameKey(ZEYNEP),
    class_name: ZEYNEP_CLASS,
    student_email: '',
    parent_email: OWN_EMAIL,
  },
  /*
    Öğrenci kolunun ölçüldüğü satır: veli e-postası BOŞ, öğrenci e-postası dolu.
    Gerçek veride de olan bir durumdur (ders açılırken öğrenci e-postası yazılmış,
    veli e-postası sonradan girilmiş). Veli kolu bu satırla değil kendine ait
    satırlarla ölçülür; sonda kontrolü bu satırın `parent_email` sorgusunda
    görünmediğini de kanıtlar.
  */
  {
    id: 7005,
    school_id: 1,
    lesson_id: L_STUDENT,
    student_name: ZEYNEP,
    student_key: studentNameKey(ZEYNEP),
    class_name: ZEYNEP_CLASS,
    student_email: STUDENT_EMAIL,
    parent_email: '',
  },
];

const guidanceRows: GuidanceEntry[] = [
  {
    id: G_OWN,
    school_id: 1,
    student_key: studentNameKey(ZEYNEP),
    student_name: ZEYNEP,
    class_name: ZEYNEP_CLASS,
    kind: 'olcek',
    entry_date: addDaysKey(TODAY, -5),
    title: 'Ölçek takibi',
    follow_up_date: addDaysKey(TODAY, 2),
    action: 'Veli ile görüşülecek',
  },
  {
    id: G_LATE,
    school_id: 1,
    student_key: studentNameKey(ZEYNEP),
    student_name: ZEYNEP,
    class_name: ZEYNEP_CLASS,
    kind: 'gorusme',
    entry_date: addDaysKey(TODAY, -10),
    title: 'Gecikmiş takip',
    follow_up_date: addDaysKey(TODAY, -1),
    action: 'Takip görüşmesi yapılacak',
  },
  {
    id: G_FOREIGN,
    school_id: 1,
    student_key: studentNameKey(FOREIGN_STUDENT),
    student_name: FOREIGN_STUDENT,
    class_name: ZEYNEP_CLASS,
    kind: 'gorusme',
    entry_date: addDaysKey(TODAY, -3),
    title: 'Yabancı takip',
    follow_up_date: addDaysKey(TODAY, 2),
  },
  {
    id: G_OLD,
    school_id: 1,
    student_key: studentNameKey(ZEYNEP),
    student_name: ZEYNEP,
    class_name: ZEYNEP_CLASS,
    kind: 'gorusme',
    entry_date: addDaysKey(TODAY, -45),
    title: 'Eski takip',
    follow_up_date: addDaysKey(TODAY, -40),
  },
];

/* ------------------------------- Muhasebe -------------------------------- */
/*
  Muhasebe kolu bu turda eklendi. Neden ayrı satır kümesi gerekti: bildirim
  kaynağı `accounting_entries` tablosunu **tam** okur ve kişiye indirmeyi
  istemcide `student_name` anahtarıyla yapar. Bu yüzden "veli yalnız kendi
  taksitini görüyor" iddiası ölçülmeden bırakılsaydı, ada göre süzme gevşediğinde
  aile **başka öğrencinin borcunu** kendi bildirim listesinde görürdü; bu hata
  ekranda "fazladan bildirim" olarak görünür ve gözle ayırt edilmez.
*/
/** Zeynep'in yaklaşan (penceredeki) taksiti. */
const A_OWN_FUTURE = 6001;
/** Zeynep'in vadesi geçmiş taksiti — hem veliye hem yönetici özetine girer. */
const A_OWN_OVERDUE = 6002;
/** Zeynep'in bugün vadeli taksiti — yöneticiye "bugün" özeti üretir. */
const A_OWN_TODAY = 6003;
/** Ödenmiş taksit — hiçbir kolda hatırlatılmamalı. */
const A_OWN_PAID = 6004;
/** Pencere dışı (30 gün sonra) taksit — veli listesine girmemeli. */
const A_OWN_FAR = 6005;
/**
 * 200 gün gecikmiş taksit: veli kolunun geriye bakış sınırı (90 gün) dışında,
 * yönetici özetinde ise **içinde**. İki kolun bilinçli farkı bu satırla ölçülür.
 */
const A_OWN_ANCIENT = 6006;
/** Başka öğrencinin yaklaşan taksiti — veliye sızmamalı. */
const A_FOREIGN_FUTURE = 6007;
/** Başka öğrencinin gecikmiş taksiti — yöneticiye girer, veliye girmez. */
const A_FOREIGN_OVERDUE = 6008;
/** Gider kalemi: ödeme yükümlülüğü değil, hiçbir kolda hatırlatılmamalı. */
const A_EXPENSE = 6009;

/*
  Satırlar `AccountingEntry` alanlarına ek olarak `school_id` taşır: gerçek API
  yanıtı bu alanı döndürür ve uygulama kurum süzgecini onun üzerinden kurar.
  Tipi dar bırakmak, süzgeci ölçen senaryoyu sessizce anlamsız kılardı.
*/
const accountingRows: Array<AccountingEntry & { school_id?: number }> = [
  {
    id: A_OWN_FUTURE,
    school_id: 1,
    entry_type: 'tahsilat',
    student_name: ZEYNEP,
    class_name: ZEYNEP_CLASS,
    title: 'Okul ücreti 1. taksit',
    amount: 5000,
    status: 'bekliyor',
    due_date: addDaysKey(TODAY, 3),
  },
  {
    id: A_OWN_OVERDUE,
    school_id: 1,
    entry_type: 'tahsilat',
    student_name: ZEYNEP,
    class_name: ZEYNEP_CLASS,
    title: 'Okul ücreti 2. taksit',
    amount: 5000,
    status: 'bekliyor',
    due_date: addDaysKey(TODAY, -10),
  },
  {
    id: A_OWN_TODAY,
    school_id: 1,
    entry_type: 'tahsilat',
    student_name: ZEYNEP,
    class_name: ZEYNEP_CLASS,
    title: 'Kitap ücreti',
    amount: 3000,
    status: 'bekliyor',
    due_date: TODAY,
  },
  {
    /*
      Ödenmiş taksitin vadesi bilinçli olarak **dün**: "ödenmiş kayıt
      hatırlatılmıyor" iddiası ancak vade iki kolun da penceresine girdiği hâlde
      kaydın süzülmesiyle ölçülür. Vadeyi pencere dışına (ya da geleceğe)
      koymak, süzgeci bozuk olsa bile iddiayı yeşil bırakırdı; dün seçildiğinde
      hem velinin geriye bakış penceresinde hem yöneticinin sınırsız gecikme
      özetinde gerçek bir ölçüm yapılır (özet sayısı 3 kalıyorsa "odendi" dışlaması
      çalışıyor demektir, 4 olursa kırılmıştır).
    */
    id: A_OWN_PAID,
    school_id: 1,
    entry_type: 'tahsilat',
    student_name: ZEYNEP,
    class_name: ZEYNEP_CLASS,
    title: 'Ödenmiş taksit',
    amount: 4000,
    status: 'odendi',
    due_date: addDaysKey(TODAY, -1),
    paid_date: addDaysKey(TODAY, -1),
  },
  {
    id: A_OWN_FAR,
    school_id: 1,
    entry_type: 'tahsilat',
    student_name: ZEYNEP,
    class_name: ZEYNEP_CLASS,
    title: 'Uzak vade',
    amount: 2500,
    status: 'bekliyor',
    due_date: addDaysKey(TODAY, 30),
  },
  {
    id: A_OWN_ANCIENT,
    school_id: 1,
    entry_type: 'tahsilat',
    student_name: ZEYNEP,
    class_name: ZEYNEP_CLASS,
    title: 'Eski taksit',
    amount: 1500,
    status: 'bekliyor',
    due_date: addDaysKey(TODAY, -200),
  },
  {
    /* Aynı sınıf: sınıf eşleşmesine bakan bir süzgeç yabancı taksiti sızdırırdı. */
    id: A_FOREIGN_FUTURE,
    school_id: 1,
    entry_type: 'tahsilat',
    student_name: FOREIGN_STUDENT,
    class_name: ZEYNEP_CLASS,
    title: 'Yabancı öğrenci taksiti',
    amount: 9000,
    status: 'bekliyor',
    due_date: addDaysKey(TODAY, 3),
  },
  {
    id: A_FOREIGN_OVERDUE,
    school_id: 1,
    entry_type: 'tahsilat',
    student_name: FOREIGN_STUDENT,
    class_name: ZEYNEP_CLASS,
    title: 'Yabancı gecikmiş taksit',
    amount: 9000,
    status: 'bekliyor',
    due_date: addDaysKey(TODAY, -5),
  },
  {
    id: A_EXPENSE,
    school_id: 1,
    entry_type: 'gider',
    title: 'Kırtasiye alımı',
    amount: 2000,
    status: 'bekliyor',
    due_date: addDaysKey(TODAY, -3),
  },
];

/* ------------------------------- Mesajlar -------------------------------- */
/*
  Mesajlaşma kaynağı bildirim merkezine bağlandığında (bildirim merkezi sayfası
  `includeMessaging: true` gönderir) liste iki yeni sessiz hata sınıfı kazanır:

  (1) **Okunmuş kaydın hatırlatılması.** Okundu bilgisi sunucuda tutulduğu için
      istemci `unread`/`read` alanlarını dikkate almazsa, kullanıcı her açılışta
      zaten gördüğü duyuruyu yeniden "okunmamış" görür. Bu hata boş liste kadar
      sessizdir: liste dolu ve inandırıcı görünür.
  (2) **`requires_read` kapsamının kayması.** Okunması zorunlu olmayan duyuru
      hiç "okundu" işaretlenmediği için `read` alanı sonsuza kadar false kalır;
      kapı kaldırılırsa okunmamış sayacı kalıcı olarak şişer.

  Bu yüzden senaryo hem olumlu hem olumsuz satır taşır: okunmamış konuşma ve
  duyurular girmeli; okunmuş konuşma, okunmuş duyuru, `requires_read=false`
  duyuru ve pencere dışı duyuru **girmemelidir**.
*/
/** Okunmamış konuşma — listeye girmeli. */
const T_OWN = 5001;
/** Okunmuş konuşma — girmemeli. */
const T_READ = 5002;
/** Acil, okunmamış, okunması zorunlu duyuru — listeye "acil" olarak girmeli. */
const AN_URGENT = 5101;
/** Normal, okunmamış, okunması zorunlu duyuru — listeye girmeli. */
const AN_NORMAL = 5102;
/** Okunmuş duyuru — girmemeli. */
const AN_READ = 5103;
/** `requires_read = false` duyuru — girmemeli (okundu işareti hiç doğmaz). */
const AN_OPTIONAL = 5104;
/** 40 gün önce yayınlanmış duyuru — geriye bakış penceresi (30 gün) dışı. */
const AN_OLD = 5105;

/** Sunucu damgası: saat dilimi eki olmadan yerel saat olarak çözülür. */
const stampAt = (offset: number, time: string): string => `${addDaysKey(TODAY, offset)}T${time}:00`;

const messagingOverviewPayload = {
  viewer: {
    email: 'veli@okul.com',
    name: 'Veli Kişi',
    role: 'veli',
    school_id: 1,
    is_staff: false,
    can_announce: false,
  },
  threads: [
    {
      id: T_OWN,
      subject: 'Matematik denemesi hakkında',
      peer_email: 'ayse@okul.com',
      peer_name: 'Ayşe Yılmaz',
      teacher_email: 'ayse@okul.com',
      student_key: studentNameKey(ZEYNEP),
      student_name: ZEYNEP,
      last_message_at: stampAt(0, '09:40'),
      last_message_preview: 'Denemeyi birlikte değerlendirelim.',
      status: 'acik',
      unread: 2,
    },
    {
      id: T_READ,
      subject: 'Okunmuş konuşma',
      peer_email: 'rehber@okul.com',
      peer_name: 'Rehber Öğretmen',
      teacher_email: '',
      student_key: studentNameKey(ZEYNEP),
      student_name: ZEYNEP,
      last_message_at: stampAt(-1, '14:10'),
      last_message_preview: 'Görüşme notu paylaşıldı.',
      status: 'acik',
      unread: 0,
    },
  ],
  announcements: [
    {
      id: AN_URGENT,
      title: 'Yarın ders iptali',
      body: 'Yarın 3. ders yapılmayacaktır.',
      importance: 'acil',
      audience_type: 'kurum',
      audience_values: '',
      audience_labels: 'Tüm kurum',
      publish_at: addDaysKey(TODAY, 0),
      expires_at: '',
      pinned: true,
      requires_read: true,
      author_email: 'mudur@okul.com',
      author_name: 'Kurum Yöneticisi',
      created_at: stampAt(0, '08:05'),
      read: false,
      mine: false,
    },
    {
      id: AN_NORMAL,
      title: 'Veli toplantısı',
      body: 'Cumartesi saat 11:00.',
      importance: 'normal',
      audience_type: 'rol',
      audience_values: 'veli',
      audience_labels: 'Veliler',
      publish_at: addDaysKey(TODAY, -1),
      expires_at: '',
      pinned: false,
      requires_read: true,
      author_email: 'mudur@okul.com',
      author_name: 'Kurum Yöneticisi',
      created_at: stampAt(-1, '10:00'),
      read: false,
      mine: false,
    },
    {
      id: AN_READ,
      title: 'Okunmuş duyuru',
      body: 'Daha önce görüldü.',
      importance: 'normal',
      audience_type: 'kurum',
      audience_values: '',
      audience_labels: 'Tüm kurum',
      publish_at: addDaysKey(TODAY, -2),
      expires_at: '',
      pinned: false,
      requires_read: true,
      author_email: 'mudur@okul.com',
      author_name: 'Kurum Yöneticisi',
      created_at: stampAt(-2, '10:00'),
      read: true,
      mine: false,
    },
    {
      id: AN_OPTIONAL,
      title: 'Bilgilendirme (okuma zorunlu değil)',
      body: 'Kütüphane saatleri güncellendi.',
      importance: 'normal',
      audience_type: 'kurum',
      audience_values: '',
      audience_labels: 'Tüm kurum',
      publish_at: addDaysKey(TODAY, -3),
      expires_at: '',
      pinned: false,
      requires_read: false,
      author_email: 'mudur@okul.com',
      author_name: 'Kurum Yöneticisi',
      created_at: stampAt(-3, '10:00'),
      read: false,
      mine: false,
    },
    {
      id: AN_OLD,
      title: 'Eski duyuru',
      body: 'Kırk gün önce yayınlandı.',
      importance: 'normal',
      audience_type: 'kurum',
      audience_values: '',
      audience_labels: 'Tüm kurum',
      publish_at: addDaysKey(TODAY, -40),
      expires_at: '',
      pinned: false,
      requires_read: true,
      author_email: 'mudur@okul.com',
      author_name: 'Kurum Yöneticisi',
      created_at: stampAt(-40, '10:00'),
      read: false,
      mine: false,
    },
  ],
  counts: { threadUnread: 2, announcementUnread: 3, total: 5 },
};

/**
 * Beklenen mesaj bildirimi kimlikleri **senaryodan türetilir**: elle yazılan bir
 * liste, satır kümesi değiştiğinde sessizce yanlışa döner ve kanıtı anlamsız
 * kılar. Türetme uygulamanın kodunu kopyalamaz; yalnızca "hangi satır girer"
 * sorusunu senaryodan yanıtlar.
 */
const expectedMessagingIds = [
  `mesaj:konusma:${T_OWN}`,
  `mesaj:duyuru:${AN_URGENT}`,
  `mesaj:duyuru:${AN_NORMAL}`,
].sort();

/* ------------------------------ Beklenen kümeler -------------------------- */
/*
  Beklenen değerler elle yazılmaz, **senaryo satırlarından** türetilir: elle
  yazılan bir sayı, satır kümesi büyüdüğünde sessizce yanlışa döner ve kanıt
  yanlış bir şeyi doğrular. Türetme, uygulamadaki mantığı kopyalamaz; yalnızca
  "bu kimlikler hangi kola girer" sorusunu senaryodan yanıtlar.
*/
const AZ = studentNameKey(ZEYNEP);
const isInstallment = (row: AccountingEntry): boolean => row.entry_type === 'tahsilat';
const dueKeyOf = (row: AccountingEntry): string => String(row.due_date ?? '').trim().slice(0, 10);
const isUnsettled = (row: AccountingEntry): boolean => row.status !== 'odendi';

/** Veli kolunun beklenen kimlikleri (ad eşleşmesi + pencere + durum). */
const expectedVeliAccounting = accountingRows
  .filter(
    (row) =>
      isInstallment(row) &&
      isUnsettled(row) &&
      studentNameKey(row.student_name ?? '') === AZ &&
      dueKeyOf(row) <= addDaysKey(TODAY, HORIZON) &&
      dueKeyOf(row) >= addDaysKey(TODAY, -90),
  )
  .map((row) => `muhasebe:taksit:${row.id}`)
  .sort();

/** Yönetici özetine giren gecikmiş taksitler (geriye bakış sınırı yoktur). */
const expectedAdminOverdue = accountingRows
  .filter((row) => isInstallment(row) && isUnsettled(row) && dueKeyOf(row) < TODAY)
  .map((row) => row.id)
  .sort();

/** Bugün vadeli, ödenmemiş taksitler. */
const expectedAdminToday = accountingRows
  .filter((row) => isInstallment(row) && isUnsettled(row) && dueKeyOf(row) === TODAY)
  .map((row) => row.id)
  .sort();

/** İsteğin `query` alanı SDK tarafından JSON metni olarak taşınır. */
function queryOf(request: ObservedRequest): Record<string, string> {
  const raw = (request.params as Record<string, unknown> | undefined)?.query;
  if (typeof raw !== 'string' || !raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    Object.entries(parsed).forEach(([key, value]) => {
      out[key] = String(value ?? '').toLowerCase();
    });
    return out;
  } catch {
    return {};
  }
}

/** Sunucu süzgeci: sorgudaki her alan satırda birebir bulunmalı. */
function rowMatches(row: Record<string, unknown>, query: Record<string, string>): boolean {
  return Object.entries(query).every(
    ([key, value]) => String(row[key] ?? '').toLowerCase() === value,
  );
}

const asRows = (rows: object[]): Record<string, unknown>[] =>
  rows as unknown as Record<string, unknown>[];

/** Tekil kayıt yolundaki kimliği çözer. */
function singleId(url: string): number {
  const match = /\/(\d+)(?:\?.*)?$/.exec(url);
  return match ? Number(match[1]) : Number.NaN;
}

/**
 * Kişiye bağlı iki kaynağa giden isteklerin dökümü.
 *
 * Neden kaydediliyor: "yalnız kendi kaydını görüyor" iddiası, isteğin
 * **daraltılarak** gönderildiği ölçülmeden de yeşil kalabilir — süzgeç yalnız
 * istemcideyse ve sunucu tüm kurumun katılımcı satırlarını döndürüyorsa veri
 * hâlâ tarayıcıya iner, sızıntı yalnızca ağ sekmesinde görünür. Bu döküm o
 * kanıtı verir.
 */
const entityRequestLog: { entity: string; query: Record<string, string> }[] = [];

/**
 * Sunucu gibi davranan yanıt üreticisi (tanımsız dönen istek ağ hatası olur).
 *
 * ÖLÇÜLEN TUZAK — gövde şekli
 * ---------------------------
 * Burada yanıtlar bir süre `{ data: { items: [...] } }` biçiminde dönüyordu ve
 * bu, iddiaların sessizce kırmızı kalmasına yol açıyordu. Neden sessiz: kanıt
 * betiğinin döndürdüğü nesne **doğrudan axios yanıtının gövdesi** olur (`adapter`
 * içinde `data: body`), uygulama ise satırları `response.data.items` üzerinden
 * okur. Fazladan katman eklendiğinde `response.data.items` tanımsız kalır; okuma
 * fonksiyonları bunu "kayıt yok" sayar ve hata üretmez.
 *
 * Sonucu: istek gerçekten gidiyor, sorgu daraltılmış, sunucu süzgeci doğru — ama
 * ekranda hiç kayıt yok. Yani taklit, "sunucu boş döndü" gibi davranıp kapsam
 * kusurunu taklit ediyordu. Gövde artık gerçek sözleşmeye göre üretilir: liste
 * uçları `{ items }`, tekil kayıt ucu kaydın kendisini döner.
 *
 * Maliyeti ölçüldü, tahmin edilmedi: eski şekil `BENCH_LEGACY_BODY=1` ile yeniden
 * üretildiğinde 7 gerçek iddia kırmızı düşüyor (3 online veli/öğretmen + 1 online
 * öğrenci + 3 rehberlik) ve sözleşme öz-denetimi toplamı 8 FAIL'a çıkarıyor.
 *
 * Buradaki asıl tuzak şu: aynı koşuda **olumsuz iddialar yeşil kalıyor**, çünkü
 * liste boşken "yabancı kayıt sızmıyor" ifadesi boşuna doğru olur. Yani boş bir
 * liste hem gerçek kusuru hem taklit kusurunu aynı biçimde maskeler ve yalnız
 * olumlu iddialara bakan bir kanıt bu ayrımı hiç göremez.
 *
 * Aşağıdaki `verifyHarnessContract()` bu ayrımı kanıta bağlar: sözleşme bir daha
 * kayarsa kanıt betiği "kapsam yok" demek yerine **taklidin kendisini** kırmızı
 * gösterir.
 */
/**
 * Eski (hatalı) gövde şeklini isteğe bağlı yeniden üretir.
 *
 * Neden duruyor: bu dosyada anlatılan "sessiz kırmızı" tuzağı bir iddia değil,
 * ölçülmüş bir olgu olmalıdır. `BENCH_LEGACY_BODY=1` ile koşulduğunda liste uçları
 * `{ data: { items } }` biçiminde yanıtlar ve kaç iddianın kırmızı düştüğü
 * doğrudan sayılır; anahtarsız koşuda ise gerçek sözleşme kullanılır. Böylece
 * tuzağın maliyeti tekrar tekrar ölçülebilir hâle gelir ve yorumdaki sayı
 * tahmine dayanmaz.
 */
const legacyBody = process.env.BENCH_LEGACY_BODY === '1';

/** Gövdeyi aktif sözleşmeye göre biçimlendirir (bkz. `legacyBody`). */
function shapeBody(body: unknown): unknown {
  return legacyBody ? { data: body } : body;
}

function serverResponder(request: ObservedRequest): unknown | undefined {
  const url = request.url;
  const query = queryOf(request);

  if (url.includes(`/entities/${PARTICIPANT_ENTITY}`)) {
    entityRequestLog.push({ entity: PARTICIPANT_ENTITY, query });
  }
  if (url.includes(`/entities/${GUIDANCE_ENTITY}`)) {
    entityRequestLog.push({ entity: GUIDANCE_ENTITY, query });
  }
  /*
    Muhasebe istekleri de dökülür: "yetki yokken mali kayıt hiç indirilmiyor"
    iddiası yalnızca **giden isteğe** bakılarak kanıtlanabilir. Yalnız üretilen
    bildirim listesine bakılsaydı, kayıtlar tarayıcıya inip ekranda süzülse bile
    iddia yeşil kalırdı.
  */
  if (url.includes(`/entities/${ACCOUNTING_ENTITY}`)) {
    entityRequestLog.push({ entity: ACCOUNTING_ENTITY, query });
  }

  if (url.includes(`/entities/${PARTICIPANT_ENTITY}`)) {
    return shapeBody({
      items: asRows(participantRows).filter((row) => rowMatches(row, query)),
    });
  }
  if (url.includes(`/entities/${GUIDANCE_ENTITY}`)) {
    return shapeBody({ items: asRows(guidanceRows).filter((row) => rowMatches(row, query)) });
  }
  if (url.includes(`/entities/${ACCOUNTING_ENTITY}`)) {
    /*
      Muhasebe isteği sorgusuz gider (`query: {}`): kişiye indirme istemcide
      `student_name` anahtarıyla yapılır. Sunucu taklidi de bu yüzden süzgeci
      **istekte ne varsa** ona göre uygular; tanımsız bir sorgu için tüm satırları
      döndürmek gerçek davranışın aynısıdır.
    */
    return shapeBody({
      items: asRows(accountingRows).filter((row) => rowMatches(row, query)),
    });
  }
  if (url.includes(`/entities/${LESSON_ENTITY}`)) {
    if (url.includes('/all')) return shapeBody({ items: lessonRows });
    const found = lessonRows.find((row) => Number(row.id) === singleId(url));
    return shapeBody(found ?? null);
  }
  // Diğer uçlar (ders programı, okul kayıtları): ağ erişimi yok.
  return undefined;
}

/**
 * Taklit sözleşmesinin gerçekten kurulduğunu ölçer ve dönen kimlikleri verir.
 *
 * Neden gerekli: sözleşme kaydığında (gövdede fazladan `data` katmanı gibi) tüm
 * kapsam iddiaları "kayıt yok" sonucuna düşer ve bu, gerçek bir kapsam
 * kusurundan ayırt edilemez. Bu kontrol, doğrudan bir sorgu atıp satırların
 * gerçekten geldiğini doğrular; gelmiyorsa suçlu taklit, uygulama değil.
 *
 * Kimlikler döndürülür (yalnız sayı değil): böylece tek iddia hem gövde şeklini
 * hem de sunucu süzgecini birlikte kanıtlar. Yalnız "satır geldi mi" sayılsaydı
 * süzgeci hiç uygulamayan bir taklit de yeşil kalırdı.
 */
async function verifyHarnessContract(): Promise<number[] | null> {
  try {
    const probe = await client.entities.online_lesson_participants.queryAll({
      query: { parent_email: OWN_EMAIL },
      limit: 1000,
      skip: 0,
    });
    const items = (probe as { data?: { items?: { id?: number }[] } })?.data?.items;
    if (!Array.isArray(items)) return null;
    return items.map((row) => Number(row.id));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Yardımcılar                                                         */
/* ------------------------------------------------------------------ */

const isLesson = (n: AppNotification): boolean => n.kind === 'ders';
const isHomework = (n: AppNotification): boolean => n.kind === 'odev';
const isOnline = (n: AppNotification): boolean => n.kind === 'online';
const isGuidance = (n: AppNotification): boolean => n.kind === 'rehberlik';
const isAccounting = (n: AppNotification): boolean => n.kind === 'muhasebe';
const isMessage = (n: AppNotification): boolean => n.kind === 'mesaj';

function lessonItems(items: AppNotification[]): AppNotification[] {
  return items.filter(isLesson);
}

/** `detail` alanındaki "HH:MM-HH:MM" aralığından bitiş dakikasını çözer. */
function endTimeOf(item: AppNotification): number {
  const match = /(\d{2}:\d{2})-(\d{2}:\d{2})/.exec(item.detail);
  return match ? timeMinutes(match[2]) : -1;
}

function hasClass(items: AppNotification[], name: string): boolean {
  return items.some((i) => i.title.includes(name));
}

/** Başlıktaki "· N kayıt" sayısını çözer (özet satırlarında kayıt sayısı). */
function countOfTitle(item: AppNotification): number {
  const match = /·\s*(\d+)\s*kayıt/.exec(item.title);
  return match ? Number(match[1]) : -1;
}

/* ------------------------------------------------------------------ */
/* Koşu                                                                */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const wired = installBridge() && (await bridgeWorks());
  if (!wired) {
    console.log('UYARI: köprü taklidi kurulamadı, ödev tazeleme iddiası ölçülemez.');
  }
  // Online ders ve rehberlik uçları sunucu gibi yanıtlanır (bkz. sunucu taklidi).
  setAxiosResponder(serverResponder);
  saveToken('bench-token');
  saveRecords({ version: 1, goals: {}, homework: [], notes: [] });

  /*
    Taklit sözleşmesi iddialardan ÖNCE ölçülür.
    Neden: gövde şekli kaydığında aşağıdaki tüm kapsam iddiaları "kayıt yok"
    sonucuna düşer ve bu, gerçek bir kapsam kusurundan ayırt edilemez. Bu kontrol
    suçluyu açıkça adlandırır; olmasaydı taklidin kendi hatası uygulamanın kapsam
    hatası gibi raporlanırdı (ölçüldü: eski gövde şekliyle 8 FAIL, bunun 7'si
    gerçek iddia, 1'i bu öz-denetim; olumsuz iddialar boş listede sahte yeşil kalır).

    Beklenen kimlik kümesi senaryodan türetilir, tahminle yazılmaz: veli
    e-postasını taşıyan satırlar `p-own` + aynı velinin iptal ve geçmiş ders
    katılımlarıdır (katılım satırı dersin durumundan bağımsız olarak vardır).
  */
  const expectedParticipantIds = [7001, 7003, 7004].sort((a, b) => a - b);
  const contractIds = await verifyHarnessContract();
  check(
    'taklit sözleşmesi doğru: liste ucu { items } döndürüyor, satır uygulamaya ulaşıyor ve sunucu süzgeci uygulanıyor',
    contractIds !== null &&
      JSON.stringify(contractIds.sort((a, b) => a - b)) === JSON.stringify(expectedParticipantIds),
    contractIds === null
      ? 'sonda yanıtı okunamadı — taklit sözleşmesi bozuk (liste ucu { items } bekler)'
      : `dönen kimlikler: ${JSON.stringify(contractIds)} (beklenen ${JSON.stringify(
          expectedParticipantIds,
        )})`,
  );

  const zeynepKey = studentNameKey(ZEYNEP);
  const baseScope = {
    schoolId: 1,
    email: 'veli@okul.com',
    fullName: 'Veli Kişi',
    horizonDays: HORIZON,
  };

  /* --- 1) Veli / öğrenci: yüz yüze ders bildirimi artık üretiliyor --- */
  console.log('\n[1] Veli (Zeynep K. · 8-A) — yüz yüze ders kapsamı');
  const veli = await loadNotifications({
    ...baseScope,
    studentKeys: new Set([zeynepKey]),
    studentClasses: new Set([ZEYNEP_CLASS]),
    studentNames: [ZEYNEP],
  });
  const veliLessons = lessonItems(veli);
  const todayLessons = veliLessons.filter((i) => i.dateKey === TODAY);
  const futureLessons = veliLessons.filter((i) => i.dateKey !== TODAY);

  check(
    'veliye ders bildirimi üretiliyor (eskiden bu kapsam hiç çalışmıyordu)',
    veliLessons.length > 0,
    `ders bildirimi sayısı: ${veliLessons.length}`,
  );
  check(
    'bugünün ders saatleri yalnızca bitmemişse listeleniyor',
    todayLessons.every((i) => endTimeOf(i) >= 0 && endTimeOf(i) >= nowMinutes()),
    `bitmiş ders saati listeye girmiş: ${todayLessons.map((i) => i.detail).join(' | ')}`,
  );
  check(
    'bugün 2 kayıt (sınıf dersi + adına yazılmış ek ders) veya 0 (hepsi bitmiş)',
    todayLessons.length === 0 || todayLessons.length === PER_DAY,
    `bugünkü kayıt: ${todayLessons.length}`,
  );
  check(
    'ileri 7 günün tamamı günde 2 kayıtla listeleniyor (bugüne bakmak yetersiz olurdu)',
    futureLessons.length === HORIZON * PER_DAY,
    `ileri gün kaydı: ${futureLessons.length} (beklenen ${HORIZON * PER_DAY})`,
  );
  check(
    'en uzak kayıt horizon sınırında',
    veliLessons.every((i) => i.dateKey <= addDaysKey(TODAY, HORIZON)),
    `sınır dışı tarih var: ${veliLessons
      .map((i) => i.dateKey)
      .filter((d) => d > addDaysKey(TODAY, HORIZON))
      .join(', ')}`,
  );
  check(
    'kendi sınıfının dersi gösteriliyor',
    hasClass(veliLessons, ZEYNEP_CLASS),
    `8-A kaydı yok: ${veliLessons.map((i) => i.title).slice(0, 3).join(' | ')}`,
  );
  check(
    'adına yazılmış (sınıfı boş) ek ders ad eşleşmesiyle görünüyor',
    hasClass(veliLessons, ZEYNEP),
    `adına yazılmış ek ders yok: ${veliLessons.map((i) => i.title).slice(0, 4).join(' | ')}`,
  );
  check(
    'BAŞKA sınıfın ders saati veliye gösterilmiyor (negatif)',
    !hasClass(veliLessons, '8-B') && !hasClass(veliLessons, '8-C'),
    `sızan sınıf: ${veliLessons
      .map((i) => i.title)
      .filter((t) => t.includes('8-B') || t.includes('8-C'))
      .join(' | ')}`,
  );
  check(
    'veli ders bildirimi ders programına yönlendiriyor',
    veliLessons.every((i) => i.link === '/ders-programi'),
    `beklenmeyen hedef: ${[...new Set(veliLessons.map((i) => i.link))].join(', ')}`,
  );

  /* --- 2) Eşleşmeyen hesaba uydurma ders üretilmiyor --- */
  console.log('\n[2] Eşleşmeyen veli/öğrenci — uydurma bildirim yok');
  const aliScope = await loadNotifications({
    ...baseScope,
    studentKeys: new Set([studentNameKey('Ali Veli')]),
    studentClasses: new Set<string>(),
    studentNames: ['Ali Veli'],
  });
  check(
    'sınıfı ve adı eşleşmeyen hesaba hiç ders bildirimi üretilmiyor (negatif)',
    lessonItems(aliScope).length === 0,
    `beklenmeyen kayıt: ${lessonItems(aliScope).map((i) => i.title).join(' | ')}`,
  );

  const emptyScope = await loadNotifications({ ...baseScope, studentKeys: new Set<string>() });
  check(
    'kapsamsız (ne genel ne öğretmen) hesaba ders bildirimi üretilmiyor (negatif)',
    lessonItems(emptyScope).length === 0,
    `beklenmeyen kayıt: ${lessonItems(emptyScope).map((i) => i.title).join(' | ')}`,
  );

  /* --- 3) Öğretmen: yalnızca kendi ders saatleri --- */
  console.log('\n[3] Öğretmen (Ayşe Yılmaz) — kendi ders saatleri');
  const teacher = await loadNotifications({
    ...baseScope,
    email: 'ayse@okul.com',
    fullName: 'Ayşe Yılmaz',
    teacherScoped: true,
  });
  const teacherLessons = lessonItems(teacher);
  check(
    'öğretmene ders bildirimi üretiliyor',
    teacherLessons.length > 0,
    `ders bildirimi sayısı: ${teacherLessons.length}`,
  );
  check(
    'başka öğretmenin ders saati öğretmene gösterilmiyor (negatif)',
    !hasClass(teacherLessons, '8-C'),
    `sızan ders: ${teacherLessons.filter((i) => i.title.includes('8-C')).length}`,
  );
  check(
    'öğretmen bildirimi yoklama ekranına yönlendiriyor',
    teacherLessons.every((i) => i.link === '/yoklama'),
    `beklenmeyen hedef: ${[...new Set(teacherLessons.map((i) => i.link))].join(', ')}`,
  );

  /* --- 4) Yönetici: kurum geneli + liste üst sınırı --- */
  console.log('\n[4] Yönetici — kurum geneli ve liste üst sınırı');
  const admin = await loadNotifications({ ...baseScope, viewAll: true });
  const adminLessons = lessonItems(admin);
  check(
    'yönetici kurum genelini görüyor (başka öğretmenin sınıfı dahil)',
    hasClass(adminLessons, '8-C'),
    `8-C kaydı yok: ${adminLessons.length} kayıt`,
  );
  check(
    'ders listesi üst sınırla kırpılıyor (32 olasılığa karşı en fazla 24)',
    adminLessons.length === 24,
    `kırpma çalışmadı: ${adminLessons.length} kayıt`,
  );

  /* --- 5) Sıralama --- */
  console.log('\n[5] Bildirim sırası');
  const stamp = (i: AppNotification): string => `${i.dateKey} ${i.time ?? '99:99'}`;
  const ascending = veli.every(
    (item, index) => index === 0 || stamp(veli[index - 1]) <= stamp(item),
  );
  check('bildirimler tarih + saat sırasına göre artan', ascending, 'sıra bozuk');

  /* --- 6) Pencere gerçekten daralıyor mu --- */
  console.log('\n[6] Kısa pencere (horizon = 1)');
  const tight = await loadNotifications({
    ...baseScope,
    horizonDays: 1,
    studentKeys: new Set([zeynepKey]),
    studentClasses: new Set([ZEYNEP_CLASS]),
    studentNames: [ZEYNEP],
  });
  const tightLessons = lessonItems(tight);
  const tomorrow = addDaysKey(TODAY, 1);
  check(
    'kısa pencerede yarından sonrası listeye girmiyor (negatif)',
    tightLessons.every((i) => i.dateKey === TODAY || i.dateKey === tomorrow),
    `sınır dışı gün sızdı: ${tightLessons
      .map((i) => i.dateKey)
      .filter((d) => d !== TODAY && d !== tomorrow)
      .join(', ')}`,
  );
  check(
    'geniş pencerede kayıt sayısı kısa pencereden fazla (pencere gerçekten çalışıyor)',
    veliLessons.length > tightLessons.length,
    `geniş: ${veliLessons.length}, kısa: ${tightLessons.length}`,
  );

  /* --- 7) Ödev: uzak tazeleme A/B --- */
  console.log('\n[7] Ödev teslimleri — uzak kayıt tazelemesi (A/B)');
  if (wired) {
    const before = await loadNotifications({
      ...baseScope,
      studentKeys: new Set([zeynepKey]),
      studentClasses: new Set([ZEYNEP_CLASS]),
      studentNames: [ZEYNEP],
    });

    const homework: Homework[] = [
      {
        id: 'h-1',
        studentKey: zeynepKey,
        studentName: ZEYNEP,
        title: 'Matematik deneme tekrarı',
        subject: 'Matematik',
        assignedAt: addDaysKey(TODAY, -1),
        dueAt: addDaysKey(TODAY, 3),
        status: 'atandi',
      },
      /*
        Kapatılmış kayıtların ikisi de **görüş taşır**.

        Görüş alanı olmadan `yapildi`/`yapilmadi` yazan bir kayıt, okuma yolunda
        "Devam ediyor"a çekilir (`normalizeHomework`): görüşsüz kapatma kuralı
        geriye dönük uygulanır ve böyle bir ödev hâlâ açık sayılır. Bu yüzden
        senaryonun eski hâli kural yürürlüğe girmeden önceki bir kurulumu temsil
        ediyordu ve iki iddiayı haklı olarak kırdı: "tamamlanmış ödev
        hatırlatılmıyor" iddiası, kaydın kapalı olmadığı bir kurulumda ölçülemez.
        Görüş eklenmesi senaryoyu ürün kuralına hizalar; iddiaların kendisi
        değişmez.
      */
      {
        id: 'h-2',
        studentKey: zeynepKey,
        studentName: ZEYNEP,
        title: 'Gecikmiş ödev',
        subject: 'Matematik',
        assignedAt: addDaysKey(TODAY, -5),
        dueAt: addDaysKey(TODAY, -2),
        status: 'yapilmadi',
        result: 'Ödev yapılmadı, veli bilgilendirildi.',
      },
      {
        id: 'h-3',
        studentKey: zeynepKey,
        studentName: ZEYNEP,
        title: 'Bitmiş ödev',
        subject: 'Matematik',
        assignedAt: addDaysKey(TODAY, -3),
        dueAt: addDaysKey(TODAY, 1),
        status: 'yapildi',
        result: 'Ödev tamamlandı, kontrol edildi.',
      },
      {
        id: 'h-4',
        studentKey: studentNameKey('Başka Öğrenci'),
        studentName: 'Başka Öğrenci',
        title: 'Başka öğrencinin ödevi',
        subject: 'Matematik',
        assignedAt: addDaysKey(TODAY, -1),
        dueAt: addDaysKey(TODAY, 1),
        status: 'atandi',
      },
    ];
    const remote: SchoolRecords = { version: 1, goals: {}, homework, notes: [] };
    remoteRecordsUrl = `data:application/json;base64,${Buffer.from(
      JSON.stringify(remote),
      'utf8',
    ).toString('base64')}`;

    const after = await loadNotifications({
      ...baseScope,
      studentKeys: new Set([zeynepKey]),
      studentClasses: new Set([ZEYNEP_CLASS]),
      studentNames: [ZEYNEP],
    });

    check(
      'uzak kayıt yokken (yerel önbellek boş) ödev bildirimi çıkmıyor — belirtinin kökü',
      before.filter(isHomework).length === 0,
      `beklenmeyen ödev: ${before.filter(isHomework).length}`,
    );
    check(
      'bildirim yüklemesi okul kayıtlarını sunucudan tazeliyor (tazeleme çağrısı ölçüldü)',
      bridgeCalls.some((c) => c.kind === 'records'),
      `kayıt tazeleme çağrısı yok: ${JSON.stringify(bridgeCalls.slice(0, 4))}`,
    );
    const odev = after.filter(isHomework);
    check(
      'başka cihazda girilen ödev bildirim merkezinde görünüyor',
      odev.length === 2,
      `ödev sayısı: ${odev.length} (beklenen 2)`,
    );
    check(
      'tamamlanmış ödev hatırlatılmıyor, gecikmiş ödev görünüyor (negatif + olumlu)',
      !odev.some((i) => i.title.includes('Bitmiş')) &&
        odev.some((i) => i.title.includes('Gecikmiş')),
      `görünen: ${odev.map((i) => i.title).join(' | ')}`,
    );
    check(
      'başka öğrencinin ödevi veliye sızmıyor (negatif)',
      !odev.some((i) => i.title.includes('Başka öğrencinin')),
      `sızan ödev: ${odev.map((i) => i.title).join(' | ')}`,
    );
  } else {
    console.log('  ATLA ödev tazeleme iddiaları (köprü taklidi kurulamadı)');
  }

  /* --- 8) Yalnız sınıf verilmiş (ad listesi boş) hesap --- */
  console.log('\n[8] Yalnız sınıf verilmiş (ad listesi boş) hesap');
  const classOnly = await loadNotifications({
    ...baseScope,
    studentKeys: new Set([zeynepKey]),
    studentClasses: new Set([ZEYNEP_CLASS]),
  });
  const classOnlyLessons = lessonItems(classOnly);
  check(
    'sınıf eşleşmesi tek başına yeterli (ad listesi boş olsa da ders gösterilir)',
    classOnlyLessons.length > 0 && hasClass(classOnlyLessons, ZEYNEP_CLASS),
    `ders bildirimi: ${classOnlyLessons.length}`,
  );
  /*
    Beklenen değer tahminle değil ölçülen farkla karşılaştırılır: ada dayalı ek
    dersler yalnızca `studentNames` doluyken listeye girer, bu yüzden düşen kayıt
    sayısı tam olarak adı geçen kayıt sayısına eşit olmalıdır. Eşitlik olmasa
    sınıf süzgecinin kendisi de kayıt düşürüyor demektir ve bu ayrı bir hatadır.
  */
  const namedLessons = veliLessons.filter((i) => i.title.includes(ZEYNEP));
  check(
    'ad listesi boşken ada dayalı ek ders gösterilmiyor (belirsizlikte göstermeme)',
    !hasClass(classOnlyLessons, ZEYNEP) &&
      namedLessons.length > 0 &&
      classOnlyLessons.length === veliLessons.length - namedLessons.length,
    `sınıf dersi: ${classOnlyLessons.length}, adlı kayıt: ${namedLessons.length}, beklenen: ${
      veliLessons.length - namedLessons.length
    }`,
  );

  /* --- 9) Online ders: veli yalnız kendi dersini görüyor --- */
  console.log('\n[9] Online ders — veli / öğretmen kapsamı');
  entityRequestLog.length = 0;
  const onlineVeli = await loadNotifications({
    ...baseScope,
    studentKeys: new Set([zeynepKey]),
    studentClasses: new Set([ZEYNEP_CLASS]),
    studentNames: [ZEYNEP],
  });
  const onlineItems = onlineVeli.filter(isOnline);
  check(
    'velinin kendi online dersi bildirim merkezinde görünüyor',
    onlineItems.some((i) => i.title.includes('Paragraf')),
    `online bildirim: ${onlineItems.map((i) => i.title).join(' | ') || 'yok'}`,
  );
  check(
    'iptal edilmiş online ders hatırlatılmıyor (negatif)',
    !onlineItems.some((i) => i.title.includes('İptal')),
    `sızan iptal kaydı: ${onlineItems.map((i) => i.title).join(' | ')}`,
  );
  check(
    'dün yapılmış online ders listeye girmiyor (negatif)',
    !onlineItems.some((i) => i.title.includes('Dün')),
    `sızan geçmiş kayıt: ${onlineItems.map((i) => i.title).join(' | ')}`,
  );
  check(
    'başka öğrencinin online dersi veliye sızmıyor (negatif)',
    !onlineItems.some((i) => i.title.includes('Yabancı')),
    `sızan yabancı ders: ${onlineItems.map((i) => i.title).join(' | ')}`,
  );
  /*
    Sonda burada DEĞİL, koşunun başında bir kez çalışır (bkz. `verifyHarnessContract`):
    sözleşme bozuksa tüm iddialar aynı anda kırmızı olur ve tek tek uğraşmak
    yerine kök nedeni ilk satırda görmek gerekir.
  */
  const participantQueries = entityRequestLog
    .filter((r) => r.entity === PARTICIPANT_ENTITY)
    .map((r) => r.query);
  check(
    'katılımcı isteği giriş e-postası/adıyla daraltılıyor (tüm kurum istenmiyor)',
    participantQueries.length > 0 &&
      participantQueries.every((q) => Object.keys(q).length === 1),
    `daraltılmamış istek: ${JSON.stringify(
      participantQueries.filter((q) => Object.keys(q).length !== 1),
    )}`,
  );
  check(
    'katılımcı isteğinde yabancı veli e-postası hiç geçmiyor (negatif)',
    !participantQueries.some((q) => JSON.stringify(q).includes(FOREIGN_EMAIL)),
    'yabancı veli e-postası istendi',
  );

  const onlineOther = await loadNotifications({
    ...baseScope,
    email: FOREIGN_EMAIL,
    studentKeys: new Set([studentNameKey(FOREIGN_STUDENT)]),
    studentClasses: new Set([ZEYNEP_CLASS]),
    studentNames: [FOREIGN_STUDENT],
  });
  const onlineOtherItems = onlineOther.filter(isOnline);
  check(
    'başka veli kendi dersini görüyor, Zeynep’in dersini görmüyor (negatif)',
    onlineOtherItems.some((i) => i.title.includes('Yabancı')) &&
      !onlineOtherItems.some((i) => i.title.includes('Paragraf')),
    `görünen: ${onlineOtherItems.map((i) => i.title).join(' | ') || 'yok'}`,
  );

  const onlineTeacher = await loadNotifications({
    ...baseScope,
    email: 'ayse@okul.com',
    fullName: 'Ayşe Yılmaz',
    teacherScoped: true,
  });
  const onlineTeacherItems = onlineTeacher.filter(isOnline);
  check(
    'öğretmen yalnız kendi adına açılmış online dersi görüyor (negatif)',
    onlineTeacherItems.some((i) => i.title.includes('Paragraf')) &&
      !onlineTeacherItems.some((i) => i.title.includes('Yabancı')),
    `öğretmen online: ${onlineTeacherItems.map((i) => i.title).join(' | ') || 'yok'}`,
  );

  /*
    Öğrenci hesabı. Kullanıcının saydığı üç görünümden biri olduğu hâlde burada
    ölçülmüyordu: kapsam kodu veliyi `parent_email`, öğrenciyi `student_email`
    bağından çözer. Yalnız veli kolu sınandığında öğrenci dalındaki bir hata
    (örneğin ad bağının kapsamı gevşetmesi) hiç görünmezdi.
  */
  console.log('\n[9b] Online ders — öğrenci hesabı kapsamı');
  const onlineStudent = await loadNotifications({
    ...baseScope,
    email: STUDENT_EMAIL,
    fullName: ZEYNEP,
    studentKeys: new Set([zeynepKey]),
    studentNames: [ZEYNEP],
  });
  const studentOnline = onlineStudent.filter(isOnline);
  check(
    'öğrenci kendi e-postasıyla yazılmış dersini görüyor (student_email bağı)',
    studentOnline.some((i) => i.title.includes('Öğrenci hesabı')),
    `öğrenci online: ${studentOnline.map((i) => i.title).join(' | ') || 'yok'}`,
  );
  check(
    'başka öğrencinin online dersi öğrenciye sızmıyor (negatif)',
    !studentOnline.some((i) => i.title.includes('Yabancı')),
    `sızan yabancı ders: ${studentOnline.map((i) => i.title).join(' | ')}`,
  );
  check(
    'aynı sınıftaki başka öğrencinin dersi sınıf eşleşmesiyle sızmıyor (negatif)',
    !studentOnline.some((i) => i.title.includes('Yabancı')),
    'sınıf bilgisi üzerinden yabancı ders göründü',
  );

  /* --- 10) Rehberlik: veli yalnız bağlı öğrencisinin takibini görüyor --- */
  console.log('\n[10] Rehberlik takibi — veli kapsamı');
  const guidanceVeli = await loadNotifications({
    ...baseScope,
    studentKeys: new Set([zeynepKey]),
    studentNames: [ZEYNEP],
    includeGuidance: true,
  });
  const gItems = guidanceVeli.filter(isGuidance);
  check(
    'velinin bağlı öğrencisinin yaklaşan takibi görünüyor',
    gItems.some((i) => i.title.includes('Ölçek')),
    `rehberlik bildirimi: ${gItems.map((i) => i.title).join(' | ') || 'yok'}`,
  );
  check(
    'vadesi geçmiş takip gecikmiş olarak işaretleniyor (aciliyet doğru)',
    gItems.some((i) => i.title.includes('Gecikmiş') && i.urgency === 'geciken'),
    `aciliyet: ${gItems.map((i) => `${i.title}=${i.urgency}`).join(' | ')}`,
  );
  check(
    'başka öğrencinin takibi veliye sızmıyor (negatif)',
    !gItems.some((i) => i.title.includes('Yabancı')),
    `sızan kayıt: ${gItems.map((i) => i.title).join(' | ')}`,
  );
  check(
    '40 gün önceki takip penceresi dışında kalıyor (negatif)',
    !gItems.some((i) => i.title.includes('Eski')),
    `sızan eski kayıt: ${gItems.map((i) => i.title).join(' | ')}`,
  );

  const guidanceAdmin = await loadNotifications({
    ...baseScope,
    viewAll: true,
    includeGuidance: true,
  });
  const gAdmin = guidanceAdmin.filter(isGuidance);
  check(
    'yetkili hesap kurum geneli takipleri görebiliyor (kapsam gerçekten daraltıyor)',
    gAdmin.length > gItems.length,
    `yönetici: ${gAdmin.length}, veli: ${gItems.length}`,
  );

  const guidanceEmpty = await loadNotifications({
    ...baseScope,
    studentKeys: new Set<string>(),
  });
  check(
    'kapsamsız hesaba rehberlik bildirimi üretilmiyor (negatif)',
    guidanceEmpty.filter(isGuidance).length === 0,
    `beklenmeyen kayıt: ${guidanceEmpty.map((i) => i.title).join(' | ')}`,
  );

  /* --- 11) Muhasebe / taksit bildirimleri — yetkiye bağlı kapsam --- */
  /*
    Muhasebe kolu bu turda eklendi ve iddiaları iki katmanlı kurmak zorunludur:
    veli kolunda kişiye indirme **istemcide** (`student_name`) yapıldığı için
    "yalnız kendi taksitini görüyor" ifadesi, süzgeç gevşediğinde ekranda
    "fazladan bildirim" olarak görünür ve gözle ayırt edilmez. Bu yüzden her
    olumlu iddianın karşıtı (ödenmiş, pencere dışı, eski, yabancı, gider) aynı
    koşuda ölçülür.
  */
  console.log('\n[11] Muhasebe taksitleri — veli ve yönetici kapsamı');
  entityRequestLog.length = 0;
  const accountingVeli = await loadNotifications({
    ...baseScope,
    studentKeys: new Set([zeynepKey]),
    studentNames: [ZEYNEP],
    includeAccounting: true,
  });
  const veliAccounting = accountingVeli.filter(isAccounting);
  const veliAccountingIds = veliAccounting.map((i) => i.id).sort();

  check(
    'veliye taksit bildirimi üretiliyor (muhasebe kolu sessiz kalmıyor)',
    veliAccounting.length > 0,
    `taksit bildirimi sayısı: ${veliAccounting.length}`,
  );
  check(
    'velinin taksit kümesi (ad eşleşmesi + pencere + durum) senaryodan türeyen beklentiyle birebir aynı',
    JSON.stringify(veliAccountingIds) === JSON.stringify(expectedVeliAccounting),
    `dönen: ${JSON.stringify(veliAccountingIds)} (beklenen ${JSON.stringify(expectedVeliAccounting)})`,
  );
  check(
    'ödenmiş taksit hatırlatılmıyor (negatif — vadesi dün, yani pencerenin içinde)',
    !veliAccountingIds.includes(`muhasebe:taksit:${A_OWN_PAID}`),
    `ödenmiş kayıt listeye girmiş: ${veliAccounting.map((i) => i.title).join(' | ')}`,
  );
  check(
    'vadesi 30 gün sonraki taksit pencere dışında (negatif)',
    !veliAccountingIds.includes(`muhasebe:taksit:${A_OWN_FAR}`),
    `pencere dışı kayıt: ${veliAccounting.map((i) => i.title).join(' | ')}`,
  );
  check(
    '200 gün gecikmiş taksit velinin geriye bakış sınırı dışında kalıyor (negatif)',
    !veliAccountingIds.includes(`muhasebe:taksit:${A_OWN_ANCIENT}`),
    `sızan eski kayıt: ${veliAccounting.map((i) => i.title).join(' | ')}`,
  );
  check(
    'başka öğrencinin taksiti veliye sızmıyor (negatif — aynı sınıfta kayıtlı)',
    !veliAccountingIds.includes(`muhasebe:taksit:${A_FOREIGN_FUTURE}`) &&
      !veliAccountingIds.includes(`muhasebe:taksit:${A_FOREIGN_OVERDUE}`),
    `sızan yabancı kayıt: ${veliAccounting.map((i) => i.title).join(' | ')}`,
  );
  check(
    'gider kalemi taksit hatırlatması üretmiyor (negatif)',
    !veliAccounting.some((i) => i.title.includes('Kırtasiye')),
    `gider kaydı listeye girmiş: ${veliAccounting.map((i) => i.title).join(' | ')}`,
  );
  check(
    'gecikmiş taksitin aciliyeti "geciken" (gün etiketi doğru)',
    veliAccounting.some(
      (i) => i.id === `muhasebe:taksit:${A_OWN_OVERDUE}` && i.urgency === 'geciken',
    ),
    `aciliyet: ${veliAccounting.map((i) => `${i.title}=${i.urgency}`).join(' | ')}`,
  );
  check(
    'bugün vadeli taksitin aciliyeti "bugun"',
    veliAccounting.some((i) => i.id === `muhasebe:taksit:${A_OWN_TODAY}` && i.urgency === 'bugun'),
    `aciliyet: ${veliAccounting.map((i) => `${i.title}=${i.urgency}`).join(' | ')}`,
  );
  /*
    TARİH TABANI SÖZLEŞMESİ — bu iddia kanıt koşusunda **gerçek bir kusur** yakaladı.
    `site.ts` kendi `todayKey()`'ini `toISOString()` (UTC) ile üretiyordu; bildirim
    üreticisi ise yerel takvimle çalışıyor. İki taban çeliştiğinde bugün vadeli
    taksit "gecikti" sayılıp yöneticinin gecikmiş tahsilat özetine giriyordu
    (ölçülen: 4 kayıt / 18.500 · doğrusu 3 kayıt / 15.500) ve velinin
    bildiriminde "bugün" etiketi kayboluyordu. Kusur ekranda görünmez çünkü
    yalnızca gün sınırında ortaya çıkar; bu yüzden üç iddia gün sınırının iki
    yanını ve iki modülün aynı tabanı kullandığını birlikte ölçer.
  */
  const localCalendarKey = (() => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  })();
  check(
    'bugün tanımı yerel takvimle aynı (iki modül aynı gün tabanını kullanıyor)',
    siteTodayKey() === localCalendarKey && TODAY === localCalendarKey,
    `site=${siteTodayKey()} kanıt=${TODAY} yerel=${localCalendarKey} UTC=${new Date()
      .toISOString()
      .slice(0, 10)} dilim=${-new Date().getTimezoneOffset() / 60}h`,
  );
  const dueRow = (due: string): AccountingEntry =>
    ({ status: 'bekliyor', due_date: due, entry_type: 'tahsilat' }) as unknown as AccountingEntry;
  check(
    'bugün vadeli taksit gecikmiş sayılmıyor (gün sınırının bugün tarafı)',
    effectiveStatus(dueRow(TODAY)) === 'bekliyor',
    `bugün ${TODAY} → ${effectiveStatus(dueRow(TODAY))}`,
  );
  check(
    'dün vadeli taksit gecikmiş sayılıyor (gün sınırının dün tarafı)',
    effectiveStatus(dueRow(addDaysKey(TODAY, -1))) === 'gecikti',
    `dün ${addDaysKey(TODAY, -1)} → ${effectiveStatus(dueRow(addDaysKey(TODAY, -1)))}`,
  );
  check(
    'taksit bildirimi muhasebe ekranına yönlendiriyor',
    veliAccounting.every((i) => i.link === '/muhasebe'),
    `beklenmeyen hedef: ${[...new Set(veliAccounting.map((i) => i.link))].join(', ')}`,
  );
  /*
    Taksit kimliği biçimi ve tekilliği ayrıca ölçülür: gider kalemi `tahsilat`
    kapısından geçseydi ya da aynı taksit iki kez üretilseydi liste "dolu ve
    doğru" görünürdü; sayı iddiası bunu yakalamaz, kimlik iddiası yakalar.
  */
  check(
    'her satır tekil bir taksit kimliği taşıyor (tür kapısı + tekrar yok)',
    veliAccounting.every((i) => /^muhasebe:taksit:\d+$/.test(i.id)) &&
      new Set(veliAccountingIds).size === veliAccountingIds.length,
    `beklenmeyen kimlik: ${veliAccountingIds
      .filter((id) => !/^muhasebe:taksit:\d+$/.test(id))
      .join(', ')} · satır ${veliAccountingIds.length}, tekil ${new Set(veliAccountingIds).size}`,
  );

  const accountingQueries = entityRequestLog
    .filter((r) => r.entity === ACCOUNTING_ENTITY)
    .map((r) => r.query);
  check(
    'yetkili veli için mali kayıt isteniyor ve istek sorgusuz gidiyor (kişiye indirme istemcide)',
    accountingQueries.length > 0 && accountingQueries.every((q) => Object.keys(q).length === 0),
    `istenen sorgular: ${JSON.stringify(accountingQueries)}`,
  );

  const accountingAdmin = await loadNotifications({
    ...baseScope,
    viewAll: true,
    includeAccounting: true,
  });
  const adminAccounting = accountingAdmin.filter(isAccounting);
  const adminTitles = adminAccounting.map((i) => i.title).join(' | ');
  const overdueItem = adminAccounting.find((i) => i.title.startsWith('Gecikmiş taksit'));
  /*
    Beklenen tutar elle yazılmaz: gecikmiş satırların toplamı senaryodan
    hesaplanır. Elle yazılan bir sayı, satır kümesi büyüdüğünde sessizce
    yanlışa döner ve özet tutarını doğrulamaz.
  */
  const overdueTotal = expectedAdminOverdue.reduce((sum, id) => {
    const row = accountingRows.find((r) => r.id === id);
    return sum + (Number(row?.amount) || 0);
  }, 0);

  check(
    'yönetici gecikmiş tahsilat özetini görüyor ve kayıt sayısı ölçümle aynı',
    Boolean(overdueItem) && countOfTitle(overdueItem as AppNotification) === expectedAdminOverdue.length,
    `yönetici muhasebe: ${adminTitles || 'yok'} (beklenen kayıt ${expectedAdminOverdue.length})`,
  );
  check(
    'özet toplam tutarı gecikmiş satırların toplamıyla aynı (türetilmiş tutar)',
    Boolean(overdueItem) && (overdueItem as AppNotification).detail.includes(formatTry(overdueTotal)),
    `detay: ${overdueItem?.detail ?? 'yok'} (beklenen tutar ${formatTry(overdueTotal)})`,
  );
  /*
    İki kolun bilinçli farkı burada kilitlenir: veli kolunda 90 günlük geriye
    bakış vardır, yönetici özetinde yoktur. Fark ölçülmezse ileride "ortak sınır"
    diye tek kural konur ve kurumun en eski borcu özetten sessizce düşer.
  */
  check(
    'yönetici gecikmiş özetinde geriye bakış sınırı yok (200 günlük taksit de sayılıyor)',
    expectedAdminOverdue.includes(A_OWN_ANCIENT) && !expectedAdminOverdue.includes(A_OWN_PAID),
    `beklenen gecikmiş satırlar: ${JSON.stringify(expectedAdminOverdue)}`,
  );
  check(
    'bugün vadesi gelen taksit yöneticiye ayrı özet olarak çıkıyor',
    adminAccounting.some(
      (i) =>
        i.title.startsWith('Bugün vadesi gelen taksit') &&
        countOfTitle(i) === expectedAdminToday.length,
    ),
    `yönetici muhasebe: ${adminTitles || 'yok'} (beklenen bugün ${expectedAdminToday.length})`,
  );
  check(
    'gider kalemi ve ödenmiş kayıt yönetici özetlerine de girmiyor (negatif)',
    !adminAccounting.some((i) => i.title.includes('Kırtasiye')) && !expectedAdminOverdue.includes(A_OWN_PAID),
    `yönetici muhasebe: ${adminTitles || 'yok'}`,
  );
  check(
    'yönetici özeti de muhasebe ekranına yönlendiriyor',
    adminAccounting.every((i) => i.link === '/muhasebe'),
    `beklenmeyen hedef: ${[...new Set(adminAccounting.map((i) => i.link))].join(', ')}`,
  );

  /*
    Öğretmen kolunda muhasebe yetkisi açık olsa bile kurum geneli özet
    üretilmemelidir: `teacherScoped` kendi dersiyle sınırlıdır ve okulun tahsilat
    borcunu görmesi kapsam sızıntısı olurdu.
  */
  const accountingTeacher = await loadNotifications({
    ...baseScope,
    email: 'ayse@okul.com',
    fullName: 'Ayşe Yılmaz',
    teacherScoped: true,
    includeAccounting: true,
  });
  check(
    'öğretmen kapsamına kurum geneli mali özet üretilmiyor (negatif)',
    accountingTeacher.filter(isAccounting).length === 0,
    `sızan kayıt: ${accountingTeacher.filter(isAccounting).map((i) => i.title).join(' | ')}`,
  );

  /*
    Yetki yoksa mali kayıt **hiç indirilmemelidir**. Yalnız üretilen listeye
    bakmak bu iddiayı kanıtlamaz: kayıtlar tarayıcıya inip ekranda süzülse de
    liste boş görünür. Kanıt giden isteğin kendisidir.
  */
  entityRequestLog.length = 0;
  const accountingNoPerm = await loadNotifications({
    ...baseScope,
    studentKeys: new Set([zeynepKey]),
    studentNames: [ZEYNEP],
  });
  const accountingLeakRequests = entityRequestLog.filter((r) => r.entity === ACCOUNTING_ENTITY);
  check(
    'yetki yokken mali kayıt hiç indirilmiyor ve bildirim üretilmiyor (negatif)',
    accountingLeakRequests.length === 0 && accountingNoPerm.filter(isAccounting).length === 0,
    `giden istek: ${accountingLeakRequests.length}, üretilen kayıt: ${accountingNoPerm.filter(isAccounting).length}`,
  );
  /*
    Yukarıdaki negatif iddianın karşıtı: "istek hiç gitmiyor" sonucu, yetki
    mekanizması tamamen kırıldığında da yeşil kalırdı. Bu yüzden yetki açıkken
    isteğin gerçekten gittiği ayrıca ölçülür.
  */
  entityRequestLog.length = 0;
  await loadNotifications({
    ...baseScope,
    studentKeys: new Set([zeynepKey]),
    studentNames: [ZEYNEP],
    includeAccounting: true,
  });
  check(
    'yetki açıkken istek gerçekten gidiyor (yukarıdaki negatif iddianın karşıtı)',
    entityRequestLog.filter((r) => r.entity === ACCOUNTING_ENTITY).length > 0,
    'yetki açık olmasına rağmen muhasebe isteği gözlenmedi',
  );

  /*
    Mesajlaşma kaynağı yalnızca **bildirim merkezi** sayfasının açtığı bir
    kapsamdır. İddialar bu yüzden iki yönlüdür: kapsam açıkken doğru kayıtlar
    girmeli, kapalıyken uç **hiç çağrılmamalıdır**. İkinci yarı atlanırsa üst
    menüdeki zil ile mesaj rozeti aynı okunmamış mesajı iki kez sayar ve kullanıcı
    iki farklı "okunmamış" sayısı okur — bu hata her iki sayaç da doğru göründüğü
    için ekranda teşhis edilemez.
  */
  if (wired) {
    /* --- 12) Mesaj ve duyurular bildirim merkezine giriyor --- */
    console.log('\n[12] Mesajlaşma — duyuru ve konuşma bildirim kapsamı');
    messagingCalls.length = 0;
    const messagingOn = await loadNotifications({
      ...baseScope,
      studentKeys: new Set([zeynepKey]),
      includeMessaging: true,
    });
    const messagingItems = messagingOn.filter(isMessage);
    const messagingIds = messagingItems.map((i) => i.id).sort();
    check(
      'bildirim merkezinde yalnızca okunmamış konuşma ve okunması zorunlu duyurular listeleniyor',
      JSON.stringify(messagingIds) === JSON.stringify(expectedMessagingIds),
      `dönen: ${JSON.stringify(messagingIds)} (beklenen ${JSON.stringify(expectedMessagingIds)})`,
    );
    check(
      'okunmuş duyuru listeye girmiyor (negatif)',
      !messagingIds.includes(`mesaj:duyuru:${AN_READ}`),
      'okunmuş duyuru listelendi',
    );
    check(
      'okuması zorunlu olmayan duyuru listeye girmiyor (negatif)',
      !messagingIds.includes(`mesaj:duyuru:${AN_OPTIONAL}`),
      'okuma zorunluluğu olmayan duyuru listelendi',
    );
    check(
      '30 günden eski duyuru listeye girmiyor (negatif)',
      !messagingIds.includes(`mesaj:duyuru:${AN_OLD}`),
      'pencere dışı duyuru listelendi',
    );
    check(
      'okunmuş konuşma listeye girmiyor (negatif)',
      !messagingIds.includes(`mesaj:konusma:${T_READ}`),
      'okunmuş konuşma listelendi',
    );
    const urgentItem = messagingItems.find((i) => i.id === `mesaj:duyuru:${AN_URGENT}`);
    check(
      'acil duyurunun aciliyeti tarihten değil kendi önem derecesinden geliyor',
      urgentItem?.urgency === 'acil',
      `aciliyet: ${urgentItem?.urgency ?? 'kayıt yok'}`,
    );
    check(
      'mesaj bildirimleri mesajlar ekranına yönlendiriyor',
      messagingItems.length > 0 && messagingItems.every((i) => i.link === '/mesajlar'),
      `beklenmeyen hedef: ${[...new Set(messagingItems.map((i) => i.link))].join(', ')}`,
    );

    messagingCalls.length = 0;
    const messagingOff = await loadNotifications({
      ...baseScope,
      studentKeys: new Set([zeynepKey]),
    });
    check(
      'kapsam kapalıyken mesajlaşma ucu hiç çağrılmıyor ve mesaj bildirimi üretilmiyor (negatif)',
      messagingOff.filter(isMessage).length === 0 &&
        !messagingCalls.some((c) => c.url.includes('/overview')),
      `çağrı: ${messagingCalls.length}, üretilen kayıt: ${messagingOff.filter(isMessage).length}`,
    );

    /* --- 13) Okundu bilgisinin sunucuya yayılması --- */
    console.log('\n[13] Okundu işareti — duyuru sunucuya gidiyor, konuşma gitmiyor');
    const readCalls = () => messagingCalls.filter((c) => c.url.includes('/announcement-read'));

    check(
      'bildirim kimliğinden duyuru numarası doğru çözülüyor ve konuşma ayıklanıyor',
      JSON.stringify(announcementIdsToSync([
        `mesaj:duyuru:${AN_URGENT}`,
        `mesaj:konusma:${T_OWN}`,
        `mesaj:duyuru:${AN_URGENT}`,
        'mesaj:duyuru:abc',
      ])) === JSON.stringify([AN_URGENT]) &&
        announcementIdOf(`mesaj:konusma:${T_OWN}`) === null,
      `çözülen: ${JSON.stringify(announcementIdsToSync([`mesaj:duyuru:${AN_URGENT}`, 'mesaj:duyuru:abc']))}`,
    );

    messagingCalls.length = 0;
    const synced = syncAnnouncementRead([`mesaj:duyuru:${AN_URGENT}`, `mesaj:konusma:${T_OWN}`]);
    check(
      'okundu işaretinde yalnızca duyuru kimlikleri yayılıyor',
      JSON.stringify(synced) === JSON.stringify([AN_URGENT]),
      `yayılan: ${JSON.stringify(synced)}`,
    );
    check(
      'duyuru okundu bilgisi sunucuya yazılıyor (okundu sunucuda tutulduğu için sayaç ancak böyle düşer)',
      readCalls().length === 1 && Number(readCalls()[0].data.announcement_id) === AN_URGENT,
      `giden çağrı: ${JSON.stringify(readCalls().map((c) => c.data))}`,
    );
    check(
      'konuşma okundu sayılmıyor: mesajı görmeden okunmamış sayacı sıfırlanmıyor (negatif)',
      !messagingCalls.some((c) => c.url.includes('/thread-read')),
      'konuşma okundu isteği gönderildi',
    );
  } else {
    console.log('\n  ATLA mesajlaşma iddiaları (köprü taklidi kurulamadı)');
  }

  /* ------------------------------------------------------------------ */
  console.log(`\nSONUÇ: ${passed} OK, ${failures.length} FAIL`);
  if (failures.length) {
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  }
}

void main();