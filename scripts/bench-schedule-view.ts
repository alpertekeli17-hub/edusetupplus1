/**
 * Salt okunur haftalık ders programı görünümünün kanıtı.
 *
 * Neden bu betik gerekli
 * ----------------------
 * Kullanıcı gerçek veride iki belirti bildirdi:
 *   (a) "Aynı gün ve saatte ikinci ek ders ekledim, tabloda görünmüyor."
 *   (b) "Programda ders olan gün ekranda yok / ders ekledim ama görünmüyor."
 * Her ikisi de ekranda "boş hücre" olarak göründüğü için gözle ayırt edilemez;
 * bu yüzden iddialar gerçek uygulama fonksiyonlarıyla ölçülür:
 *   - `buildWeekGrid` / `resolveTeacherMatch` / `periodsOfDayFor` (lib/scheduleView.ts)
 *   - `saveClasses` / `loadClasses` / `saveEntries` / `loadEntries` (gerçek depo turu)
 *   - `getCombinedClassIds` (ders bazlı birleşim çözümü)
 *
 * Şüpheli ayrım: yalnızca "çalışıyor" iddiası ölçülse, hücrenin ikinci kaydı
 * sessizce atması fark edilmezdi; bu yüzden her senaryonun **negatif** karşılığı da
 * ölçülür (partner sınıfın başka dersteki kaydı görünmemeli, kaydı olmayan gün
 * tabloda boşuna çıkmamalı, eşleşmeyen öğretmene program gösterilmemeli).
 *
 * Çalıştırma:
 *   BENCH_ENTRY=scripts/bench-schedule-view.ts pnpm exec vite build --config vite.bench.config.ts
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
  loadClasses,
  loadEntries,
  saveClasses,
  saveEntries,
} from '@/scheduler/lib/store';
import {
  buildWeekGrid,
  isTeacherLedView,
  matchesStudentName,
  periodsOfDayFor,
  resolveScheduleAccess,
  resolveTeacherMatch,
} from '@/lib/scheduleView';
import { ROLE_PERMISSIONS, resolvePermissions } from '@/lib/site';
import { DEFAULT_SETTINGS } from '@/scheduler/lib/types';
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
/* Sahne kurulumu                                                      */
/* ------------------------------------------------------------------ */

const MAT = 'mat';
const FEN = 'fen';

/** Öğretmen modunda aranan hesap; e-posta tanımlı (birincil bağ). */
const TEACHER_OK = 't-ayse';
/** Aynı öğretmenin kaydı ad üzerinden bulunacak eşleşme denemesi için. */
const TEACHER_OK_NAME = 'Ayşe Yılmaz';

const lessons: Lesson[] = [
  { id: MAT, name: 'Matematik', color: '#111111' },
  { id: FEN, name: 'Fen Bilimleri', color: '#222222' },
];

const teachers: Teacher[] = [
  {
    id: TEACHER_OK,
    name: TEACHER_OK_NAME,
    email: 'ayse@okul.com',
    assignedLessons: [MAT, FEN],
    assignedClasses: [],
    offDays: [],
  },
  {
    id: 't-mehmet',
    name: 'Mehmet Demir',
    email: 'mehmet@okul.com',
    assignedLessons: [MAT],
    assignedClasses: [],
    offDays: [],
  },
];

/** 8-A: hafta içi 5 gün, ilk üç günde 5 ders saati. Cumartesi (5) KAPALI. */
const classA: SchoolClass = {
  id: 'a',
  name: '8-A',
  weeklyHours: { [MAT]: 2, [FEN]: 2 },
  activeDays: [0, 1, 2, 3, 4],
  periodsForDay: { 0: [0, 1, 2, 3, 4], 1: [0, 1, 2, 3, 4], 2: [0, 1, 2, 3, 4] },
};

/** 8-B: yalnızca Matematik dersinde 8-A ile birleşik okunuyor (ders bazlı). */
const classB: SchoolClass = {
  id: 'b',
  name: '8-B',
  weeklyHours: { [MAT]: 2, [FEN]: 2 },
  activeDays: [0, 1, 2, 3, 4],
  periodsForDay: { 0: [0, 1, 2, 3, 4] },
  combinedWithByLesson: { [MAT]: ['a'] },
};

const classes: SchoolClass[] = [classA, classB];

/** Kayıt üretici: kimlikler deterministik olsun diye türetilir. */
function entry(
  id: string,
  classId: string,
  dayIndex: number,
  periodIndex: number,
  lessonId: string,
  teacherId: string,
  extra?: Partial<ScheduleEntry>,
): ScheduleEntry {
  return {
    id,
    classId,
    dayIndex,
    periodIndex,
    lessonId,
    teacherId,
    isExtra: Boolean(extra?.isExtra),
    ...extra,
  };
}

const allEntries: ScheduleEntry[] = [
  // 1) Öğretmenin normal ders saati.
  entry('e1', 'a', 0, 0, MAT, TEACHER_OK),
  // 2) AYNI gün ve saatte ikinci ek ders (eski sürümde sessizce düşüyordu).
  entry('e2', 'a', 0, 0, MAT, TEACHER_OK, {
    isExtra: true,
    extraType: 'question',
    studentName: 'Zeynep K.',
  }),
  // 3) Cumartesi (gün 5): sınıfın activeDays listesinde YOK.
  entry('e3', 'a', 5, 0, FEN, TEACHER_OK, { isExtra: true, extraType: 'study' }),
  // 4) Ayar dışı ders saati (gün 1, index 7): periodsForDay yalnızca 0-4 tanımlı.
  entry('e4', 'a', 1, 7, MAT, TEACHER_OK, { isExtra: true, extraType: 'question' }),
  // 5) Partner sınıfın AYNI dersteki kaydı (Matematik → birleşik, görünmeli).
  entry('e5', 'b', 1, 0, MAT, 't-mehmet'),
  // 6) Partner sınıfın BAŞKA dersteki kaydı (Fen → bağımsız, görünmemeli).
  entry('e6', 'b', 2, 0, FEN, 't-mehmet'),
  /*
    7-8) GERÇEK BİRLEŞİK DERS DEPOLAMASI: A ve B şubeleri aynı gün/saat/ders
    için İKİ AYRI kayıt olarak saklanır. Kullanıcının bildirdiği "öğretmen
    görünümü boş kalıyor" belirtisi tam olarak bu hücrede görülür, çünkü
    hücre tek kayıt tuttuğunda ikinci şube sessizce düşer.
  */
  entry('e7', 'a', 3, 0, MAT, TEACHER_OK),
  entry('e8', 'b', 3, 0, MAT, TEACHER_OK),
  // 9) Aynı öğretmenin birleşik OLMAYAN ders kaydı (negatif kontrol tabanı).
  entry('e9', 'b', 4, 0, FEN, TEACHER_OK),
];

/* ------------------------------------------------------------------ */
/* 1) Öğretmen eşleşmesi                                              */
/* ------------------------------------------------------------------ */

console.log('\n1) Öğretmen eşleşmesi (resolveTeacherMatch)');

const byMail = resolveTeacherMatch(teachers, 'Ayse@Okul.com', 'Yanlış Ad');
check(
  'e-posta eşleşmesi büyük/küçük harf duyarsız çalışıyor',
  byMail.length === 1 && byMail[0].id === TEACHER_OK,
  `gelen ${byMail.map((t) => t.id).join(',') || 'boş'}`,
);

const byName = resolveTeacherMatch(teachers, 'bilinmeyen@okul.com', 'ayşe yılmaz');
check(
  'e-posta tutmazsa ad eşleşmesine düşülüyor (Türkçe karakter duyarsız)',
  byName.length === 1 && byName[0].id === TEACHER_OK,
  `gelen ${byName.map((t) => t.id).join(',') || 'boş'}`,
);

const unmatched = resolveTeacherMatch(teachers, 'kimse@okul.com', 'Kimse Yok');
check(
  'eşleşmeyen hesaba program gösterilmiyor (tahmin yok)',
  unmatched.length === 0,
  `gelen ${unmatched.map((t) => t.id).join(',') || 'boş'}`,
);

/* ------------------------------------------------------------------ */
/* 2) Kalıcılık turu                                                   */
/* ------------------------------------------------------------------ */

console.log('\n2) Kaydetme / okuma turu (save → load)');

saveClasses(classes);
saveEntries(allEntries);
const liveClasses = loadClasses();
const liveEntries = loadEntries();
check(
  'sınıflar gerçek depodan geri okunuyor',
  liveClasses.length === classes.length,
  `beklenen ${classes.length}, gelen ${liveClasses.length}`,
);
check(
  'ders saatleri gerçek depodan geri okunuyor',
  liveEntries.length === allEntries.length,
  `beklenen ${allEntries.length}, gelen ${liveEntries.length}`,
);
check(
  'ders bazlı birleşim alanı korunuyor',
  liveClasses.find((c) => c.id === 'b')?.combinedWithByLesson?.[MAT]?.includes('a') === true,
  `gelen ${JSON.stringify(liveClasses.find((c) => c.id === 'b')?.combinedWithByLesson ?? null)}`,
);

/* ------------------------------------------------------------------ */
/* 3) Öğretmen haftalık görünümü                                       */
/* ------------------------------------------------------------------ */

console.log('\n3) Öğretmen görünümü (buildWeekGrid · mode=teacher)');

const teacherGrid = buildWeekGrid({
  mode: 'teacher',
  entries: liveEntries,
  classes: liveClasses,
  settings: DEFAULT_SETTINGS,
  teacherIds: byMail.map((t) => t.id),
});

check(
  'öğretmen yalnızca kendi ders saatlerini görüyor',
  teacherGrid.visibleEntries.length === 7 &&
    teacherGrid.visibleEntries.every((e) => e.teacherId === TEACHER_OK),
  `görünen ${teacherGrid.visibleEntries.length}, başka öğretmen ${
    teacherGrid.visibleEntries.filter((e) => e.teacherId !== TEACHER_OK).length
  }`,
);

/*
  ÖĞRETMEN PDF ÇIKTISI aynı kayıtlardan üretilir: PDF hücresi, o öğretmenin o
  gün/saatteki TÜM kayıtlarını (`find` değil `filter`) birleştirir. Bu yüzden
  öğretmen görünümünde doğru görünen hücre PDF'te de iki şubeyi taşımalıdır;
  iddia PDF üretiminin kullandığı gün/saat listeleriyle birlikte ölçülür.
*/
const teacherPdfDays = teacherGrid.days;
const teacherPdfPeriods = teacherGrid.periodsByDay.get(3) ?? [];
check(
  'PDF\'e giden gün ve saat listesi birleşik dersin hücresini kapsıyor',
  teacherPdfDays.includes(3) && teacherPdfPeriods.includes(0),
  `günler ${JSON.stringify(teacherPdfDays)}, gün 3 saatleri ${JSON.stringify(teacherPdfPeriods)}`,
);

check(
  'aynı hücredeki ikinci kayıt korunuyor (2 kayıt)',
  (teacherGrid.cellMap.get('0-0') ?? []).length === 2,
  `0-0 hücresinde ${(teacherGrid.cellMap.get('0-0') ?? []).length} kayıt`,
);

check(
  'aktif olmayan gün (Cumartesi) tabloda görünüyor',
  teacherGrid.days.includes(5),
  `günler ${JSON.stringify(teacherGrid.days)}`,
);

check(
  'ayar dışı ders saati satır olarak ekleniyor (8. saat)',
  (teacherGrid.periodsByDay.get(1) ?? []).includes(7),
  `gün 1 saatleri ${JSON.stringify(teacherGrid.periodsByDay.get(1) ?? [])}`,
);

check(
  'satır sayısı ayar dışı saati kapsayacak kadar genişliyor',
  teacherGrid.rowCount >= 8,
  `rowCount ${teacherGrid.rowCount}`,
);

/*
  KULLANICININ BİLDİRDİĞİ BELİRTİ: "ders birleştirmesi yapıldığında öğretmen
  görünümü boş kalmamalı". Birleşik ders, iki şube için İKİ AYRI kayıt olarak
  saklandığı için öğretmen hücresinin bu kayıtların TAMAMINI tutması gerekir.
  Tek kayıt tutan hücre ekranda "ders yok" görüntüsü verirdi.
*/
const combinedTeacherCell = teacherGrid.cellMap.get('3-0') ?? [];
check(
  'birleşik ders öğretmen görünümünde boş kalmıyor (aynı hücrede iki şube)',
  combinedTeacherCell.length === 2,
  `3-0 hücresinde ${combinedTeacherCell.length} kayıt: ${combinedTeacherCell
    .map((e) => e.id)
    .join(',')}`,
);
check(
  'birleşik dersin iki şubesi de öğretmen hücresinde ayrı ayrı bulunuyor',
  ['a', 'b'].every((classId) =>
    combinedTeacherCell.some((e) => e.classId === classId && e.lessonId === MAT),
  ),
  `sınıflar ${JSON.stringify(combinedTeacherCell.map((e) => `${e.classId}:${e.lessonId}`))}`,
);
check(
  'birleşik ders öğretmenin toplam ders yükünde iki saat olarak sayılıyor',
  teacherGrid.visibleEntries.filter((e) => e.dayIndex === 3 && e.lessonId === MAT).length === 2,
  `gün 3 Matematik kaydı ${
    teacherGrid.visibleEntries.filter((e) => e.dayIndex === 3 && e.lessonId === MAT).length
  }`,
);
check(
  'birleşik OLMAYAN ders aynı hücrede çoğalmıyor (negatif)',
  (teacherGrid.cellMap.get('4-0') ?? []).length === 1,
  `4-0 hücresinde ${(teacherGrid.cellMap.get('4-0') ?? []).length} kayıt`,
);

/* ------------------------------------------------------------------ */
/* 4) Öğrenci / veli görünümü                                           */
/* ------------------------------------------------------------------ */

console.log('\n4) Öğrenci görünümü (buildWeekGrid · mode=student · 8-A)');

const viewingA = liveClasses.find((c) => c.id === 'a') ?? null;
const studentGrid = buildWeekGrid({
  mode: 'student',
  entries: liveEntries,
  classes: liveClasses,
  settings: DEFAULT_SETTINGS,
  viewingClass: viewingA,
});

check(
  'ders bazlı birleşimde partner sınıfın aynı dersteki kaydı görünüyor (Matematik)',
  studentGrid.visibleEntries.some((e) => e.id === 'e5'),
  `görünen kayıtlar ${studentGrid.visibleEntries.map((e) => e.id).join(',')}`,
);

check(
  'partner sınıfın BAŞKA dersteki kaydı görünmüyor (Fen)',
  !studentGrid.visibleEntries.some((e) => e.id === 'e6'),
  `görünen kayıtlar ${studentGrid.visibleEntries.map((e) => e.id).join(',')}`,
);

check(
  'birleşim çözümü ders bazlı (A+B yalnızca Matematik)',
  getCombinedClassIds(liveClasses, 'a', MAT).length === 2 &&
    getCombinedClassIds(liveClasses, 'a', FEN).length === 1,
  `mat ${JSON.stringify(getCombinedClassIds(liveClasses, 'a', MAT))}, fen ${JSON.stringify(
    getCombinedClassIds(liveClasses, 'a', FEN),
  )}`,
);

check(
  'aktif olmayan gün (Cumartesi) öğrenci tablosunda da görünüyor',
  studentGrid.days.includes(5),
  `günler ${JSON.stringify(studentGrid.days)}`,
);

check(
  'satır sayısı kayıt bulunan en yüksek ders saatini kapsıyor',
  studentGrid.rowCount >= 8,
  `rowCount ${studentGrid.rowCount}`,
);

const emptyGrid = buildWeekGrid({
  mode: 'student',
  entries: liveEntries,
  classes: liveClasses,
  settings: DEFAULT_SETTINGS,
  viewingClass: null,
});
check(
  'sınıf bilgisi yoksa uydurma program üretilmiyor (boş ızgara)',
  emptyGrid.days.length === 0 && emptyGrid.visibleEntries.length === 0,
  `gün ${JSON.stringify(emptyGrid.days)}, kayıt ${emptyGrid.visibleEntries.length}`,
);

/* ------------------------------------------------------------------ */
/* 5) Negatif kontrol: kaydı olmayan gün boşuna çıkmamalı              */
/* ------------------------------------------------------------------ */

console.log('\n5) Negatif kontrol (kaydı olmayan gün eklenmiyor)');

const onlyMonday: ScheduleEntry[] = [entry('n1', 'a', 0, 0, MAT, TEACHER_OK)];
const narrowGrid = buildWeekGrid({
  mode: 'student',
  entries: onlyMonday,
  classes: liveClasses,
  settings: DEFAULT_SETTINGS,
  viewingClass: viewingA,
});
check(
  'yalnızca Pazartesi kaydı varsa Cumartesi/Pazar tabloya eklenmiyor',
  !narrowGrid.days.includes(5) && !narrowGrid.days.includes(6),
  `günler ${JSON.stringify(narrowGrid.days)}`,
);
check(
  'sınıfın tanımlı ders saati sayısı korunuyor (gün 0 → 5 saat)',
  periodsOfDayFor(viewingA!, DEFAULT_SETTINGS, 0).length === 5,
  `gün 0 saatleri ${JSON.stringify(periodsOfDayFor(viewingA!, DEFAULT_SETTINGS, 0))}`,
);

/* ------------------------------------------------------------------ */
/* 6) Rol / yetki erişim kararı (onaylanan (b) kararı)                 */
/* ------------------------------------------------------------------ */

/*
  Onaylanan karar iki parçalı ve parçalar birbirinin karşıtı:
    (b1) Öğretmen VARSAYILAN olarak yalnızca kendi derslerini salt okunur görür.
    (b2) Yönetici kullanıcı bazında `manage_schedule` verirse okul geneli
         düzenleme açılır.
  İki kural tek karar noktasında (`resolveScheduleAccess`) birleşmezse 2. kural
  sessizce imkânsız hâle gelir: `can('manage_schedule') && !teacherLedView`
  biçimindeki bir ifade öğretmene yetki verildiğinde bile düzenlemeyi kapatır.
  Bu yüzden burada hem varsayılan hem yetki verilmiş hâl, hem de YETKİNİN
  KAPSAMI DEĞİŞTİRMEDİĞİ ayrı ayrı ölçülür.

  İddialar uygulamanın gerçek yetki kaynağından (`ROLE_PERMISSIONS`,
  `resolvePermissions`) ve gerçek karar fonksiyonundan okunur; betik kendi
  kopyasını hesaplamaz, aksi hâlde ölçüm uygulamayı değil betiği doğrulardı.
*/

console.log('\n6) Rol / yetki erişim kararı (resolveScheduleAccess)');

const teacherDefaultPerms = resolvePermissions('ogretmen');
check(
  'öğretmen varsayılan yetkilerinde manage_schedule YOK (b1)',
  !teacherDefaultPerms.has('manage_schedule'),
  `varsayılan: ${[...teacherDefaultPerms].join(', ')}`,
);
check(
  'öğretmen varsayılanında manage_schedule anahtarı role hiç yazılmamış',
  !(ROLE_PERMISSIONS.ogretmen ?? []).includes('manage_schedule'),
  `ROLE_PERMISSIONS.ogretmen = ${JSON.stringify(ROLE_PERMISSIONS.ogretmen)}`,
);
check(
  'rehber öğretmen varsayılanında da manage_schedule yok',
  !resolvePermissions('rehber').has('manage_schedule'),
  `varsayılan: ${[...resolvePermissions('rehber')].join(', ')}`,
);
check(
  'yönetici varsayılanında manage_schedule VAR (okul geneli düzenleme)',
  resolvePermissions('admin').has('manage_schedule'),
  `varsayılan: ${[...resolvePermissions('admin')].join(', ')}`,
);

/** Sayfanın gerçekte yaptığı hesap: `can('manage_schedule')` + rol. */
function accessFor(role?: string, raw?: string) {
  return resolveScheduleAccess({
    role,
    canManage: resolvePermissions(role as never, raw).has('manage_schedule'),
  });
}

const teacherRead = accessFor('ogretmen');
check(
  'öğretmen varsayılanı SALT OKUNUR ve kapsamı KENDİ DERSLERİ (b1)',
  teacherRead.editable === false &&
    teacherRead.viewMode === 'read' &&
    teacherRead.teacherLedView === true &&
    teacherRead.readonlyScope === 'teacher',
  `editable=${teacherRead.editable} view=${teacherRead.viewMode} kapsam=${teacherRead.readonlyScope}`,
);

const teacherGranted = accessFor('ogretmen', 'manage_schedule');
check(
  'yönetici manage_schedule verince öğretmende OKUL GENELİ DÜZENLEME açılıyor (b2)',
  teacherGranted.editable === true &&
    teacherGranted.viewMode === 'edit' &&
    teacherGranted.teacherLedView === true,
  `editable=${teacherGranted.editable} view=${teacherGranted.viewMode} teacherLed=${teacherGranted.teacherLedView}`,
);
check(
  'yetki verilmesi salt-okunur KAPSAMI bozmuyor (kendi dersleriyle süzülür)',
  teacherGranted.readonlyScope === 'teacher',
  `kapsam=${teacherGranted.readonlyScope}`,
);
check(
  'yetki metinden çözülüyor: "-manage_schedule" yazılırsa düzenleme kapanıyor',
  accessFor('ogretmen', '-manage_schedule').editable === false,
  `editable=${accessFor('ogretmen', '-manage_schedule').editable}`,
);

const adminAccess = accessFor('admin');
check(
  'yönetici okul geneli düzenleme modunda açılıyor',
  adminAccess.editable === true && adminAccess.viewMode === 'edit',
  `editable=${adminAccess.editable} view=${adminAccess.viewMode}`,
);
check(
  'yöneticinin salt-okunur kapsamı öğretmen biçimli yayınlanmış tablo (adına süzülmüyor)',
  adminAccess.readonlyScope === 'teacher' && adminAccess.teacherLedView === false,
  `kapsam=${adminAccess.readonlyScope} teacherLed=${adminAccess.teacherLedView}`,
);

const parentAccess = accessFor('veli');
const studentAccess = accessFor('ogrenci');
check(
  'veli ve öğrenci öğretmen moduna DÜŞMÜYOR (kendi sınıfları)',
  parentAccess.readonlyScope === 'student' &&
    parentAccess.teacherLedView === false &&
    studentAccess.readonlyScope === 'student' &&
    studentAccess.teacherLedView === false,
  `veli=${parentAccess.readonlyScope}/${parentAccess.teacherLedView} öğrenci=${studentAccess.readonlyScope}/${studentAccess.teacherLedView}`,
);
check(
  'veli/öğrenci varsayılanda düzenleme açamıyor',
  parentAccess.editable === false && studentAccess.editable === false,
  `veli=${parentAccess.editable} öğrenci=${studentAccess.editable}`,
);
check(
  'veliye yanlışlıkla manage_schedule verilse bile kapsam öğretmene dönmüyor (negatif)',
  accessFor('veli', 'manage_schedule').readonlyScope === 'student' &&
    accessFor('veli', 'manage_schedule').teacherLedView === false,
  `kapsam=${accessFor('veli', 'manage_schedule').readonlyScope}`,
);
check(
  'kapsam ROL kararı: isTeacherLedView öğretmen/rehber true, admin/veli false',
  isTeacherLedView('ogretmen') === true &&
    isTeacherLedView('rehber') === true &&
    isTeacherLedView('admin') === false &&
    isTeacherLedView('veli') === false &&
    isTeacherLedView('ogrenci') === false,
  `admin=${isTeacherLedView('admin')} veli=${isTeacherLedView('veli')}`,
);

/* ------------------------------------------------------------------ */
/* 7) Sınıf bilgisi girilmeden adına yazılmış ek ders                  */
/* ------------------------------------------------------------------ */

/*
  KULLANICININ BİLDİRDİĞİ GEREKSİNİM: "ders programında ek ders, sınıf bilgisi
  girilmeden öğrenci adı girilerek kaydedildiğinde öğrenci ve veli ders
  programında görebilsin".

  Böyle bir kaydın `classId` alanı BOŞTUR; tek kimlik bilgisi elle yazılan
  `studentName` alanıdır. Eski süzgeç yalnızca sınıf kimliğine baktığı için bu
  kayıt hiçbir öğrenci/veli ekranında görünmüyordu — ekranda "boş hücre" olarak
  tezahür ettiği için gözle ayırt edilemezdi.

  Ölçüm gerçek fonksiyonlarla yapılır (`matchesStudentName`, `buildWeekGrid`);
  ayrıca her olumlu iddianın KARŞITI da ölçülür: yanlış soyadlı kayıt, tek
  kelimelik ad, fazla kelimeli ad ve kardeş sekmesi. Yalnızca "görünüyor"
  iddiası ölçülseydi adı benzeyen başka öğrencinin ek dersini gösterme hatası
  yeşil kalırdı.
*/

console.log('\n7) Sınıf bilgisi girilmeden yazılan ek ders (ada dayalı eşleşme)');

check(
  'tam ad eşleşmesi çalışıyor',
  matchesStudentName('zeynep kaya', ['Zeynep Kaya']),
  'tam ad eşleşmedi',
);
check(
  'ad + baş harf eşleşiyor (Zeynep K. → Zeynep Kaya)',
  matchesStudentName('Zeynep K.', ['Zeynep Kaya']),
  'baş harf eşleşmedi',
);
check(
  'Türkçe karakter farkı eşleşmeyi düşürmüyor (Şeyma ↔ Seyma)',
  matchesStudentName('Seyma Kaya', ['Şeyma Kaya']) &&
    matchesStudentName('Şeyma Kaya', ['Seyma Kaya']),
  'katlama başarısız',
);
check(
  'kayıt defterinde yalnız ad varsa birebir eşleşiyor',
  matchesStudentName('Zeynep', ['Zeynep']),
  'tek kelimelik tam eşleşme başarısız',
);
check(
  'farklı soyad eşleşmiyor (negatif)',
  !matchesStudentName('Ali Veli', ['Zeynep Kaya']),
  'yabancı ad eşleşti',
);
check(
  'tek kelimelik kayıt soyadı bilinmediği için eşleşmiyor (negatif)',
  !matchesStudentName('Zeynep', ['Zeynep Kaya']),
  'soyadı olmadan eşleşti',
);
check(
  'kayıttaki ad kayıtlı addan uzunsa eşleşmiyor (negatif)',
  !matchesStudentName('Zeynep Kaya Ayşe', ['Zeynep Kaya']),
  'fazla kelime eşleşti',
);
check(
  'ada dayalı kayıt, öğrenci adı verilmezse gösterilmiyor (negatif)',
  !matchesStudentName('Zeynep K.' as string | undefined, []) &&
    !matchesStudentName(undefined, ['Zeynep Kaya']),
  'ad listesi boşken veya ad boşken eşleşti',
);

const ZEYNEP = 'Zeynep Kaya';
const ALI = 'Ali Veli';

/** Sınıf bilgisi girilmeden, yalnızca adına yazılmış ek dersler. */
const nameEntries: ScheduleEntry[] = [
  // Eşleşmesi beklenen kayıt (öğretmen soyadı baş harfle yazmış).
  entry('n1', '', 2, 3, MAT, TEACHER_OK, {
    isExtra: true,
    extraType: 'question',
    studentName: 'Zeynep K.',
  }),
  // Başka öğrencinin ek dersi (görünmemeli).
  entry('n2', '', 2, 3, FEN, 't-mehmet', {
    isExtra: true,
    extraType: 'study',
    studentName: ALI,
  }),
  // Sınıfı da adı da olmayan kayıt (hiçbir öğrenciye gösterilmemeli).
  entry('n3', '', 2, 3, MAT, TEACHER_OK, { isExtra: true, extraType: 'question' }),
  // Program ayarının dışındaki gün (Pazar, index 6) ve ders saati (index 9).
  entry('n4', '', 6, 9, MAT, TEACHER_OK, {
    isExtra: true,
    extraType: 'question',
    studentName: 'zeynep kaya',
  }),
];

const nameInput = {
  mode: 'student' as const,
  entries: nameEntries,
  classes: liveClasses,
  settings: DEFAULT_SETTINGS,
  viewingClass: viewingA,
};

const zeynepGrid = buildWeekGrid({ ...nameInput, studentNames: [ZEYNEP] });
check(
  'öğrencinin adına yazılmış ek ders programda görünüyor',
  zeynepGrid.visibleEntries.some((e) => e.id === 'n1'),
  `görünen kayıtlar ${zeynepGrid.visibleEntries.map((e) => e.id).join(',') || 'boş'}`,
);
check(
  'öğrencinin ek dersi haftalık ızgarada hücrede yer alıyor (gün 2 · 4. ders)',
  (zeynepGrid.cellMap.get('2-3') ?? []).some((e) => e.id === 'n1'),
  `2-3 hücresinde ${(zeynepGrid.cellMap.get('2-3') ?? []).map((e) => e.id).join(',') || 'kayıt yok'}`,
);
check(
  'başka öğrencinin ek dersi görünmüyor (negatif)',
  !zeynepGrid.visibleEntries.some((e) => e.id === 'n2'),
  `görünen kayıtlar ${zeynepGrid.visibleEntries.map((e) => e.id).join(',')}`,
);
check(
  'sınıfı ve öğrenci adı olmayan kayıt hiç kimseye gösterilmiyor (negatif)',
  !zeynepGrid.visibleEntries.some((e) => e.id === 'n3'),
  `görünen kayıtlar ${zeynepGrid.visibleEntries.map((e) => e.id).join(',')}`,
);
check(
  'kayıt bulunan gün ve ders saati ayarın dışında olsa da tabloya ekleniyor (Pazar · 10. ders)',
  zeynepGrid.days.includes(6) &&
    (zeynepGrid.periodsByDay.get(6) ?? []).includes(9) &&
    zeynepGrid.rowCount >= 10,
  `günler ${JSON.stringify(zeynepGrid.days)}, gün 6 saatleri ${JSON.stringify(
    zeynepGrid.periodsByDay.get(6) ?? [],
  )}, rowCount ${zeynepGrid.rowCount}`,
);
check(
  'tablo başlığı için öğrenci adı ve sınıfsız durum aktarılabiliyor',
  zeynepGrid.visibleEntries.every((e) => !e.classId && e.studentName),
  `sınıfsız olmayan kayıt ${
    zeynepGrid.visibleEntries.filter((e) => e.classId).length
  }, adsız kayıt ${zeynepGrid.visibleEntries.filter((e) => !e.studentName).length}`,
);

const aliGrid = buildWeekGrid({ ...nameInput, studentNames: [ALI] });
check(
  'kardeş sekmesinde yalnızca o öğrencinin ek dersi görünüyor',
  aliGrid.visibleEntries.some((e) => e.id === 'n2') &&
    !aliGrid.visibleEntries.some((e) => e.id === 'n1'),
  `görünen kayıtlar ${aliGrid.visibleEntries.map((e) => e.id).join(',') || 'boş'}`,
);

const anonymousGrid = buildWeekGrid(nameInput);
check(
  'öğrenci adları verilmeden ada dayalı kayıt gösterilmiyor (mevcut davranış korunuyor)',
  anonymousGrid.visibleEntries.length === 0 && anonymousGrid.days.length === 0,
  `kayıt ${anonymousGrid.visibleEntries.length}, gün ${JSON.stringify(anonymousGrid.days)}`,
);

/* ------------------------------------------------------------------ */
/* Özet                                                                */
/* ------------------------------------------------------------------ */

const total = passed + failures.length;
console.log(`\n=== DERS PROGRAMI GÖRÜNÜMÜ: ${passed}/${total} OK ===`);
if (failures.length > 0) {
  console.log('Başarısız iddialar:');
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
