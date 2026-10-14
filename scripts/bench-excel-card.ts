/**
 * Excel'den üretilen sınav karnesinin kanıtı.
 *
 * Neden bu betik gerekli
 * ----------------------
 * Analiz ekranına yüklenen Excel dosyalarında (ders netleri sıralı listesi ve
 * birleştirilmiş konu karnesi) soru numarası, işaretlenen şık ve cevap anahtarı
 * HİÇ bulunmaz; buna karşılık dosya ders ve konu düzeyinde gerçek kırılım taşır.
 * Karne bu kırılımdan üretilir. Üretilmediğinde ekran boş kalır ve kullanıcı
 * "Excel'den karne oluşmuyor" der — bu, veri eksikliği değil koddaki bir kopukluk
 * olduğu hâlde ekranda ikisi ayırt edilemez.
 *
 * Bu yüzden iddialar TAKLİT veriyle değil, kullanıcının gerçekten yüklediği iki
 * Excel dosyasıyla ve uygulamanın gerçek fonksiyonlarıyla ölçülür:
 *   `parseWorkbook` → `mergeExams` → `unifyPartialExamsWithGroups` → `buildReportCard`
 * Sahte veri kullanılsaydı ölçüm uygulamayı değil betiği doğrulardı.
 *
 * Olumlu iddiaların karşıtı da sınanır: iki dosyanın tek denemede birleşmesi,
 * sıralı listenin tek başına da karne üretmesi, konu kırılımı yokken yüzdenin
 * UYDURULMAMASI, birleşik analizde karne üretilmemesi ve soru numarasının hiç
 * üretilmemesi.
 *
 * Çalıştırma:
 *   BENCH_ENTRY=scripts/bench-excel-card.ts pnpm exec vite build --config vite.bench.config.ts
 *   node .bench/bench.mjs
 *
 * Excel klasörü varsayılanı `<proje>/../../uploads`; başka bir klasör için
 * `EXCEL_DIR=/tam/yol node .bench/bench.mjs`.
 */
/*
  DİKKAT: shim importu EN ÜSTTE olmalıdır. Uygulama modülleri `window`/`localStorage`
  bekler; ESM içe aktarmaları sırayla değerlendirildiği için shim ilk sırada olmazsa
  Node "window is not defined" ile düşer.
*/
import './node-shim';

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { emptySetup } from '@/lib/examSetup';
import { buildReportCard } from '@/lib/questionReportCard';
import { parseWorkbook } from '@/lib/parse';
import { mergeExams, unifyPartialExamsWithGroups } from '@/lib/store';
import { studentKeyOf } from '@/lib/text';
import type { ExamRecord } from '@/lib/types';

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

/** Türkçe karakter duyarsız dosya adı karşılaştırması (klasör taraması için). */
const norm = (value: string): string => value.toLocaleLowerCase('tr');

/* ------------------------------------------------------------------ */
/* Gerçek dosyalar                                                     */
/* ------------------------------------------------------------------ */

const uploadDir = process.env.EXCEL_DIR ?? path.resolve(process.cwd(), '../../uploads');

let entries: string[];
try {
  entries = readdirSync(uploadDir);
} catch {
  throw new Error(
    `Excel klasörü okunamadı: ${uploadDir}. EXCEL_DIR ile gerçek klasörü verin.`,
  );
}

const xlsx = entries.filter((name) => name.toLocaleLowerCase('tr').endsWith('.xlsx'));
const rankingName = xlsx.find((name) => norm(name).includes('sirali liste'));
const karneName = xlsx.find((name) => norm(name).includes('birlestirilmis'));

if (!rankingName || !karneName) {
  throw new Error(
    [
      'Gerekli Excel dosyaları bulunamadı.',
      `Klasör: ${uploadDir}`,
      'Beklenenler: adında "Sirali Liste" ve adında "Birlestirilmis" geçen .xlsx dosyaları.',
      `Bulunanlar: ${xlsx.length ? xlsx.join(' | ') : '(xlsx yok)'}`,
    ].join('\n'),
  );
}

/** `parseWorkbook` `ArrayBuffer` bekler; Node `Buffer`'ı bu aralıkla çevrilir. */
function toArrayBuffer(filePath: string): ArrayBuffer {
  const buffer = readFileSync(filePath);
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

const rankingPath = path.join(uploadDir, rankingName);
const karnePath = path.join(uploadDir, karneName);

console.log('Kanıt: analiz sekmesine yüklenen Excel dosyalarından sınav karnesi');
console.log(`  sıralı liste : ${rankingName}`);
console.log(`  konu karnesi : ${karneName}`);
console.log('');

const parsedRanking = parseWorkbook(toArrayBuffer(rankingPath), rankingName);
const parsedKarne = parseWorkbook(toArrayBuffer(karnePath), karneName);

/* ------------------------------------------------------------------ */
/* 1) Ayrıştırma                                                       */
/* ------------------------------------------------------------------ */

console.log('— Ayrıştırma —');

const rankingExam = parsedRanking.exams[0];
const karneExam = parsedKarne.exams[0];

check(
  'Sıralı liste dosyası ders netleri dosyası olarak tanındı',
  parsedRanking.kind === 'ranking' && !!rankingExam,
  `kind=${parsedRanking.kind} sınav=${parsedRanking.exams.length}`,
);
check(
  'Birleştirilmiş karne dosyası konu karnesi olarak tanındı',
  parsedKarne.kind === 'karne' && !!karneExam,
  `kind=${parsedKarne.kind} sınav=${parsedKarne.exams.length}`,
);

const rankingStudents = rankingExam?.students ?? [];
const karneStudents = karneExam?.students ?? [];

check(
  'Sıralı listede ders netleri okundu',
  rankingStudents.length > 0 && rankingStudents.some((s) => s.subjects.length > 0),
  `öğrenci=${rankingStudents.length} dersi olan=${rankingStudents.filter((s) => s.subjects.length > 0).length}`,
);
check(
  'Konu karnesinde konu kırılımı okundu',
  karneStudents.length > 0 && karneStudents.some((s) => s.topics.length > 0),
  `öğrenci=${karneStudents.length} konusu olan=${karneStudents.filter((s) => s.topics.length > 0).length}`,
);

/* ------------------------------------------------------------------ */
/* 2) İki dosya tek denemede buluşuyor mu                              */
/* ------------------------------------------------------------------ */

console.log('\n— İki dosyanın birleşmesi —');

/* `mergeExams` kayıt dizisini doğrudan döndürür (`{ exams }` sarmalayıcısı yok). */
const merged = mergeExams([], [...parsedRanking.exams, ...parsedKarne.exams]);
const unified = unifyPartialExamsWithGroups(merged);

const unifiedExam: ExamRecord | undefined = unified.exams.find((exam) =>
  exam.students.some((s) => s.subjects.length > 0 && s.topics.length > 0),
);

check(
  'Sıralı liste ve konu karnesi tek denemede birleşti',
  unified.exams.length === 1 && !!unifiedExam,
  `deneme=${unified.exams.length} ikisini birlikte taşıyan kayıt=${unifiedExam ? 'var' : 'yok'}`,
);

const targetExam = unifiedExam ?? karneExam;
const targetStudent = targetExam?.students.find((s) => s.topics.length > 0);

if (!targetExam || !targetStudent) {
  throw new Error('Karne ölçümü için konu kırılımı olan öğrenci bulunamadı.');
}

const targetKey = studentKeyOf(targetStudent.name);
console.log(
  `  ölçülen öğrenci: ${targetStudent.name} · ders=${targetStudent.subjects.length} · konu=${targetStudent.topics.length}`,
);

/* ------------------------------------------------------------------ */
/* 3) Karne: kırılım yolu                                              */
/* ------------------------------------------------------------------ */

console.log('\n— Karne (Excel kırılımı) —');

const cardResult = buildReportCard({
  exam: targetExam,
  studentKey: targetKey,
  studentName: targetStudent.name,
  setup: emptySetup(),
  merged: false,
  sourceLabel: rankingName,
});

check(
  'Excel kaynaklı sınav için karne ÜRETİLDİ',
  cardResult.status === 'ok',
  `durum=${cardResult.status}`,
);

if (cardResult.status !== 'ok') {
  console.log(`\n${passed} OK / ${failures.length} FAIL`);
  process.exit(1);
}

const card = cardResult.card;

check(
  'Karne kaynağı "yüklenen dosya kırılımı" olarak işaretlendi',
  card.sourceKind === 'kirilim',
  `sourceKind=${card.sourceKind}`,
);
check(
  'Ders bazında sonuç satırları çizildi',
  card.subjects.length > 0,
  `ders satırı=${card.subjects.length}`,
);
check(
  'Soru numarası UYDURULMADI (Excel\'de soru düzeyi veri yok)',
  card.questions.length === 0,
  `soru satırı=${card.questions.length}`,
);
check(
  'Kaynak etiketi yüklenen dosya adından geldi',
  card.source === rankingName,
  `source=${card.source ?? '(boş)'}`,
);
check(
  'Özet doğru/yanlış sayıları ders satırlarıyla tutarlı',
  card.summary.correct === card.subjects.reduce((n, s) => n + s.correct, 0) &&
    card.summary.wrong === card.subjects.reduce((n, s) => n + s.wrong, 0),
  `özet=${card.summary.correct}/${card.summary.wrong} ders toplamı=${card.subjects.reduce((n, s) => n + s.correct, 0)}/${card.subjects.reduce((n, s) => n + s.wrong, 0)}`,
);

/* ------------------------------------------------------------------ */
/* 4) Konu kırılımı ve eksik konular                                   */
/* ------------------------------------------------------------------ */

console.log('\n— Konu kırılımı —');

check(
  'Konu bazında soru sonucu satırları doldu',
  card.topicRows.length > 0,
  `konu satırı=${card.topicRows.length}`,
);
check(
  'Konu satırlarında payda (soru sayısı) gerçek ve pozitif',
  card.topicRows.every((row) => row.questions > 0),
  `soru sayısı 0 olan satır=${card.topicRows.filter((r) => r.questions <= 0).length}`,
);
check(
  'Konu yüzdesi doğru/soru oranıyla hesaplandı (uydurma yüzde yok)',
  card.topicRows.every((row) => {
    const expected = Math.round((row.correct / row.questions) * 10000) / 100;
    return Math.abs(row.percent - expected) < 0.011;
  }),
  `sapan satır=${card.topicRows.filter((r) => Math.abs(r.percent - Math.round((r.correct / r.questions) * 10000) / 100) >= 0.011).length}`,
);
check(
  'Tam yapılan konu "tam yapılamayanlar" listesinde YOK (negatif)',
  card.gaps.every((gap) => {
    const row = card.topicRows.find((r) => r.subject === gap.subject && r.topic === gap.topic);
    return !!row && row.correct < row.questions;
  }),
  `listede tam yapılan konu=${card.gaps.filter((gap) => {
    const row = card.topicRows.find((r) => r.subject === gap.subject && r.topic === gap.topic);
    return !row || row.correct >= row.questions;
  }).length}`,
);
check(
  'Eksik konu satırlarında soru numarası listesi boş (numara uydurulmuyor)',
  card.gaps.every((gap) => gap.questionNos.length === 0),
  `numara taşıyan satır=${card.gaps.filter((g) => g.questionNos.length > 0).length}`,
);

/* ------------------------------------------------------------------ */
/* 5) Bilinmeyen bilgi "—" kalıyor                                     */
/* ------------------------------------------------------------------ */

console.log('\n— Bilinmeyen bilgi uydurulmuyor mu —');

const rankingOnly = buildReportCard({
  exam: rankingExam,
  studentKey: studentKeyOf(rankingStudents[0]?.name ?? ''),
  studentName: rankingStudents[0]?.name,
  setup: emptySetup(),
  merged: false,
});

check(
  'Yalnız ders netleri olan dosyada da karne üretildi',
  rankingOnly.status === 'ok',
  `durum=${rankingOnly.status}`,
);

if (rankingOnly.status === 'ok') {
  const only = rankingOnly.card;
  check(
    'Ders netleri dosyadan aynen alındı (net tanımlı)',
    only.subjects.every((s) => s.net !== undefined),
    `net tanımsız ders=${only.subjects.filter((s) => s.net === undefined).length}`,
  );
  check(
    'Konu kırılımı yokken yüzde UYDURULMADI ("—" gösterilir)',
    only.subjects.every((s) => s.percent === undefined),
    `yüzde uydurulan ders=${only.subjects.filter((s) => s.percent !== undefined).length}`,
  );
  check(
    'Konu kırılımı yokken soru satırı hiç çizilmedi',
    only.questions.length === 0 && only.topicRows.length === 0,
    `soru=${only.questions.length} konu=${only.topicRows.length}`,
  );
}

/* ------------------------------------------------------------------ */
/* 6) Boş durumlar (negatif)                                           */
/* ------------------------------------------------------------------ */

console.log('\n— Boş durumlar —');

check(
  'Sınav seçilmezse karne üretilmiyor',
  buildReportCard({ exam: undefined, studentKey: targetKey, setup: emptySetup() }).status ===
    'no-exam',
  'beklenen: no-exam',
);
check(
  'Öğrenci seçilmezse karne üretilmiyor',
  buildReportCard({ exam: targetExam, studentKey: '', setup: emptySetup() }).status ===
    'no-student',
  'beklenen: no-student',
);
check(
  'Karneye girmeyen öğrencide "bu denemede sonucu yok" teşhisi çıkıyor',
  buildReportCard({
    exam: targetExam,
    studentKey: 'bu ogrenci yok',
    studentName: 'Bu Ogrenci Yok',
    setup: emptySetup(),
  }).status === 'no-student-record',
  'beklenen: no-student-record (kurgu hatası DEĞİL)',
);
check(
  'Birleşik (çok denemeli) seçimde Excel karne üretilmiyor',
  buildReportCard({
    exam: targetExam,
    studentKey: targetKey,
    setup: emptySetup(),
    merged: true,
  }).status === 'merged',
  'beklenen: merged',
);

/* ------------------------------------------------------------------ */

console.log('');
console.log(`${passed} OK / ${failures.length} FAIL`);
if (failures.length) {
  console.log('');
  failures.forEach((f) => console.log(`  • ${f}`));
  process.exit(1);
}