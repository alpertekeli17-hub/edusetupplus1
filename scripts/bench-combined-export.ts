/**
 * Birleşik sınıflı dersin ÖĞRETMEN GÖRÜNÜMÜ ve PDF ÇIKTISINDA eksiksiz
 * görünmesinin kanıtı.
 *
 * Neden bu betik gerekli
 * ----------------------
 * Kullanıcı "ders birleştirmesi yapıldığında öğretmen görünümü boş kalıyor ve
 * öğretmen PDF'inde birleşen iki sınıf eksik görünüyor" bildirdi. İki ayrı
 * sessiz kayıp söz konusuydu ve ikisi de ekranda "hücre boş / hücrede tek
 * sınıf var" biçiminde göründüğü için gözle ayırt edilemez:
 *
 *   1. PDF hücresi `filteredEntries.find(...)` ile TEK kayıttan kuruluyordu.
 *      Ders bazlı birleştirmede A ve B sınıfı aynı gün/saat/ders için İKİ ayrı
 *      `ScheduleEntry` olarak saklandığından `find` yalnızca ilk şubeyi
 *      yazdırıyor, ikinci sınıf çıktıdan tamamen düşüyordu.
 *   2. Gün sütunları ve ders saati satırları yalnızca ayarlardan türetiliyordu.
 *      `activeDays` dışına yazılmış gün (ör. Cumartesi) veya tanımlı saat
 *      aralığının dışına taşan ek ders (8. saat) yazdırılmadan kayboluyordu.
 *
 * Bu yüzden mantık bileşenden çıkarılıp saf fonksiyonlara alındı
 * (`src/scheduler/lib/pdfScheduleCells.ts`) ve burada AYNI fonksiyonlar gerçek
 * kayıtlarla çağrılıyor. Uygulamanın kopyası yazılsaydı betik uygulamayı değil
 * kendini doğrulardı.
 *
 * Negatif iddialar neden zorunlu
 * ------------------------------
 * "Hücrede A+B görünüyor" tek başına yeterli değil: aşırı birleştirme hatası
 * (Fen dersinde de B'yi göstermek) ya da ikinci dersin (Etüt) yutulması bu
 * iddiayı yeşil bırakırdı. Bu yüzden her olumlu iddianın karşıtı da ölçülür.
 *
 * Çalıştırma:
 *   BENCH_ENTRY=scripts/bench-combined-export.ts pnpm exec vite build --config vite.bench.config.ts
 *   node .bench/bench.mjs
 */
/*
  DİKKAT: shim importu EN ÜSTTE olmalıdır. Uygulama modülleri `window`/`localStorage`
  bekler; ESM içe aktarmaları sırayla değerlendirildiği için shim ilk sırada olmazsa
  Node "window is not defined" ile düşer.
*/
import './node-shim';

import {
  buildCombinedCell,
  mergeExportDays,
  maxPeriodOfEntries,
  teacherExportPeriods,
} from '@/scheduler/lib/pdfScheduleCells';
import { DEFAULT_SETTINGS } from '@/scheduler/lib/types';
import type {
  Classroom,
  Lesson,
  ScheduleEntry,
  SchoolClass,
  Settings,
  Teacher,
} from '@/scheduler/lib/types';

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

/** Bir metnin içinde kaç kez geçtiğini sayar. */
function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/* ------------------------------------------------------------------ */
/* Sahne kurulumu                                                      */
/* ------------------------------------------------------------------ */

const MAT = 'mat';
const FEN = 'fen';
const ETUT = 'etut';

const lessons: Lesson[] = [
  { id: MAT, name: 'Matematik', color: '#ff0000' },
  { id: FEN, name: 'Fen Bilimleri', color: '#00ff00' },
  { id: ETUT, name: 'Etüt', color: '#0000ff' },
];

const classrooms: Classroom[] = [{ id: 'r201', name: '201' }];

/*
  A ve B YALNIZCA Matematik dersinde birleşik. İlişki bilinçli olarak tek
  tarafta (A) tanımlanıyor; simetri uygulamanın grup çözücüsünden gelir.
  C hiçbir birleşimi olmayan kontrol sınıfıdır.
*/
function makeClass(id: string, name: string): SchoolClass {
  return {
    id,
    name,
    classroomId: 'r201',
    weeklyHours: { [MAT]: 2, [FEN]: 2 },
    activeDays: [0, 1, 2, 3, 4],
    periodsForDay: {},
  };
}

const classA = makeClass('a', '8-A');
const classB = makeClass('b', '8-B');
const classC = makeClass('c', '8-C');
classA.combinedWithByLesson = { [MAT]: ['b'] };

const classes = [classA, classB, classC];

const teachers: Teacher[] = [
  { id: 't1', name: 'Test Öğretmen', assignedLessons: [MAT, FEN], assignedClasses: [], offDays: [] },
];

/**
 * Gerçek verideki durumu birebir kurar: birleşik dersin partner şubesi AYRI bir
 * kayıttır ve aynı hücrede ikinci bir ek ders (Etüt) bulunur.
 */
function makeEntry(
  id: string,
  classId: string,
  dayIndex: number,
  periodIndex: number,
  lessonId: string,
  extra = false,
): ScheduleEntry {
  return {
    id,
    classId,
    dayIndex,
    periodIndex,
    lessonId,
    teacherId: 't1',
    isExtra: extra,
  };
}

const entries: ScheduleEntry[] = [
  // Birleşik Matematik: iki ayrı kayıt (A ve B partner şubesi).
  makeEntry('e1', 'a', 0, 0, MAT),
  makeEntry('e2', 'b', 0, 0, MAT),
  // Aynı hücrede ikinci ders: ek ders (Etüt). Tek kayıt tutan hücre bunu atardı.
  makeEntry('e3', 'a', 0, 0, ETUT, true),
  // Fen dersinde birleşim YOK: yalnızca A.
  makeEntry('e4', 'a', 0, 1, FEN),
  // activeDays dışındaki gün (Cumartesi = 5).
  makeEntry('e5', 'a', 5, 0, MAT, true),
  // Ayarın dışına taşan ders saati (8. ders = index 7).
  makeEntry('e6', 'a', 0, 7, ETUT, true),
];

const teacherEntries = entries.filter((entry) => entry.teacherId === 't1');

const resolvers = {
  getLessonById: (id: string) => lessons.find((lesson) => lesson.id === id),
  getClassById: (id: string) => classes.find((cls) => cls.id === id),
  getClassroomById: (id: string | undefined) =>
    id ? classrooms.find((room) => room.id === id) : undefined,
};

/** Bir hücreyi PDF'te olduğu gibi kurar. */
function cellAt(dayIndex: number, periodIndex: number, timeLabel = '08:30-09:10') {
  const cellEntries = teacherEntries.filter(
    (entry) => entry.dayIndex === dayIndex && entry.periodIndex === periodIndex,
  );
  return buildCombinedCell(cellEntries, timeLabel, resolvers);
}

/* ------------------------------------------------------------------ */
/* 1) Öğretmen hücresi: birleşen iki sınıf birlikte görünüyor          */
/* ------------------------------------------------------------------ */

console.log('\n1) Öğretmen görünümü / PDF hücresi (Matematik, birleşik ders)');

const matCell = cellAt(0, 0);

check(
  'birleşik ders hücresi boş değil',
  matCell.content.trim().length > 0,
  `içerik boş geldi: ${JSON.stringify(matCell.content)}`
);

check(
  'birleşen iki sınıf aynı hücrede birlikte yazılıyor (8-A+8-B)',
  matCell.content.includes('8-A+8-B'),
  `beklenen "8-A+8-B", gelen ${JSON.stringify(matCell.content)}`
);

check(
  'her iki sınıf adı hücrede ayrı ayrı da doğrulanabiliyor',
  countOf(matCell.content, '8-A') >= 1 && countOf(matCell.content, '8-B') >= 1,
  `8-A sayısı ${countOf(matCell.content, '8-A')}, 8-B sayısı ${countOf(matCell.content, '8-B')}`
);

check(
  'hücrede ders adı ve saat etiketi korunuyor',
  matCell.content.includes('Matematik') && matCell.content.includes('08:30-09:10'),
  `gelen ${JSON.stringify(matCell.content)}`
);

check(
  'hücre rengi için ilk ders çözülebiliyor',
  matCell.lesson?.id === MAT,
  `beklenen ${MAT}, gelen ${matCell.lesson?.id ?? 'undefined'}`
);

/* ------------------------------------------------------------------ */
/* 2) Aynı hücredeki ikinci ders kaybolmuyor                           */
/* ------------------------------------------------------------------ */

console.log('\n2) Aynı hücredeki ikinci kayıt (ek ders / etüt)');

check(
  'aynı hücredeki ikinci ders (Etüt) hücreye yazılıyor',
  matCell.content.includes('Etüt'),
  `beklenen "Etüt", gelen ${JSON.stringify(matCell.content)}`
);

check(
  'ek ders işareti (⭐) hücrede korunuyor',
  matCell.content.includes('⭐'),
  `gelen ${JSON.stringify(matCell.content)}`
);

check(
  'hücredeki tüm kayıtlar işleniyor (A + B + Etüt = 3 kayıt)',
  countOf(matCell.content, '\n') >= 3,
  `satır sayısı ${countOf(matCell.content, '\n')}, içerik ${JSON.stringify(matCell.content)}`
);

/* ------------------------------------------------------------------ */
/* 3) Olmayan birleşimin uydurulmaması (negatif iddia)                 */
/* ------------------------------------------------------------------ */

console.log('\n3) Birleşimin YALNIZCA seçilen derste geçerli olması (negatif)');

const fenCell = cellAt(0, 1);

check(
  'Fen dersinde birleşme olmadığı için partner sınıf (8-B) görünmüyor',
  fenCell.content.includes('8-A') && !fenCell.content.includes('8-B'),
  `gelen ${JSON.stringify(fenCell.content)}`
);

check(
  'Fen dersinde tek blok yazılıyor',
  !fenCell.content.includes('8-A+8-B'),
  `gelen ${JSON.stringify(fenCell.content)}`
);

/* ------------------------------------------------------------------ */
/* 4) Boş hücre çökmüyor                                               */
/* ------------------------------------------------------------------ */

console.log('\n4) Boş hücre davranışı');

const emptyCell = cellAt(0, 3);
check(
  'kayıt olmayan hücrede içerik boş dönüyor (çökme yok)',
  emptyCell.content === '' && emptyCell.lesson === undefined,
  `içerik ${JSON.stringify(emptyCell.content)}, ders ${emptyCell.lesson?.id ?? 'undefined'}`
);

/* ------------------------------------------------------------------ */
/* 5) Derslik adı blok içinde tekilleşiyor                             */
/* ------------------------------------------------------------------ */

console.log('\n5) Derslik adı tekrarı');

/*
  Tekillik iddiası blok düzeyinde kurulmalı: hücrede iki farklı ders varsa her
  ders kendi bloğunu yazdığı için derslik adı doğal olarak iki kez geçer. Bu
  yüzden yalnızca birleşen iki şubeden oluşan tek bloklu bir hücre ayrıca
  kurulup derslik adının orada TEK kez yazıldığı ölçülür.
*/
const multiRoomProbe = buildCombinedCell(
  [makeEntry('p1', 'a', 0, 0, MAT), makeEntry('p2', 'b', 0, 0, MAT)],
  '',
  resolvers,
).content;

check(
  'birleşen iki sınıf aynı derslikte olsa da ad blok içinde bir kez yazılıyor',
  countOf(cellAt(0, 0, '').content, '🚪 201') === 2 &&
    countOf(multiRoomProbe, '🚪 201') === 1,
  `tüm hücrede "${'🚪 201'}" sayısı ${countOf(cellAt(0, 0, '').content, '🚪 201')}, tek bloklu hücrede ${countOf(multiRoomProbe, '🚪 201')}`
);

/* ------------------------------------------------------------------ */
/* 6) Yazdırılacak günler: activeDays dışındaki gün kaybolmuyor        */
/* ------------------------------------------------------------------ */

console.log('\n6) Yazdırılacak günler (activeDays ∪ kayıt günleri)');

const baseDays = [0, 1, 2, 3, 4];
const mergedDays = mergeExportDays(baseDays, teacherEntries);

check(
  'aktif günler korunuyor',
  baseDays.every((day) => mergedDays.includes(day)),
  `gelen ${JSON.stringify(mergedDays)}`
);

check(
  'Cumartesi (activeDays dışı ama kayıt var) yazdırılacak günlere ekleniyor',
  mergedDays.includes(5),
  `gelen ${JSON.stringify(mergedDays)}`
);

check(
  'kaydı olmayan Pazar günü listeye eklenmiyor',
  !mergedDays.includes(6),
  `gelen ${JSON.stringify(mergedDays)}`
);

check(
  'gün listesi sıralı ve tekrarsız',
  JSON.stringify(mergedDays) === JSON.stringify([...new Set(mergedDays)].sort((a, b) => a - b)),
  `gelen ${JSON.stringify(mergedDays)}`
);

check(
  'kayıt yokken gün listesi bozulmuyor (negatif)',
  JSON.stringify(mergeExportDays([0, 1], [])) === JSON.stringify([0, 1]),
  `gelen ${JSON.stringify(mergeExportDays([0, 1], []))}`
);

check(
  'aralık dışı gün indeksi (9) listeye alınmıyor',
  !mergeExportDays([0], [makeEntry('x', 'a', 9, 0, MAT)]).includes(9),
  `gelen ${JSON.stringify(mergeExportDays([0], [makeEntry('x', 'a', 9, 0, MAT)]))}`
);

/* ------------------------------------------------------------------ */
/* 7) Yazdırılacak ders saatleri: ayar dışı ek ders kaybolmuyor        */
/* ------------------------------------------------------------------ */

console.log('\n7) Yazdırılacak ders saatleri (ayar ∪ ek ders)');

const basePeriods = teacherExportPeriods(teacherEntries, DEFAULT_SETTINGS, true);
check(
  'taban saat listesi ayardaki ders sayısını kapsıyor (8 ders)',
  basePeriods.length === DEFAULT_SETTINGS.periodsPerDay,
  `beklenen ${DEFAULT_SETTINGS.periodsPerDay}, gelen ${basePeriods.length}`
);

/*
  Ayar 5 derslik bir okul, ek ders ise 8. saatte (index 7). Ek ders kapalıyken
  8. saat listeye GİRMEMELİ; açıkken girmelidir. İki iddia birlikte ölçülür,
  çünkü tek iddia "her zaman genişletiyor" ya da "hiç genişletmiyor" hatasını
  gizler.
*/
const sparseSettings: Settings = { ...DEFAULT_SETTINGS, periodsPerDay: 5 };

check(
  'ek ders açıkken ayarın ötesindeki ek ders saati (8. ders) listeye giriyor',
  teacherExportPeriods(teacherEntries, sparseSettings, true).includes(7),
  `gelen ${JSON.stringify(teacherExportPeriods(teacherEntries, sparseSettings, true))}`
);

check(
  'ek ders kapalıyken ayarın ötesindeki saat listeye girmiyor (negatif)',
  !teacherExportPeriods(teacherEntries, sparseSettings, false).includes(7),
  `gelen ${JSON.stringify(teacherExportPeriods(teacherEntries, sparseSettings, false))}`
);

check(
  'ek ders kapalıyken taban satır sayısı ayarda kalıyor (5 ders)',
  teacherExportPeriods(teacherEntries, sparseSettings, false).length ===
    sparseSettings.periodsPerDay,
  `beklenen ${sparseSettings.periodsPerDay}, gelen ${teacherExportPeriods(teacherEntries, sparseSettings, false).length}`
);

check(
  'kayıtların en büyük ders saati doğru okunuyor',
  maxPeriodOfEntries(teacherEntries) === 7,
  `beklenen 7, gelen ${maxPeriodOfEntries(teacherEntries)}`
);

check(
  'kayıt yokken en büyük ders saati -1 dönüyor (uydurma satır yok)',
  maxPeriodOfEntries([]) === -1,
  `gelen ${maxPeriodOfEntries([])}`
);

/* ------------------------------------------------------------------ */
/* 8) Öğretmen kapsamı: başka öğretmenin dersi sızmıyor                */
/* ------------------------------------------------------------------ */

console.log('\n8) Öğretmen kapsamı (negatif)');

const otherTeacherCell = buildCombinedCell(
  entries.filter((entry) => entry.teacherId === 't2'),
  '08:30-09:10',
  resolvers,
);

check(
  'başka öğretmenin hücresi kendi kayıtlarını göstermiyor',
  otherTeacherCell.content === '' && otherTeacherCell.lesson === undefined,
  `gelen ${JSON.stringify(otherTeacherCell.content)}`
);

/* ------------------------------------------------------------------ */
/* Özet                                                                */
/* ------------------------------------------------------------------ */

const total = passed + failures.length;
console.log(`\n=== BİRLEŞİK SINIF PDF / ÖĞRETMEN GÖRÜNÜMÜ: ${passed}/${total} OK ===`);
if (failures.length > 0) {
  console.log('Başarısız iddialar:');
  for (const failure of failures) console.log(` - ${failure}`);
  process.exit(1);
}
