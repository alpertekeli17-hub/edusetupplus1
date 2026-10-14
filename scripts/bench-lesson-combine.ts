/**
 * Ders bazlı sınıf birleştirmesinin kanıtı.
 *
 * Neden bu betik gerekli
 * ----------------------
 * Yeni sürümde sınıflar artık YALNIZCA seçilen derslerde birleşebiliyor
 * (`SchoolClass.combinedWithByLesson`). Bu davranışın iki yönlü kanıtı
 * gerekir: (a) seçilen derste grup gerçekten oluşmalı, (b) seçilmeyen
 * derslerde sınıflar bağımsız kalmalı. Yalnızca (a) ölçülürse "her derste
 * birleşiyor" hatası görünmez kalır; yalnızca (b) ölçülürse özellik hiç
 * çalışmıyor olsa da test yeşil kalır.
 *
 * Bu yüzden betik uygulamanın GERÇEK fonksiyonlarını çağırır:
 *   - `getCombinedClassIds` / `getCombinedPartnerIds` (lib/store.ts)
 *   - `saveClasses` / `loadClasses` (kalıcılık turu)
 *   - `ScheduleEngine.getCombinedGroup` + `place` (motorun yerleştirme yolu)
 *
 * Sahte bir kopya yazılsaydı ölçüm uygulamayı değil betiği doğrulardı.
 *
 * Çalıştırma:
 *   BENCH_ENTRY=scripts/bench-lesson-combine.ts pnpm exec vite build --config vite.bench.config.ts
 *   node .bench/bench.mjs
 */
/*
  DİKKAT: shim importu EN ÜSTTE olmalıdır. Uygulama modülleri `window`/`localStorage`
  bekler; ESM içe aktarmaları sırayla değerlendirildiği için shim ilk sırada olmazsa
  Node "window is not defined" ile düşer.
*/
import './node-shim';

import {
  getCombinedClassIds,
  getCombinedPartnerIds,
  loadClasses,
  saveClasses,
} from '@/scheduler/lib/store';
/*
  `Requirement` tipi `lib/types.ts` içinde DEĞİL, motorun kendi dosyasında
  tanımlıdır; yanlış yerden içe aktarılırsa derleme düşer.
*/
import { ScheduleEngine } from '@/scheduler/components/schedule-engine';
import type { Requirement } from '@/scheduler/components/schedule-engine';
import { DEFAULT_SETTINGS } from '@/scheduler/lib/types';
import type { Lesson, SchoolClass, Teacher } from '@/scheduler/lib/types';

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

/** Diziyi deterministik ve okunur biçimde yazar. */
function show(ids: string[]): string {
  return `[${[...ids].sort().join(', ')}]`;
}

function sameIds(actual: string[], expected: string[]): boolean {
  const a = [...actual].sort().join('|');
  const b = [...expected].sort().join('|');
  return a === b;
}

/* ------------------------------------------------------------------ */
/* Sahne kurulumu                                                      */
/* ------------------------------------------------------------------ */

const MAT = 'mat';
const FEN = 'fen';

function makeClass(id: string, name: string): SchoolClass {
  return {
    id,
    name,
    weeklyHours: { [MAT]: 2, [FEN]: 2 },
    activeDays: [0, 1, 2, 3, 4],
    periodsForDay: {},
  };
}

/*
  Sınıf rolleri bilinçli olarak ayrıldı ki iddialar birbirini kirletmesin:

  A/B  : ders bazlı çift — YALNIZCA A tarafında tanım var (tek taraflı).
  C    : sınıf geneli birleşim (eski davranış, D ile her derste).
  D    : C'nin partneri (kendisi hiçbir şey tanımlamıyor).
  E    : hiçbir birleşimi olmayan kontrol sınıfı.
*/
const classA = makeClass('a', '8-A');
const classB = makeClass('b', '8-B');
const classC = makeClass('c', '8-C');
const classD = makeClass('d', '8-D');
const classE = makeClass('e', '8-E');

// Ders bazlı birleşim YALNIZCA A tarafında tanımlanıyor (simetri testi için).
classA.combinedWithByLesson = { [MAT]: ['b'] };
// Sınıf geneli birleşim eski alanla kuruluyor (geriye dönük uyum testi için).
classC.combinedWith = ['d'];

const classes: SchoolClass[] = [classA, classB, classC, classD, classE];

const lessons: Lesson[] = [
  { id: MAT, name: 'Matematik', color: '#111111' },
  { id: FEN, name: 'Fen Bilimleri', color: '#222222' },
];

const teachers: Teacher[] = [
  {
    id: 't1',
    name: 'Test Öğretmen',
    assignedLessons: [MAT, FEN],
    assignedClasses: [],
    offDays: [],
  },
];

/* ------------------------------------------------------------------ */
/* 1) Grup çözümlemesi                                                 */
/* ------------------------------------------------------------------ */

console.log('\n1) Grup çözümlemesi (getCombinedClassIds)');

const aMat = getCombinedClassIds(classes, 'a', MAT);
check(
  'seçilen derste grup oluşuyor (A + B)',
  sameIds(aMat, ['a', 'b']),
  `beklenen [a, b], gelen ${show(aMat)}`
);

const bMat = getCombinedClassIds(classes, 'b', MAT);
check(
  'tek taraflı tanım simetrik çözülüyor (B de A ile birleşik)',
  sameIds(bMat, ['a', 'b']),
  `beklenen [a, b], gelen ${show(bMat)}`
);

const partnerA = getCombinedPartnerIds(classes, 'a', MAT);
check(
  'partner listesi kendini içermiyor',
  sameIds(partnerA, ['b']),
  `beklenen [b], gelen ${show(partnerA)}`
);

const aFen = getCombinedClassIds(classes, 'a', FEN);
check(
  'seçilmeyen derste sınıflar bağımsız kalıyor (A tek başına)',
  sameIds(aFen, ['a']),
  `beklenen [a], gelen ${show(aFen)}`
);

const bFen = getCombinedClassIds(classes, 'b', FEN);
check(
  'seçilmeyen derste partner de bağımsız kalıyor (B tek başına)',
  sameIds(bFen, ['b']),
  `beklenen [b], gelen ${show(bFen)}`
);

const eMat = getCombinedClassIds(classes, 'e', MAT);
const eFen = getCombinedClassIds(classes, 'e', FEN);
check(
  'birleşimi olmayan sınıf hiçbir derste birleşmiyor',
  sameIds(eMat, ['e']) && sameIds(eFen, ['e']),
  `mat ${show(eMat)}, fen ${show(eFen)}`
);

const cFen = getCombinedClassIds(classes, 'c', FEN);
check(
  'sınıf geneli birleşim tüm derslerde geçerli (C + D, fen)',
  sameIds(cFen, ['c', 'd']),
  `beklenen [c, d], gelen ${show(cFen)}`
);

/*
  Kritik ayrım: ders bazlı birleşim ders belirtilmeyen sorguya SIZMAMALIDIR.
  Sızarsa, dersi bilinmeyen tüm çağrılar (örneğin derslik/çakışma taramaları)
  sınıfları hatalı biçimde birleşik sayar.
*/
const aLess = getCombinedClassIds(classes, 'a');
const cLess = getCombinedClassIds(classes, 'c');
check(
  'ders belirtilmeyen sorguya ders bazlı birleşim sızmıyor',
  sameIds(aLess, ['a']) && sameIds(cLess, ['c', 'd']),
  `A ${show(aLess)}, C ${show(cLess)}`
);

/* ------------------------------------------------------------------ */
/* 2) Kalıcılık turu                                                   */
/* ------------------------------------------------------------------ */

console.log('\n2) Kaydetme / okuma turu (saveClasses → loadClasses)');

saveClasses([classA, classB, classC, classD, classE]);
const reloaded = loadClasses();
const reloadedA = reloaded.find((c) => c.id === 'a');
check(
  'ders bazlı birleşim kaydedilip geri okunuyor',
  reloadedA?.combinedWithByLesson?.[MAT]?.join('|') === 'b',
  `gelen ${JSON.stringify(reloadedA?.combinedWithByLesson ?? null)}`
);
check(
  'sınıf geneli birleşim alanı korunuyor',
  reloaded.find((c) => c.id === 'c')?.combinedWith?.join('|') === 'd',
  `gelen ${JSON.stringify(reloaded.find((c) => c.id === 'c')?.combinedWith ?? null)}`
);
check(
  'birleşimi olmayan sınıfta alan boş kalıyor',
  reloaded.find((c) => c.id === 'e')?.combinedWithByLesson === undefined,
  'E sınıfında beklenmeyen birleşim alanı var'
);

// Kalan iddialar okunan (gerçek) kayıtlarla sürsün.
const liveClasses = reloaded;

/* ------------------------------------------------------------------ */
/* 3) Motorun yerleştirme yolu                                         */
/* ------------------------------------------------------------------ */

console.log('\n3) Motor yerleştirmesi (ScheduleEngine.place)');

const requirements: Requirement[] = liveClasses.flatMap((cls) =>
  [
    { id: MAT, name: 'Matematik' },
    { id: FEN, name: 'Fen Bilimleri' },
  ].map((l) => ({
    classId: cls.id,
    className: cls.name,
    lessonId: l.id,
    lessonName: l.name,
    total: 2,
  }))
);

const engine = new ScheduleEngine(
  teachers,
  liveClasses,
  lessons,
  DEFAULT_SETTINGS,
  requirements
);

/** Belirli gün/periyot/ders için yerleştirilmiş sınıf id'leri. */
function classesAt(day: number, period: number, lessonId: string): string[] {
  return engine.placements
    .filter(
      (p) =>
        p.dayIndex === day && p.periodIndex === period && p.lessonId === lessonId
    )
    .map((p) => p.classId);
}

engine.place('a', 0, 0, MAT, 't1');
const matPlacement = classesAt(0, 0, MAT);
check(
  'seçilen derste partner sınıf da yerleşiyor (ortak ders)',
  sameIds(matPlacement, ['a', 'b']),
  `beklenen [a, b], gelen ${show(matPlacement)}`
);

engine.place('a', 0, 1, FEN, 't1');
const fenPlacement = classesAt(0, 1, FEN);
check(
  'seçilmeyen derste partner sınıf yerleşmiyor (ayrı ders)',
  sameIds(fenPlacement, ['a']),
  `beklenen [a], gelen ${show(fenPlacement)}`
);

engine.place('c', 0, 2, FEN, 't1');
const cFenPlacement = classesAt(0, 2, FEN);
check(
  'sınıf geneli birleşim motorda da her derste geçerli',
  sameIds(cFenPlacement, ['c', 'd']),
  `beklenen [c, d], gelen ${show(cFenPlacement)}`
);

/*
  Motor grup sonucunu önbelleğe alır. Anahtar dersi içermezse ilk sorgunun
  sonucu diğer derslere yanlışlıkla uygulanır; bu yüzden iki ders art arda
  sorulup sonuçların AYRIŞTIĞI ölçülür.
*/
const cacheMat = engine.getCombinedGroup('a', MAT);
const cacheFen = engine.getCombinedGroup('a', FEN);
check(
  'grup önbelleği derslere göre ayrışıyor (sızma yok)',
  sameIds(cacheMat, ['a', 'b']) && sameIds(cacheFen, ['a']),
  `mat ${show(cacheMat)}, fen ${show(cacheFen)}`
);

/* ------------------------------------------------------------------ */
/* Özet                                                                */
/* ------------------------------------------------------------------ */

const total = passed + failures.length;
console.log(`\n=== DERS BAZLI BİRLEŞİM: ${passed}/${total} OK ===`);
if (failures.length > 0) {
  console.log('Başarısız iddialar:');
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
