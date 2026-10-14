/**
 * Ödev akışı kanıtı: sınıfa toplu atama, görüş zorunluluğu ve rol yetkileri.
 *
 * Neden bu betik gerekli
 * ----------------------
 * Kullanıcı üç davranış istedi ve üçü de ekranda **sessiz** bozulabilir:
 *
 *  (a) "Sınıfın tamamına ata" → N öğrenci için N kayıt açılır ama raporda **tek
 *      ödev** görünmelidir. Gruplama anahtarı iki katmanda (kayıt + rapor) ayrı
 *      üretilseydi aynı ödev raporda N satıra bölünür, "30 kişiye verildi, 1 kişi
 *      yaptı" bilgisi yerine 30 satırlık gürültü çıkardı. Ekranda bu hata yalnızca
 *      "liste uzadı" gibi görünür.
 *  (b) Ödev, öğretmen görüşü olmadan kapanmamalıdır. Kural yalnızca düğmeyi
 *      kilitlemekle uygulansaydı, doğrudan kayıt katmanına yazan her yol (eski
 *      önbellek, yedekten geri yükleme, başka ekran) ödevi görüşsüz kapatabilirdi.
 *  (c) Veli/öğrenci yalnızca sonuç (soru/doğru) girebilmelidir. Yetki ayrımı rol
 *      adına sabitlenseydi yöneticinin tek bir kullanıcıya verdiği yetki kapsamı
 *      değiştiremezdi.
 *
 * Bu yüzden ölçüm ekranda değil **karar katmanında** yapılır: `homeworkFlow`
 * (saf kurallar), `records` (yazma kapısı), `site` (yetki çözümlemesi) ve
 * `homeworkReports` (gruplama) fonksiyonları gerçek girdilerle çağrılır.
 *
 * Her olumlu iddianın karşıtı da aynı koşuda ölçülür: tekrar atamanın kopya
 * üretmemesi, görüşsüz kapatmanın **reddedilmesi** ve kapanmış ödevden görüşün
 * silinememesi. Yalnızca olumlu iddialar ölçülseydi kural tamamen kaldırıldığında
 * da (her güncelleme geçer) liste yeşil kalırdı.
 *
 * Çalıştırma:
 *   BENCH_ENTRY=scripts/bench-homework.ts pnpm exec vite build --config vite.bench.config.ts
 *   node .bench/bench.mjs
 */
/*
  DİKKAT: shim importu EN ÜSTTE olmalıdır. Kayıt katmanı `localStorage` bekler;
  ESM içe aktarmaları sırayla değerlendirildiği için shim ilk sırada olmazsa
  Node "localStorage is not defined" veya sessiz boş depo ile düşer.
*/
import './node-shim';

import {
  buildClassHomeworkItems,
  canSelectStatus,
  homeworkCapabilities,
  homeworkGroupKey,
  normalizeHomework,
} from '@/lib/homeworkFlow';
import {
  addHomeworkBatch,
  emptyRecords,
  homeworkOf,
  loadRecords,
  updateHomeworkChecked,
} from '@/lib/records';
import { resolvePermissions, type Permission, type Role } from '@/lib/site';
import {
  buildAssignmentRows,
  buildHomeworkOverview,
  scopeHomework,
  splitAssignmentStudents,
} from '@/lib/homeworkReports';
import {
  HOMEWORK_STATUS_META,
  MOOD_META,
  homeworkStatusMeta,
  isGuidanceMood,
  isHomeworkStatus,
  moodMeta,
  type Homework,
  type SchoolRecords,
} from '@/lib/types';

/* -------------------------------------------------------------------------- */
/* Küçük doğrulama çerçevesi                                                   */
/* -------------------------------------------------------------------------- */

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail: string): void {
  if (condition) {
    passed += 1;
    console.log(`  OK   ${label}`);
  } else {
    failures.push(`${label} — ${detail}`);
    console.log(`  FAIL ${label} — ${detail}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

/* -------------------------------------------------------------------------- */
/* Ortak kurulum                                                               */
/* -------------------------------------------------------------------------- */

/** Yetki çözümlemesi uygulamanın kendi fonksiyonundan gelir (ikinci mantık yok). */
const canAs = (role: Role) => (permission: Permission) =>
  resolvePermissions(role).has(permission);

const STUDENTS = [
  { studentKey: 'elif-yilmaz', studentName: 'Elif Yılmaz', className: '8-A' },
  { studentKey: 'mert-demir', studentName: 'Mert Demir', className: '8-A' },
  { studentKey: 'zeynep-kaya', studentName: 'Zeynep Kaya', className: '8-A' },
  { studentKey: 'ahmet-oz', studentName: 'Ahmet Öz', className: '8-A' },
];

const refs = STUDENTS.map((s) => ({ ...s }));

/** Tarih sabit tutulur: gecikme hesabı "bugün"e bağlı olduğu için iddialar kaymasın. */
const ASSIGNED_AT = '2026-09-14';
const DUE_AT = '2026-09-18';

const draft = {
  title: 'Oran-orantı 30 soru',
  subject: 'Matematik',
  topic: 'Oran ve orantı',
  dueAt: DUE_AT,
  assignedAt: ASSIGNED_AT,
};

const seededRecords = (): SchoolRecords => {
  const plan = buildClassHomeworkItems(refs, draft, []);
  return addHomeworkBatch(emptyRecords(), plan.items);
};

/* -------------------------------------------------------------------------- */
/* 1) Sınıfa toplu atama                                                       */
/* -------------------------------------------------------------------------- */

section('1) Sınıfa toplu atama — her öğrenci ayrı kayıt, raporda tek ödev');

const classPlan = buildClassHomeworkItems(refs, draft, []);
check(
  'dört öğrenciye dört kayıt üretiliyor',
  classPlan.items.length === 4,
  `beklenen 4, gelen ${classPlan.items.length}`,
);
check(
  'ilk atamada hiç öğrenci atlanmıyor',
  classPlan.skipped === 0,
  `beklenen 0, gelen ${classPlan.skipped}`,
);
check(
  'tüm kopyalar aynı grup anahtarını taşıyor',
  new Set(classPlan.items.map((i) => i.groupId)).size === 1,
  `farklı grup sayısı ${new Set(classPlan.items.map((i) => i.groupId)).size}`,
);
check(
  'grup anahtarı kayıt katmanıyla aynı fonksiyondan üretiliyor',
  classPlan.items[0].groupId === homeworkGroupKey(draft),
  `plan=${classPlan.items[0].groupId} akış=${homeworkGroupKey(draft)}`,
);
check(
  'her kayıt öğrencinin kendi anahtarına bağlı',
  classPlan.items.map((i) => i.studentKey).join(',') === refs.map((r) => r.studentKey).join(','),
  classPlan.items.map((i) => i.studentKey).join(','),
);
check(
  'kayıtlar "atandı" durumunda ve kaynağı sınıf ataması',
  classPlan.items.every((i) => i.status === 'atandi' && i.source === 'class'),
  JSON.stringify(classPlan.items.map((i) => [i.status, i.source])),
);

const base = seededRecords();
check(
  'kayıt katmanına dört ödev yazılıyor',
  base.homework.length === 4,
  `beklenen 4, gelen ${base.homework.length}`,
);

const baseScoped = scopeHomework(base.homework, refs, { includeUnmatched: true });
const rows = buildAssignmentRows(baseScoped);
check(
  'rapor aynı ödevi TEK satırda gösteriyor',
  rows.length === 1,
  `beklenen 1 satır, gelen ${rows.length}`,
);
check(
  'tek satır dört öğrenciyi taşıyor',
  rows[0]?.students.length === 4,
  `beklenen 4, gelen ${rows[0]?.students.length}`,
);
check(
  'satır ölçütleri (toplam/bekleyen) doğru',
  rows[0]?.metrics.total === 4 && rows[0]?.metrics.pending === 4,
  `toplam=${rows[0]?.metrics.total} bekleyen=${rows[0]?.metrics.pending}`,
);
check(
  'özet ayrı ödev sayısını 1 sayıyor',
  buildHomeworkOverview(baseScoped).assignmentCount === 1,
  `gelen ${buildHomeworkOverview(baseScoped).assignmentCount}`,
);
check(
  'özet dört ayrı öğrenci sayıyor',
  buildHomeworkOverview(baseScoped).studentCount === 4,
  `gelen ${buildHomeworkOverview(baseScoped).studentCount}`,
);

/* -------------------------------------------------------------------------- */
/* 2) Tekrarlı atama kopya üretmiyor                                           */
/* -------------------------------------------------------------------------- */

section('2) Aynı ödev ikinci kez atanınca kopya oluşmuyor');

const repeat = buildClassHomeworkItems(refs, draft, base.homework);
check(
  'ikinci atamada yeni kayıt üretilmiyor',
  repeat.items.length === 0,
  `beklenen 0, gelen ${repeat.items.length}`,
);
check(
  'dört öğrenci "daha önce atandı" olarak sayılıyor',
  repeat.skipped === 4,
  `beklenen 4, gelen ${repeat.skipped}`,
);

const afterRepeat = addHomeworkBatch(base, repeat.items);
check(
  'kayıt defteri ikinci atamadan sonra da dört ödevde kalıyor',
  afterRepeat.homework.length === 4,
  `gelen ${afterRepeat.homework.length}`,
);

const latecomer = buildClassHomeworkItems([...refs, { studentKey: 'yeni-ogrenci', studentName: 'Yeni Öğrenci', className: '8-A' }], draft, base.homework);
check(
  'sonradan eklenen öğrenci tek başına atanıyor',
  latecomer.items.length === 1 && latecomer.items[0].studentKey === 'yeni-ogrenci',
  `gelen ${latecomer.items.length}`,
);
check(
  'mevcut öğrenciler tekrar kaydedilmiyor',
  latecomer.skipped === 4,
  `beklenen 4, gelen ${latecomer.skipped}`,
);

const otherDue = homeworkGroupKey({ ...draft, dueAt: '2026-09-25' });
check(
  'aynı başlık farklı teslim tarihinde AYRI ödev sayılıyor',
  otherDue !== homeworkGroupKey(draft),
  `iki anahtar eşit (${otherDue})`,
);
const otherSubject = homeworkGroupKey({ ...draft, subject: 'Fen Bilimleri' });
check(
  'aynı başlık farklı derste AYRI ödev sayılıyor',
  otherSubject !== homeworkGroupKey(draft),
  `iki anahtar eşit (${otherSubject})`,
);
const sameSecondTime = homeworkGroupKey({ ...draft });
check(
  'aynı girdi her çağrıda aynı anahtarı üretiyor',
  sameSecondTime === homeworkGroupKey(draft),
  'anahtar kararsız',
);

/* -------------------------------------------------------------------------- */
/* 3) Görüş zorunluluğu (kayıt katmanı kapısı)                                 */
/* -------------------------------------------------------------------------- */

section('3) Ödev, öğretmen görüşü olmadan kapanmıyor');

const target = base.homework[0];
const denied = updateHomeworkChecked(base, target.id, { status: 'yapildi' });
check(
  'görüşsüz kapatma kayıt katmanında REDDEDİLİYOR',
  denied.ok === false,
  `ok=${denied.ok}`,
);
check(
  'reddedilen güncellemede kayıtlar hiç değişmiyor',
  JSON.stringify(denied.records) === JSON.stringify(base),
  'kayıtlar değişti',
);
check(
  'reddin nedeni kullanıcıya açıklanıyor',
  Boolean(denied.reason && denied.reason.includes('görüş')),
  denied.reason ?? 'neden yok',
);

const opinion = updateHomeworkChecked(base, target.id, {
  result: 'Soruların çoğu doğru, çarpma hatası var.',
  opinionBy: 'Ayşe Öğretmen',
  opinionAt: '2026-09-18T10:00:00.000Z',
});
check(
  'görüş yazmak geçerli bir güncelleme',
  opinion.ok === true,
  opinion.reason ?? 'ok değil',
);
check(
  'görüş kayda yazan hesap ve zamanla işleniyor',
  opinion.records.homework.find((h) => h.id === target.id)?.opinionBy === 'Ayşe Öğretmen' &&
    Boolean(opinion.records.homework.find((h) => h.id === target.id)?.opinionAt),
  JSON.stringify(opinion.records.homework.find((h) => h.id === target.id)),
);

const closed = updateHomeworkChecked(opinion.records, target.id, { status: 'yapildi' });
check(
  'görüş yazıldıktan sonra kapatma kabul ediliyor',
  closed.ok === true && closed.records.homework.find((h) => h.id === target.id)?.status === 'yapildi',
  `ok=${closed.ok}`,
);

const stripped = updateHomeworkChecked(closed.records, target.id, { result: undefined });
check(
  'kapanmış ödevden görüş SİLİNEMİYOR',
  stripped.ok === false,
  `ok=${stripped.ok}`,
);
check(
  'görüş silme reddi kaydı bozmuyor',
  stripped.records.homework.find((h) => h.id === target.id)?.result === 'Soruların çoğu doğru, çarpma hatası var.',
  'görüş kayboldu',
);

const notFound = updateHomeworkChecked(base, 'olmayan-id', { status: 'yapildi' });
check(
  'olmayan ödev kaydı sessizce başarılı sayılmıyor',
  notFound.ok === false && Boolean(notFound.reason),
  `ok=${notFound.ok}`,
);

check(
  'kapalı ödev tanımı görüş + terminal durum istiyor',
  (() => {
    const item = closed.records.homework.find((h) => h.id === target.id) as Homework;
    const open = { ...item, result: undefined };
    return item.status === 'yapildi' && Boolean(item.result) && open.status === 'yapildi';
  })(),
  'kapalılık tanımı tutarsız',
);

/* -------------------------------------------------------------------------- */
/* 4) Eski kayıtların onarımı                                                  */
/* -------------------------------------------------------------------------- */

section('4) Kural öncesi görüşsüz kapatılmış kayıtlar onarılıyor');

const legacy: Homework = {
  id: 'legacy-1',
  studentKey: 'elif-yilmaz',
  studentName: 'Elif Yılmaz',
  title: 'Eski kayıt',
  assignedAt: ASSIGNED_AT,
  status: 'yapildi',
};
const repaired = normalizeHomework(legacy);
check(
  'görüşsüz kapatılmış eski kayıt yeniden "devam ediyor" oluyor',
  repaired.status === 'yapiliyor' && repaired.result === undefined,
  JSON.stringify(repaired),
);
const untouched = normalizeHomework({ ...legacy, result: 'Görüş var' });
check(
  'görüşlü kayıt onarımda değiştirilmiyor',
  untouched.status === 'yapildi' && untouched.result === 'Görüş var',
  JSON.stringify(untouched),
);
const identity = normalizeHomework(untouched);
check(
  'değişiklik gerekmeyen kayıtta yeni nesne üretilmiyor',
  identity === untouched,
  'gereksiz kopya üretildi',
);

/* -------------------------------------------------------------------------- */
/* 5) Rol bazlı yetkiler                                                       */
/* -------------------------------------------------------------------------- */

section('5) Rol yetkileri — görüş ve kapatma personele, sonuç herkese');

const teacher = homeworkCapabilities('ogretmen', canAs('ogretmen'));
const guide = homeworkCapabilities('rehber', canAs('rehber'));
const admin = homeworkCapabilities('admin', canAs('admin'));
const parent = homeworkCapabilities('veli', canAs('veli'));
const student = homeworkCapabilities('ogrenci', canAs('ogrenci'));

check(
  'öğretmen görüş yazar, atama yapar ve sonuç girer',
  teacher.canWriteOpinion && teacher.canAssign && teacher.canAssignClass && teacher.canEnterResult,
  JSON.stringify(teacher),
);
check(
  'rehber öğretmen görüş yazar',
  guide.canWriteOpinion && guide.canEnterResult,
  JSON.stringify(guide),
);
check(
  'yönetici görüş yazar',
  admin.canWriteOpinion && admin.canAssign,
  JSON.stringify(admin),
);
check(
  'veli görüş YAZAMAZ ama sonuç girebilir',
  parent.canWriteOpinion === false && parent.canEnterResult === true,
  JSON.stringify(parent),
);
check(
  'öğrenci görüş YAZAMAZ ama sonuç girebilir',
  student.canWriteOpinion === false && student.canEnterResult === true,
  JSON.stringify(student),
);
check(
  'veli ve öğrenci ödev atayamaz',
  !parent.canAssign && !parent.canAssignClass && !student.canAssign && !student.canAssignClass,
  JSON.stringify({ parent, student }),
);
check(
  'veli ve öğrenci ödev silemez',
  parent.canDelete === false && student.canDelete === false,
  JSON.stringify({ p: parent.canDelete, s: student.canDelete }),
);

const openForTeacher = canSelectStatus(teacher, target, 'yapildi');
const openForParent = canSelectStatus(parent, target, 'yapildi');
check(
  'görüşsüz ödevde öğretmenin "yapıldı" düğmesi gerekçesiyle kapalı',
  openForTeacher.allowed === false && Boolean(openForTeacher.reason),
  JSON.stringify(openForTeacher),
);
check(
  'veli/öğrenci durum değiştiremiyor (gerekçe: yetki)',
  openForParent.allowed === false,
  JSON.stringify(openForParent),
);

const withOpinion: Homework = { ...target, result: 'Görüş yazıldı', opinionAt: '2026-09-18T10:00:00.000Z' };
check(
  'görüş yazıldığında öğretmenin kapatma düğmesi açılıyor',
  canSelectStatus(teacher, withOpinion, 'yapildi').allowed === true,
  JSON.stringify(canSelectStatus(teacher, withOpinion, 'yapildi')),
);
check(
  '"devam ediyor" durumu görüşsüz de seçilebiliyor (ödev açık kalır)',
  canSelectStatus(teacher, target, 'yapiliyor').allowed === true,
  'açık durum engellendi',
);
check(
  'yönetici bir kullanıcıya görüş yetkisi verdiğinde veli de yazabiliyor',
  homeworkCapabilities('veli', (p) => resolvePermissions('veli', 'homework_opinion').has(p))
    .canWriteOpinion === true,
  'ek yetki etkisiz',
);
check(
  'görüş yetkisi kaldırılan öğretmen kapatamıyor',
  homeworkCapabilities('ogretmen', (p) => resolvePermissions('ogretmen', '-homework_opinion').has(p))
    .canWriteOpinion === false,
  'kaldırılan yetki etkisiz',
);

/* -------------------------------------------------------------------------- */
/* 6) Rapor ve kapsam                                                          */
/* -------------------------------------------------------------------------- */

section('6) Rapor gruplama ve öğrenci kapsamı');

const progressRecords = (() => {
  const batchPlan = buildClassHomeworkItems(refs, draft, []);
  let records = addHomeworkBatch(emptyRecords(), batchPlan.items);
  const byKey = new Map(records.homework.map((h) => [h.studentKey, h.id]));
  // Bir öğrenci: görüş + yapıldı; bir öğrenci: görüş + yapılmadı; ikisi bekliyor.
  [['elif-yilmaz', 'yapildi'], ['mert-demir', 'yapilmadi']].forEach(([key, status]) => {
    const id = byKey.get(key) as string;
    records = updateHomeworkChecked(records, id, { result: 'Değerlendirildi' }).records;
    records = updateHomeworkChecked(records, id, { status: status as Homework['status'] }).records;
  });
  return records;
})();

const progressRows = buildAssignmentRows(scopeHomework(progressRecords.homework, refs));
check(
  'ilerleme girildiğinde de tek ödev satırı kalıyor',
  progressRows.length === 1,
  `gelen ${progressRows.length}`,
);
check(
  'yapan / yapmayan / bekleyen ayrımı doğru',
  progressRows[0].metrics.done === 1 &&
    progressRows[0].metrics.notDone === 1 &&
    progressRows[0].metrics.pending === 2,
  JSON.stringify(progressRows[0].metrics),
);
const split = splitAssignmentStudents(progressRows[0]);
check(
  'yapan ve yapmayan öğrenci adları rapora giriyor',
  split.done.length === 1 && split.notDone.length === 1 && split.pending.length === 2,
  JSON.stringify({ done: split.done.length, not: split.notDone.length, pending: split.pending.length }),
);
check(
  'tamamlanma yüzdesi kesinleşmiş kayıtlara göre hesaplanıyor',
  progressRows[0].metrics.completion === 25 && progressRows[0].metrics.resolvedRate === 50,
  `completion=${progressRows[0].metrics.completion} resolved=${progressRows[0].metrics.resolvedRate}`,
);

const onlyElif = homeworkOf(progressRecords, 'elif-yilmaz');
check(
  'öğrenci kaydı yalnızca kendi ödevlerini veriyor',
  onlyElif.length === 1 && onlyElif.every((h) => h.studentKey === 'elif-yilmaz'),
  `gelen ${onlyElif.length}`,
);
check(
  'başka öğrencinin anahtarıyla sorgu boş dönüyor',
  homeworkOf(progressRecords, 'olmayan-ogrenci').length === 0,
  'yabancı kayıt sızdı',
);

const unmatched: Homework = {
  id: 'orphan-1',
  studentKey: 'kayitta-olmayan',
  studentName: 'Kayıtta Olmayan Öğrenci',
  title: 'Yetim ödev',
  assignedAt: ASSIGNED_AT,
  status: 'atandi',
};
const scopedStrict = scopeHomework([...progressRecords.homework, unmatched], refs);
const scopedWide = scopeHomework([...progressRecords.homework, unmatched], refs, { includeUnmatched: true });
check(
  'kayıt defterinde eşleşmeyen ödev sınıf raporuna alınmıyor',
  scopedStrict.length === 4,
  `gelen ${scopedStrict.length}`,
);
check(
  'kurum geneli raporda eşleşmeyen ödev "Sınıf atanmamış" altında toplanıyor',
  scopedWide.length === 5 && scopedWide.some((r) => r.className === 'Sınıf atanmamış' && !r.matched),
  JSON.stringify(scopedWide.map((r) => r.className)),
);
check(
  'eşleşmeyen kayıt özet sayacında ayrıca bildiriliyor',
  buildHomeworkOverview(scopedWide).unmatchedCount === 1,
  `gelen ${buildHomeworkOverview(scopedWide).unmatchedCount}`,
);

/* -------------------------------------------------------------------------- */
/* 6) Eski ve bozuk yerel veriyle güvenli açılış                               */
/* -------------------------------------------------------------------------- */

/*
  Neden ayrı bölüm
  ---------------
  Kullanıcının bildirdiği açılış hatası (`Cannot read properties of undefined
  (reading 'chip')`) veriden geliyordu: kayıt defterindeki bir ödev, ödev durumu
  sözlüğünde bulunmayan bir değer taşıyordu ve ekran doğrudan meta tablosunu
  okuduğu için tek bozuk alan bütün karneyi düşürüyordu.

  Kusurun asıl kaynağı iki ayrı sözlüğün karışmasıdır: ödev durumları
  (`atandi`/`yapiliyor`/`yapildi`/`yapilmadi`) ile rehberlik ruh hâlleri
  (`iyi`/`normal`/`dikkat`) farklı anahtar kümeleridir; `dikkat` yalnızca ruh
  hâlinde geçerlidir. Bu yüzden iddialar hem iki sözlüğün ayrık kaldığını hem de
  gerçek okuma yolunun bozuk kaydı onardığını ölçer. Hata yalnızca eski bir
  önbellekte veya JSON yedeğinde göründüğü için ekranda teşhis edilemez; ölçüm
  olmadan "düzeldi" denemez.
*/

section('6) Eski ve bozuk yerel veriyle güvenli açılış');

check(
  'ödev durumu ve ruh hâli sözlükleri birbirine karışmıyor (hatanın kökü)',
  !isHomeworkStatus('dikkat') &&
    !isHomeworkStatus('normal') &&
    isGuidanceMood('dikkat') &&
    isGuidanceMood('normal'),
  `durum(dikkat)=${isHomeworkStatus('dikkat')} ruhHâli(dikkat)=${isGuidanceMood('dikkat')}`,
);

check(
  'tanım dışı ödev durumu meta çözümleyicisinde undefined bırakmıyor',
  (() => {
    const meta = homeworkStatusMeta('dikkat');
    return Boolean(meta && meta.label && meta.chip && meta.dot);
  })(),
  JSON.stringify(homeworkStatusMeta('dikkat')),
);

check(
  'tanım dışı ödev durumu güvenli varsayılana ("Atandı") iniyor',
  homeworkStatusMeta('dikkat').label === HOMEWORK_STATUS_META.atandi.label,
  homeworkStatusMeta('dikkat').label,
);

check(
  'geçerli ruh hâli çip üretiyor, tanım dışısı çip üretmiyor',
  moodMeta('dikkat')?.chip === MOOD_META.dikkat.chip && moodMeta('kaygili') === undefined,
  `geçerli=${JSON.stringify(moodMeta('dikkat'))} geçersiz=${JSON.stringify(moodMeta('kaygili'))}`,
);

const brokenHomework = {
  ...progressRecords.homework[0],
  status: 'dikkat' as unknown as Homework['status'],
};
const repairedHomework = normalizeHomework(brokenHomework);

check(
  'bozuk durumlu ödev okuma yolunda geçerli duruma çekiliyor',
  isHomeworkStatus(repairedHomework.status) && repairedHomework.status === 'atandi',
  `gelen ${repairedHomework.status}`,
);

check(
  'onarım sırasında ödevin diğer alanları korunuyor',
  repairedHomework.id === brokenHomework.id &&
    repairedHomework.title === brokenHomework.title &&
    repairedHomework.studentKey === brokenHomework.studentKey,
  'alan karşılaştırması',
);

/* Gerçek depo turu: bozuk JSON yazılıp uygulamanın kendi okuma fonksiyonu çağrılır. */
const RECORDS_KEY = 'lgs-okul-kayitlari-v1';
const legacyPayload = {
  version: 1,
  goals: {},
  homework: [
    {
      id: 'legacy-1',
      studentKey: 'elif-yilmaz',
      studentName: 'Elif Yılmaz',
      title: 'Eski ödev (bozuk durum)',
      assignedAt: ASSIGNED_AT,
      status: 'dikkat',
    },
    {
      id: 'legacy-2',
      studentKey: 'elif-yilmaz',
      studentName: 'Elif Yılmaz',
      title: 'Görüşsüz kapatılmış eski ödev',
      assignedAt: ASSIGNED_AT,
      status: 'yapildi',
    },
  ],
  notes: [
    {
      id: 'note-1',
      studentKey: 'elif-yilmaz',
      studentName: 'Elif Yılmaz',
      date: ASSIGNED_AT,
      note: 'Görüşme metni korunmalı',
      mood: 'kaygili',
    },
    {
      id: 'note-2',
      studentKey: 'elif-yilmaz',
      studentName: 'Elif Yılmaz',
      date: ASSIGNED_AT,
      note: 'Geçerli ruh hâli',
      mood: 'dikkat',
    },
  ],
};

let legacyLoaded: SchoolRecords | null = null;
let legacyError = '';
try {
  localStorage.setItem(RECORDS_KEY, JSON.stringify(legacyPayload));
  legacyLoaded = loadRecords();
} catch (error) {
  legacyError = error instanceof Error ? error.message : String(error);
}

check(
  'bozuk yerel kayıt okunurken istisna atmıyor (ekran açılabiliyor)',
  legacyError === '' && legacyLoaded !== null,
  legacyError || 'kayıt okunamadı',
);

check(
  'okunan kayıtta bütün ödev durumları geçerli (meta tablosu güvenle okunur)',
  !!legacyLoaded &&
    legacyLoaded.homework.length === 2 &&
    legacyLoaded.homework.every((item) => isHomeworkStatus(item.status)),
  JSON.stringify(legacyLoaded?.homework.map((item) => item.status) ?? []),
);

check(
  'görüşsüz kapatılmış eski ödev "devam ediyor"a çekiliyor',
  legacyLoaded?.homework.find((item) => item.id === 'legacy-2')?.status === 'yapiliyor',
  String(legacyLoaded?.homework.find((item) => item.id === 'legacy-2')?.status),
);

check(
  'geçersiz ruh hâli ayıklanıyor, görüşme notu ve geçerli ruh hâli korunuyor',
  !!legacyLoaded &&
    legacyLoaded.notes.length === 2 &&
    legacyLoaded.notes.find((note) => note.id === 'note-1')?.mood === undefined &&
    legacyLoaded.notes.find((note) => note.id === 'note-1')?.note === 'Görüşme metni korunmalı' &&
    legacyLoaded.notes.find((note) => note.id === 'note-2')?.mood === 'dikkat',
  JSON.stringify(legacyLoaded?.notes.map((note) => note.mood) ?? []),
);

/* -------------------------------------------------------------------------- */
/* Sonuç                                                                       */
/* -------------------------------------------------------------------------- */

console.log(`\n${'-'.repeat(64)}`);
console.log(`ÖDEV AKIŞI KANITI: ${passed}/${passed + failures.length} OK`);
if (failures.length) {
  console.log(`\nBaşarısız iddialar (${failures.length}):`);
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exitCode = 1;
} else {
  console.log('Sınıfa toplu atama, görüş zorunluluğu ve rol yetkileri doğrulandı.');
}
