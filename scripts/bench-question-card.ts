/**
 * Soru bazlı sınav karnesinin kanıtı.
 *
 * Neden bu betik gerekli
 * ----------------------
 * Karne, sınav kurgusundaki cevap anahtarı ile öğrencinin arşivlenmiş ham cevap
 * kâğıdından üretildiği için tek bir eşleşme hatası sessizdir: yanlış kâğıt
 * seçilse ekran dolu görünür, yanlış anahtar kullanılsa net "makul" bir sayı
 * çıkar. Bu yüzden iddialar gerçek uygulama fonksiyonuyla (`buildQuestionReportCard`)
 * ölçülür ve her olumlu iddianın karşıtı da sınanır:
 *   - doğru/yanlış/boş sınıflaması ve ceza katsayısı neti
 *   - boş sorunun net kaybı yaratmaması
 *   - anahtarı girilmemiş sorunun puanlanmaması ve karnede işaretlenmesi
 *   - toplam netin ders netleriyle birebir tutması (yuvarlama sapması olmaması)
 *   - başka öğrencinin kâğıdının gösterilmemesi (negatif)
 *   - doğru yapılan konunun eksik listesinde çıkmaması (negatif)
 *   - birleşik kayıtta ve kurgusuz denemede karne üretilmemesi (negatif)
 *   - iki kaynak da mevcutken arşiv yolunun kazanması (negatif: kırılım ezmemeli)
 *   - kırılım yolunda soru numarası UYDURULMAMASI ve sayıların dosyadan alınması
 *
 * Çalıştırma:
 *   BENCH_ENTRY=scripts/bench-question-card.ts pnpm exec vite build --config vite.bench.config.ts
 *   node .bench/bench.mjs
 */
/*
  DİKKAT: shim importu EN ÜSTTE olmalıdır. Uygulama modülleri `window`/`localStorage`
  bekler; ESM içe aktarmaları sırayla değerlendirildiği için shim ilk sırada olmazsa
  Node "window is not defined" ile düşer.
*/
import './node-shim';

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { emptySetup, type ExamAnswerSheet, type ExamBlueprint } from '@/lib/examSetup';
import { buildQuestionReportCard, buildReportCard } from '@/lib/questionReportCard';
import { examKeyOf, studentKeyOf } from '@/lib/text';
import type { ExamRecord, TopicStat } from '@/lib/types';

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

const sheetOf = (
  id: string,
  name: string,
  answers: string[],
  className = '8-A',
  studentNo = '810',
): ExamAnswerSheet => ({
  id,
  name,
  className,
  studentNo,
  answers,
  source: 'optik-sonuc.txt',
  updatedAt: '2026-05-01T09:00:00.000Z',
});

/**
 * 6 soruluk sınav: Türkçe 1-3, Matematik 4-6.
 * 5. sorunun cevap anahtarı bilinçli olarak girilmemiştir.
 * Ayşe: 1 doğru, 2 yanlış, 3 doğru, 4 yanlış, 5 işaretli (anahtarsız), 6 boş.
 */
function buildBlueprint(): ExamBlueprint {
  return {
    id: 'kurgu-1',
    name: '8. Sınıf Deneme 3',
    section: 'LGS',
    className: '8-A',
    date: '2026-05-01',
    penalty: 3,
    scaleMin: 100,
    scaleMax: 500,
    subjects: [
      { subject: 'Türkçe', questions: 3, coefficient: 1 },
      { subject: 'Matematik', questions: 3, coefficient: 2 },
    ],
    questions: [
      { no: 1, subject: 'Türkçe', topics: ['Sözcükte Anlam'], answer: 'A' },
      { no: 2, subject: 'Türkçe', topics: ['Cümlede Anlam'], answer: 'B' },
      { no: 3, subject: 'Türkçe', topics: ['Paragraf', 'Anlatım Biçimleri'], answer: 'C' },
      { no: 4, subject: 'Matematik', topics: ['Oran ve Orantı'], answer: 'D' },
      { no: 5, subject: 'Matematik', topics: ['Cebirsel İfadeler'], answer: '' },
      { no: 6, subject: 'Matematik', topics: ['Veri Analizi'], answer: 'E' },
    ],
    sheets: [
      sheetOf('k1', 'Ayşe Yılmaz', ['A', 'C', 'C', 'A', 'B', '']),
      sheetOf('k2', 'Burak Demir', ['A', 'B', 'C', 'D', 'E', 'E']),
      sheetOf('k3', 'Ceren Ak', ['B', 'C', 'A', 'C', 'A', 'D']),
    ],
    results: [
      { fileName: 'optik-sonuc.txt', uploadedAt: '2026-05-01T09:00:00.000Z', studentCount: 3 },
    ],
    updatedAt: '2026-05-01T09:00:00.000Z',
  };
}

/** Analiz kaydı: puan/ sıralama alanları kasıtlı olarak boş bırakılır. */
function buildExam(blueprint: ExamBlueprint, withScore = false): ExamRecord {
  return {
    key: '8-sinif-deneme-3',
    name: blueprint.name,
    date: blueprint.date,
    order: 1,
    section: blueprint.section,
    students: blueprint.sheets.map((sheet, index) => ({
      name: sheet.name,
      className: sheet.className,
      studentNo: sheet.studentNo,
      subjects: [],
      ...(withScore
        ? { lgsScore: 300 + index * 10, generalRank: index + 1, classRank: index + 1 }
        : {}),
      topics: [],
      kazanims: [],
    })),
  };
}

const setup = { ...emptySetup(), blueprints: [buildBlueprint()] };
const exam = buildExam(setup.blueprints[0]);
const ayse = studentKeyOf('Ayşe Yılmaz');

const ayseResult = buildQuestionReportCard({
  exam,
  studentKey: ayse,
  studentName: 'Ayşe Yılmaz',
  setup,
});
const ayseCard = ayseResult.status === 'ok' ? ayseResult.card : undefined;

/* ------------------------------------------------------------------ */
/* İddialar                                                            */
/* ------------------------------------------------------------------ */

console.log('\n— Karne üretimi —');
check(
  'Ayşe için soru bazlı karne üretiliyor',
  ayseResult.status === 'ok' && Boolean(ayseCard),
  `beklenen ok, gelen ${ayseResult.status}`,
);
check(
  'Öğrenci adı ve sınıfı kâğıttan geliyor',
  ayseCard?.studentName === 'Ayşe Yılmaz' && ayseCard?.className === '8-A',
  `gelen ${ayseCard?.studentName} / ${ayseCard?.className}`,
);
check(
  'Kâğıdın kaynağı karnede görünüyor',
  ayseCard?.source === 'optik-sonuc.txt',
  `gelen ${ayseCard?.source}`,
);

console.log('\n— Soru sınıflaması —');
const byNo = new Map((ayseCard?.questions ?? []).map((q) => [q.no, q]));
check(
  'Doğru işaretlenen soru doğru sayılıyor (1. ve 3. soru)',
  byNo.get(1)?.outcome === 'dogru' && byNo.get(3)?.outcome === 'dogru',
  `gelen ${byNo.get(1)?.outcome} / ${byNo.get(3)?.outcome}`,
);
check(
  'Yanlış işaretlenen soru yanlış sayılıyor (2. ve 4. soru)',
  byNo.get(2)?.outcome === 'yanlis' && byNo.get(4)?.outcome === 'yanlis',
  `gelen ${byNo.get(2)?.outcome} / ${byNo.get(4)?.outcome}`,
);
check(
  'Boş bırakılan soru boş sayılıyor (6. soru)',
  byNo.get(6)?.outcome === 'bos' && byNo.get(6)?.given === '',
  `gelen ${byNo.get(6)?.outcome} / "${byNo.get(6)?.given}"`,
);
check(
  'Cevap anahtarı girilmemiş soru puanlanmıyor (5. soru)',
  byNo.get(5)?.outcome === 'anahtar-yok' && byNo.get(5)?.answer === '',
  `gelen ${byNo.get(5)?.outcome} / "${byNo.get(5)?.answer}"`,
);
check(
  'Öğrencinin işareti doğru cevapla birlikte gösteriliyor',
  byNo.get(2)?.given === 'C' && byNo.get(2)?.answer === 'B',
  `gelen işaret ${byNo.get(2)?.given}, anahtar ${byNo.get(2)?.answer}`,
);

console.log('\n— Net ve ceza katsayısı —');
check(
  'Türkçe neti doğru − yanlış/3 formülüyle hesaplanıyor (2 − 1/3)',
  ayseCard?.subjects.find((s) => s.subject === 'Türkçe')?.net === 1.67,
  `gelen ${ayseCard?.subjects.find((s) => s.subject === 'Türkçe')?.net}`,
);
check(
  'Matematik neti boş ve anahtarsız soru yüzünden düşmüyor (0 doğru, 1 yanlış)',
  ayseCard?.subjects.find((s) => s.subject === 'Matematik')?.net === -0.33,
  `gelen ${ayseCard?.subjects.find((s) => s.subject === 'Matematik')?.net}`,
);
check(
  'Toplam net ders netleri toplamına birebir eşit',
  ayseCard?.summary.net === 1.34,
  `gelen ${ayseCard?.summary.net}`,
);
check(
  'Ders neti yuvarlanmış soru katkıları toplamından değil, ders bazlı formülden geliyor',
  (() => {
    // 3 yanlış, 0 doğru: ders neti = 0 − 3/3 = −1,00
    // Yuvarlanmış soru katkılarının toplamı ise −0,33 × 3 = −0,99 olurdu.
    const bp = buildBlueprint();
    bp.sheets = [...bp.sheets, sheetOf('k4', 'Ece Kara', ['B', 'C', 'A', 'D', '', 'E'])];
    const local = { ...emptySetup(), blueprints: [bp] };
    const extra: ExamRecord = {
      ...exam,
      students: [
        ...exam.students,
        { name: 'Ece Kara', className: '8-A', subjects: [], topics: [], kazanims: [] },
      ],
    };
    const result = buildQuestionReportCard({
      exam: extra,
      studentKey: studentKeyOf('Ece Kara'),
      setup: local,
    });
    if (result.status !== 'ok') return false;
    const turkce = result.card.subjects.find((s) => s.subject === 'Türkçe');
    // Yuvarlanmış katkı toplamı yalnızca Türkçe soruları üzerinden alınır;
    // toplam alınırsa diğer derslerin doğruları farkı maskeler.
    const roundedSum =
      Math.round(
        (result.card.questions
          .filter((q) => q.subject === 'Türkçe')
          .reduce((n, q) => n + q.net, 0) +
          Number.EPSILON) *
          100,
      ) / 100;
    return turkce?.net === -1 && roundedSum === -0.99;
  })(),
  'yuvarlanmış soru katkısı toplamı ders neti yerine kullanılmış olabilir',
);
check(
  'Yanlışların götürdüğü net miktarı bildiriliyor (2 / 3)',
  ayseCard?.summary.penaltyLost === 0.67,
  `gelen ${ayseCard?.summary.penaltyLost}`,
);

console.log('\n— Sayım ve oranlar —');
check(
  'Doğru/yanlış/boş sayıları tutarlı (2 / 2 / 1)',
  ayseCard?.summary.correct === 2 &&
    ayseCard?.summary.wrong === 2 &&
    ayseCard?.summary.blank === 1,
  `gelen ${ayseCard?.summary.correct}/${ayseCard?.summary.wrong}/${ayseCard?.summary.blank}`,
);
check(
  'Puanlanan soru sayısı anahtarsız soruyu dışarıda bırakıyor (5)',
  ayseCard?.summary.scored === 5 && ayseCard?.summary.listed === 6,
  `gelen puanlanan ${ayseCard?.summary.scored}, listelenen ${ayseCard?.summary.listed}`,
);
check(
  'Anahtarsız soru sayısı kullanıcıya bildiriliyor (1)',
  ayseCard?.summary.missingKeys === 1,
  `gelen ${ayseCard?.summary.missingKeys}`,
);
check(
  'Başarı yüzdesi doğru/puanlanan soru olarak hesaplanıyor (2/5 = %40)',
  ayseCard?.summary.percent === 40,
  `gelen ${ayseCard?.summary.percent}`,
);
check(
  'Ders ağırlığı katsayıya göre dağılıyor (Matematik %67)',
  ayseCard?.subjects.find((s) => s.subject === 'Matematik')?.weight === 66.67,
  `gelen ${ayseCard?.subjects.find((s) => s.subject === 'Matematik')?.weight}`,
);

console.log('\n— Konu bazlı eksikler —');
const gapKeys = new Set((ayseCard?.gaps ?? []).map((g) => `${g.subject}||${g.topic}`));
check(
  'Yanlış yapılan konular eksik listesinde',
  gapKeys.has('Türkçe||Cümlede Anlam') && gapKeys.has('Matematik||Oran ve Orantı'),
  `gelen ${[...gapKeys].join(' | ')}`,
);
check(
  'Boş bırakılan sorunun konusu da eksik listesinde',
  gapKeys.has('Matematik||Veri Analizi'),
  `gelen ${[...gapKeys].join(' | ')}`,
);
check(
  'NEGATİF: doğru yapılan konu eksik listesinde yok',
  !gapKeys.has('Türkçe||Sözcükte Anlam'),
  'doğru yapılan konu eksik olarak listelendi',
);
check(
  'NEGATİF: anahtar girilmemiş sorunun konusu eksik sayılmıyor',
  !gapKeys.has('Matematik||Cebirsel İfadeler'),
  'anahtarsız soru eksik konu olarak listelendi',
);
check(
  'Çoklu konulu soru her konusuna işleniyor',
  gapKeys.has('Türkçe||Paragraf') === false &&
    (ayseCard?.subjects.find((s) => s.subject === 'Türkçe')?.correct ?? 0) === 2,
  'çoklu konu işlemesi ders sayımını bozdu',
);
check(
  'Eksik satırında soru numaraları veriliyor',
  (ayseCard?.gaps.find((g) => g.topic === 'Cümlede Anlam')?.questionNos ?? []).join(',') === '2',
  `gelen ${(ayseCard?.gaps.find((g) => g.topic === 'Cümlede Anlam')?.questionNos ?? []).join(',')}`,
);

console.log('\n— Kâğıt eşleşmesi —');
const burak = buildQuestionReportCard({
  exam,
  studentKey: studentKeyOf('Burak Demir'),
  setup,
});
const burakCard = burak.status === 'ok' ? burak.card : undefined;
check(
  'Başka öğrenci için kendi kâğıdı kullanılıyor (tam doğru)',
  burakCard?.summary.correct === 5 && burakCard?.summary.wrong === 0,
  `gelen doğru ${burakCard?.summary.correct}, yanlış ${burakCard?.summary.wrong}`,
);
check(
  'NEGATİF: Ayşe ile Burak karışmıyor',
  burakCard?.studentName === 'Burak Demir' && burakCard?.summary.net !== ayseCard?.summary.net,
  `gelen ${burakCard?.studentName} net ${burakCard?.summary.net}`,
);
check(
  'NEGATİF: arşivde kâğıdı olmayan öğrenciye karne üretilmiyor',
  buildQuestionReportCard({
    exam,
    studentKey: studentKeyOf('Deniz Yok'),
    setup,
  }).status === 'no-sheet',
  'olmayan öğrenci için karne üretildi',
);
check(
  'Öğrenci anahtarı verilmezse karne üretilmiyor',
  buildQuestionReportCard({ exam, setup }).status === 'no-student',
  'öğrenci seçilmeden karne üretildi',
);
check(
  'Türkçe karakter duyarsız eşleşme çalışıyor ("Ayse Yilmaz" ↔ "Ayşe Yılmaz")',
  buildQuestionReportCard({ exam, studentKey: studentKeyOf('Ayse Yilmaz'), setup }).status === 'ok',
  'aksanlı/aksansız ad eşleşmedi',
);
check(
  'Aynı ad iki kâğıtta varsa en dolu kâğıt seçiliyor',
  (() => {
    const bp = buildBlueprint();
    bp.sheets = [
      sheetOf('bos', 'Ayşe Yılmaz', ['', '', '', '', '', '']),
      sheetOf('dolu', 'Ayşe Yılmaz', ['A', 'C', 'C', 'A', 'B', '']),
    ];
    const local = { ...emptySetup(), blueprints: [bp] };
    const result = buildQuestionReportCard({ exam, studentKey: ayse, setup: local });
    return result.status === 'ok' && result.card.summary.correct === 2;
  })(),
  'boş kâğıt seçildi',
);

console.log('\n— Kurgu eşleşmesi —');
check(
  'Mod kimliği ile eşleşme: ad değişse bile kurgu bulunuyor',
  (() => {
    const bp = { ...buildBlueprint(), name: 'Kurum Denemesi 1', presetId: 'lgs' };
    const local = { ...emptySetup(), blueprints: [bp] };
    const renamed: ExamRecord = { ...exam, name: 'Deneme 3', presetId: 'lgs' };
    return (
      buildQuestionReportCard({ exam: renamed, studentKey: ayse, setup: local }).status === 'ok'
    );
  })(),
  'mod kimliği eşleşmedi',
);
/*
  "U denemesi" kusurunun kök kanıtı: kurgunun adı ile sonuç kaydının adı
  farklılaştığında (biri "U denemesi Kurgusu", diğeri "U denemesi 1") ad
  üzerinden eşleşme tutmaz. Kurgu kimliği kayda yazıldığı için eşleşme artık
  ad değişiminden hiç etkilenmemeli; ad, kayıt anahtarı ve kimlik yollarının
  hepsi ayrı ayrı ölçülür ki biri diğerinin yerine geçip hatayı gizlemesin.
*/
check(
  'Kalıcı kurgu kimliği ile eşleşme: ad ve anahtar tamamen farklı olsa da kurgu bulunuyor',
  (() => {
    const bp = { ...buildBlueprint(), id: 'kurgu-u', name: 'U denemesi Kurgusu', presetId: undefined };
    const local = { ...emptySetup(), blueprints: [bp] };
    const renamed: ExamRecord = {
      ...exam,
      name: 'U denemesi 1',
      key: 'u-denemesi-1',
      presetId: undefined,
      blueprintId: 'kurgu-u',
    };
    const result = buildQuestionReportCard({ exam: renamed, studentKey: ayse, setup: local });
    return result.status === 'ok' && result.card.questions.length === 6;
  })(),
  'kurgu kimliği eşleşmedi',
);
check(
  'Kayıt anahtarı ile eşleşme: kaydın görünen adı düzenlense de kurgu bulunuyor',
  (() => {
    const bp = { ...buildBlueprint(), id: 'kurgu-y', name: 'U denemesi Kurgusu', presetId: undefined };
    const local = { ...emptySetup(), blueprints: [bp] };
    const renamed: ExamRecord = {
      ...exam,
      name: 'U Denemesi 1',
      key: examKeyOf(bp.name),
      presetId: undefined,
      blueprintId: undefined,
    };
    return (
      buildQuestionReportCard({ exam: renamed, studentKey: ayse, setup: local }).status === 'ok'
    );
  })(),
  'kayıt anahtarı eşleşmedi',
);
check(
  'NEGATİF: üç ölçüt de tutmuyorsa kurgu bulunmuş sayılmıyor (sessiz yanlış eşleşme yok)',
  (() => {
    const bp = { ...buildBlueprint(), id: 'kurgu-z', name: 'U denemesi Kurgusu', presetId: undefined };
    const local = { ...emptySetup(), blueprints: [bp] };
    const other: ExamRecord = {
      ...exam,
      name: 'U denemesi 1',
      key: 'u-denemesi-1',
      presetId: undefined,
      blueprintId: 'baska-kurgu',
    };
    return (
      buildQuestionReportCard({ exam: other, studentKey: ayse, setup: local }).status ===
      'no-blueprint'
    );
  })(),
  'ilgisiz kurgu eşleşti',
);
check(
  'NEGATİF: kurgu yoksa karne üretilmiyor',
  buildQuestionReportCard({ exam, studentKey: ayse, setup: emptySetup() }).status === 'no-blueprint',
  'kurgusuz denemede karne üretildi',
);
check(
  'NEGATİF: birleşik kayıtta karne üretilmiyor',
  buildQuestionReportCard({ exam, studentKey: ayse, setup, merged: true }).status === 'merged',
  'birleşik kayıtta yanlış sınavla eşleşebilecek karne üretildi',
);
check(
  'NEGATİF: deneme seçilmezse karne üretilmiyor',
  buildQuestionReportCard({ studentKey: ayse, setup }).status === 'no-exam',
  'deneme yokken karne üretildi',
);

console.log('\n— Sınav puanı —');
check(
  'Kayıtta puan varsa o kullanılıyor (300)',
  (() => {
    const scored = buildExam(setup.blueprints[0], true);
    const result = buildQuestionReportCard({ exam: scored, studentKey: ayse, setup });
    return result.status === 'ok' && result.card.summary.score === 300;
  })(),
  'kayıttaki puan kullanılmadı',
);
check(
  'Puan yoksa arşivden hesaplanıyor ve ölçek aralığında kalıyor',
  (() => {
    if (ayseCard?.summary.score === undefined) return false;
    return ayseCard.summary.score >= 100 && ayseCard.summary.score <= 500;
  })(),
  `gelen puan ${ayseCard?.summary.score}`,
);
check(
  'Tek kâğıtlı grupta uydurma puan üretilmiyor',
  (() => {
    const bp = buildBlueprint();
    bp.sheets = [sheetOf('tek', 'Ayşe Yılmaz', ['A', 'C', 'C', 'A', 'B', ''])];
    const local = { ...emptySetup(), blueprints: [bp] };
    const single: ExamRecord = { ...exam, students: [{ ...exam.students[0] }] };
    const result = buildQuestionReportCard({ exam: single, studentKey: ayse, setup: local });
    return result.status === 'ok' && result.card.summary.score === undefined;
  })(),
  'tek kişilik grupta standart sapma 0 olduğu hâlde puan üretildi',
);

console.log('\n— Yazdırma güvenliği —');
check(
  'Ceza katsayısı 0 olduğunda yanlış götürmüyor',
  (() => {
    const bp = { ...buildBlueprint(), penalty: 0 };
    const local = { ...emptySetup(), blueprints: [bp] };
    const result = buildQuestionReportCard({ exam, studentKey: ayse, setup: local });
    return (
      result.status === 'ok' &&
      result.card.summary.net === 2 &&
      result.card.summary.penaltyLost === 0
    );
  })(),
  'cezasız sınavda yanlış götürdü',
);
check(
  'NEGATİF: soru katkısı yanlış için negatif, doğru için +1',
  byNo.get(1)?.net === 1 && byNo.get(2)?.net === -0.33 && byNo.get(6)?.net === 0,
  `gelen ${byNo.get(1)?.net} / ${byNo.get(2)?.net} / ${byNo.get(6)?.net}`,
);
check(
  'Karnedeki soru sayısı kurgudaki soru sayısına eşit',
  ayseCard?.questions.length === setup.blueprints[0].questions.length,
  `gelen ${ayseCard?.questions.length}`,
);

/* ------------------------------------------------------------------ */
/* Kırılım yolu — veri işlemlerinden (Excel/elle) eklenen sınav        */
/* ------------------------------------------------------------------ */

/**
 * Dosya kaynaklı sınav: ham cevap kâğıdı arşivi YOKTUR, yalnızca ders ve konu
 * kırılımı vardır. Karne bu durumda soru numarası üretmemeli ve soru sayısının
 * bilinmediği yerlerde "0" yazmamalıdır.
 */
const topic = (
  subject: string,
  name: string,
  questions: number,
  correct: number,
  wrong: number,
  blank: number,
): TopicStat => ({ subject, group: '', topic: name, questions, correct, wrong, blank });

function buildFileExam(): ExamRecord {
  return {
    key: 'dosya-denemesi-1',
    name: 'Dosya Denemesi 1',
    date: '2026-05-08',
    order: 2,
    section: 'LGS',
    students: [
      {
        name: 'Ayşe Yılmaz',
        className: '8-A',
        studentNo: '810',
        subjects: [
          { subject: 'Türkçe', correct: 3, wrong: 1, net: 2.67 },
          { subject: 'Matematik', correct: 4, wrong: 2, net: 3.33 },
        ],
        totalNet: 6,
        lgsScore: 320,
        generalRank: 5,
        classRank: 2,
        topics: [
          topic('Türkçe', 'Sözcükte Anlam', 3, 2, 1, 0),
          topic('Türkçe', 'Cümlede Anlam', 4, 1, 1, 2),
          topic('Matematik', 'Oran ve Orantı', 4, 4, 0, 0),
          topic('Matematik', 'Veri Analizi', 2, 0, 2, 0),
        ],
        kazanims: [],
      },
    ],
  };
}

/** Konu kırılımı bile olmayan sınav (yalnızca ders satırları). */
const buildSubjectOnlyExam = (): ExamRecord => {
  const base = buildFileExam();
  return {
    ...base,
    students: [{ ...base.students[0], topics: [], totalNet: undefined, lgsScore: undefined }],
  };
};

const fileExam = buildFileExam();
/** Kurgu var (ceza katsayısı biliniyor) ama o sınavın ham kâğıdı yok. */
const fileBreakdown = buildReportCard({
  exam: fileExam,
  studentKey: ayse,
  setup,
  sourceLabel: 'deneme-sonuclari.xlsx',
});
const fileCard = fileBreakdown.status === 'ok' ? fileBreakdown.card : undefined;

/** Hiç kurgu yokken de karne üretilebilmeli (kırılım yolu kurguya bağlı değil). */
const noSetupBreakdown = buildReportCard({
  exam: fileExam,
  studentKey: ayse,
  setup: emptySetup(),
  sourceLabel: 'deneme-sonuclari.xlsx',
});
const noSetupCard = noSetupBreakdown.status === 'ok' ? noSetupBreakdown.card : undefined;

console.log('\n— Kırılım yolu —');
check(
  'Ham kâğıt arşivi olmayan sınavda karne kırılımdan üretiliyor',
  fileBreakdown.status === 'ok' && fileCard?.sourceKind === 'kirilim',
  `beklenen ok/kirilim, gelen ${fileBreakdown.status}/${fileCard?.sourceKind}`,
);
check(
  'NEGATİF: kırılım yolunda soru satırı hiç üretilmiyor',
  (fileCard?.questions.length ?? -1) === 0,
  `gelen ${fileCard?.questions.length} soru satırı`,
);
check(
  'NEGATİF: kırılım yolunda eksik konu satırında soru numarası uydurulmuyor',
  (fileCard?.gaps ?? []).every((g) => g.questionNos.length === 0),
  'soru numarası olmayan veri için numara üretildi',
);
check(
  'Eksik konu listesi "konu" türünde işaretleniyor',
  fileCard?.gapKind === 'konu',
  `gelen ${fileCard?.gapKind}`,
);
check(
  'Ders netleri dosyadan aynen alınıyor (Türkçe 2,67 / Matematik 3,33)',
  fileCard?.subjects.find((s) => s.subject === 'Türkçe')?.net === 2.67 &&
    fileCard?.subjects.find((s) => s.subject === 'Matematik')?.net === 3.33,
  `gelen ${fileCard?.subjects.map((s) => `${s.subject}:${s.net}`).join(' ')}`,
);
check(
  'Ders soru/doğru/yanlış sayıları konu kırılımından toplanıyor',
  fileCard?.subjects.find((s) => s.subject === 'Türkçe')?.questions === 7 &&
    fileCard?.subjects.find((s) => s.subject === 'Türkçe')?.correct === 3,
  `gelen ${fileCard?.subjects.find((s) => s.subject === 'Türkçe')?.questions} soru`,
);
check(
  'Konu satırları sayıları dosyadan aynen taşıyor (Cümlede Anlam 4/1/1/2)',
  (() => {
    const row = fileCard?.topicRows.find((t) => t.topic === 'Cümlede Anlam');
    return row?.questions === 4 && row?.correct === 1 && row?.wrong === 1 && row?.blank === 2;
  })(),
  'konu satırı sayıları dosyadan farklı aktarıldı',
);
check(
  'Tam yapılamayan konular listede: yanlış/boş olanlar var, tam doğru olan yok',
  (fileCard?.gaps ?? []).some((g) => g.topic === 'Cümlede Anlam') &&
    (fileCard?.gaps ?? []).some((g) => g.topic === 'Veri Analizi') &&
    !(fileCard?.gaps ?? []).some((g) => g.topic === 'Oran ve Orantı'),
  `gelen ${(fileCard?.gaps ?? []).map((g) => g.topic).join(' | ')}`,
);
check(
  'Kaynak etiketi yüklenen dosya adından geliyor',
  fileCard?.source === 'deneme-sonuclari.xlsx',
  `gelen ${fileCard?.source}`,
);
check(
  'Sınav puanı ve sıralaması dosyadan okunuyor (320 / genel 5)',
  fileCard?.summary.score === 320 && fileCard?.summary.generalRank === 5,
  `gelen ${fileCard?.summary.score} / ${fileCard?.summary.generalRank}`,
);
check(
  'Kurgu yokken de kırılım karnesi üretiliyor ve yüzde hesaplanıyor',
  noSetupBreakdown.status === 'ok' &&
    noSetupCard?.sourceKind === 'kirilim' &&
    noSetupCard?.summary.percent === 53.85,
  `gelen ${noSetupBreakdown.status} / %${noSetupCard?.summary.percent}`,
);
check(
  'NEGATİF: kurgu yokken net dosyadan/uydurmadan geliyor, ceza katsayısı iddia edilmiyor',
  noSetupCard?.summary.penalty === 0 &&
    noSetupCard?.subjects.find((s) => s.subject === 'Türkçe')?.net === 2.67,
  `gelen ceza ${noSetupCard?.summary.penalty}, Türkçe net ${noSetupCard?.subjects.find((s) => s.subject === 'Türkçe')?.net}`,
);
check(
  'Ders satırı var ama konu kırılımı yoksa yüzde/boş uydurulmuyor',
  (() => {
    const result = buildReportCard({
      exam: buildSubjectOnlyExam(),
      studentKey: ayse,
      setup,
      sourceLabel: 'deneme-sonuclari.xlsx',
    });
    if (result.status !== 'ok') return false;
    return result.card.summary.percent === undefined && result.card.summary.maxNet === undefined;
  })(),
  'payda bilinmediği hâlde yüzde üretildi',
);
check(
  'NEGATİF: iki kaynak da mevcutken arşiv yolu kazanıyor (kırılım ezmiyor)',
  (() => {
    // Kurgu ile eşleşen sınava AYRICA dosya kırılımı eklenir: aynı öğrenci hem
    // ham kâğıt arşivinde hem dosya kırılımında vardır. Arşiv kazanmalıdır,
    // çünkü yalnızca arşiv soru numarası ve cevap anahtarı verebilir.
    const both: ExamRecord = {
      ...exam,
      students: [
        {
          ...exam.students[0],
          subjects: [{ subject: 'Türkçe', correct: 1, wrong: 1, net: 0.67 }],
          totalNet: 0.67,
          topics: [topic('Türkçe', 'Sadece Dosyada Olan Konu', 2, 1, 1, 0)],
        },
      ],
    };
    const won = buildReportCard({
      exam: both,
      studentKey: ayse,
      setup,
      sourceLabel: 'deneme-sonuclari.xlsx',
    });
    return (
      won.status === 'ok' &&
      won.card.sourceKind === 'arsiv' &&
      won.card.questions.length > 0 &&
      won.card.topicRows.length === 0
    );
  })(),
  'kırılım yolu arşiv yolunu ezdi',
);
check(
  'NEGATİF: kırılım yolu da yoksa "veri yok" bilgisi veriliyor (kurgu hatası değil)',
  buildReportCard({
    exam: { ...buildFileExam(), students: [{ ...buildFileExam().students[0], subjects: [], topics: [] }] },
    studentKey: ayse,
    setup,
  }).status === 'no-data',
  'kırılım yokken arşiv hatası gösterildi',
);

/*
  Soru düzeyi dört sütunun (numara · işaretlenen · doğru cevap · sonuç) neden
  çizilemediği kullanıcıya taşınmalıdır. Taşınmazsa karne sessizce kırılıma
  düşer; ekran "bu sorunun sonucu yok" gibi okunur ve kullanıcı hem hiç soru
  dökümü olmadığını hem de nasıl tamamlayacağını anlamaz. Bu yüzden teşhis
  bilgisi üç ayrı durumda ayrı ayrı ölçülür.
*/
console.log('\n— Soru dökümü teşhisi (kırılım yolu) —');
/*
  Teşhis iddiaları gerçek eşleşme kurallarıyla kurulur: sınav kurgusu önce
  sadeleştirilmiş SINAV ADI, sonra hazır mod kimliğiyle bulunur. Adı kurgudan
  farklı bir dosya sınavı "kurgu bulunamadı" dalına düşer — bu yüzden kurgu
  bulan dal ayrı bir kayıtla ölçülür, yoksa iddia kendi kurulumuyla çelişir.
*/
const matchedName = '8. Sınıf Deneme 3';
/** Kurgu adıyla eşleşen ama arşivde kâğıdı OLMAYAN öğrencili dosya sınavı. */
const matchedNoSheetExam: ExamRecord = {
  ...buildFileExam(),
  name: matchedName,
  students: [{ ...buildFileExam().students[0], name: 'Zeynep Kaya' }],
};
const matchedNoSheet = buildReportCard({
  exam: matchedNoSheetExam,
  studentKey: studentKeyOf('Zeynep Kaya'),
  setup,
  sourceLabel: 'deneme-sonuclari.xlsx',
});

console.log('\n— Soru dökümü teşhisi (kırılım yolu) —');
check(
  'Kırılım yolu teşhisi taşınıyor: kurgu var, ham kâğıt arşivi var ama öğrencinin kâğıdı yok',
  matchedNoSheet.status === 'ok' &&
    matchedNoSheet.card.questionDetail?.blueprintFound === true &&
    matchedNoSheet.card.questionDetail?.sheetFound === false &&
    matchedNoSheet.card.questionDetail?.archivedSheets === 3,
  `gelen ${matchedNoSheet.status} / kurgu ${matchedNoSheet.status === 'ok' ? matchedNoSheet.card.questionDetail?.blueprintFound : '—'}, kâğıt ${matchedNoSheet.status === 'ok' ? matchedNoSheet.card.questionDetail?.sheetFound : '—'}, arşiv ${matchedNoSheet.status === 'ok' ? matchedNoSheet.card.questionDetail?.archivedSheets : '—'}`,
);
check(
  'NEGATİF: ham kâğıdı olmayan kurgu sıfır arşiv olarak bildiriliyor',
  (() => {
    const bp = { ...buildBlueprint(), sheets: [] };
    const local = { ...emptySetup(), blueprints: [bp] };
    const result = buildReportCard({
      exam: { ...buildFileExam(), name: matchedName },
      studentKey: ayse,
      setup: local,
    });
    return (
      result.status === 'ok' &&
      result.card.questionDetail?.archivedSheets === 0 &&
      result.card.questionDetail?.blueprintFound === true &&
      result.card.questionDetail?.sheetFound === false
    );
  })(),
  'boş arşiv bildirilmedi',
);
check(
  'Kurgu yokken teşhis "kurgu bulunamadı" diyor (yanlış teşhis yok)',
  noSetupCard?.questionDetail?.blueprintFound === false &&
    noSetupCard?.questionDetail?.archivedSheets === 0,
  `gelen kurgu ${noSetupCard?.questionDetail?.blueprintFound}`,
);
check(
  'NEGATİF: adı kurguyla eşleşmeyen dosya sınavı "kurgu bulunamadı" sayılıyor (sessiz eşleşme yok)',
  fileCard?.questionDetail?.blueprintFound === false &&
    fileCard?.questionDetail?.sheetFound === false,
  `gelen kurgu ${fileCard?.questionDetail?.blueprintFound}, kâğıt ${fileCard?.questionDetail?.sheetFound}`,
);
check(
  'NEGATİF: arşiv yolunda teşhis alanı hiç taşınmıyor (soru dökümü çiziliyor)',
  ayseCard?.questionDetail === undefined,
  'arşiv karnesinde gereksiz teşhis bölümü olurdu',
);

/* ------------------------------------------------------------------ */
/* Soru tablosu sütun sözleşmesi (görünürlük kanıtı)                   */
/* ------------------------------------------------------------------ */

/*
  Neden kaynak sözleşmesi okunuyor
  --------------------------------
  "Son sonucu göremiyorum" geri bildiriminin kök nedeni VERİ değil YERLEŞİMDİ:
  yedi sütunlu tablo dar kolonda sağa taşıyor ve en sağdaki Sonuç sütunu görüş
  alanının dışında kalıyordu. Bu kusur sessizdir — tablonun kendisi kırpılmış
  görünmediği için ekran "bu soruda sonuç yok" gibi okunur.

  Kusur saf hesaplama katmanında görünmez (satırlar doğru üretiliyordu), bu
  yüzden iddia yerleşim sözleşmesi üzerinden ölçülür: sütunların SAYISI, SIRASI,
  sabitlenen sütunun SON sütun olması ve her satırda sonuç etiketinin basılması.

  Kritik mekanik sınır: `position: sticky` yalnızca tablonun son sütununda doğru
  çalışır. Sabitlenen sütundan SONRA başka sütun kalırsa o sütun sticky katmanın
  altında kalır ve okunamaz hâle gelir; yani "Net, Sonuç'tan önce olmalı"
  iddiası dekoratif değil işlevseldir.
*/
const SHEET_PATH = path.resolve(process.cwd(), 'src/components/QuestionReportSheet.tsx');
let sheetSource = '';
try {
  sheetSource = readFileSync(SHEET_PATH, 'utf8');
} catch {
  sheetSource = '';
}

/** Soru tablosunun gövdesi: başlık ve satırlar bu aralıkta ölçülür. */
const tableSegment = (() => {
  const start = sheetSource.indexOf('min-w-[760px]');
  if (start < 0) return '';
  const end = sheetSource.indexOf('</table>', start);
  return end < 0 ? '' : sheetSource.slice(start, end);
})();

/*
  `<th(?!\w)` ile `<thead` dışarıda bırakılır: aksi hâlde tablo başlık satırının
  kendisi de hücre sayılır ve sütun sayısı sekize çıkarak iddia yanlış kırılırdı.
*/
const headerCells = [...tableSegment.matchAll(/<th(?![a-zA-Z])([^>]*)>([^<]*)<\/th>/g)].map((m) => ({
  attrs: m[1],
  label: m[2].trim(),
}));
const headerLabels = headerCells.map((c) => c.label);
const expectedLabels = ['Soru', 'Konu', 'Ders', 'İşaretlediği', 'Doğru', 'Net', 'Sonuç'];
const colCount = (tableSegment.match(/<col\b/g) ?? []).length;
const stickyRightCount = (sheetSource.match(/sticky right-0/g) ?? []).length;

/*
  Satır gövdesi ayrı `QuestionRow` bileşeninde tanımlıdır; `tableSegment` yalnızca
  tablo iskeletini (colgroup + başlık + map) kapsar. Sütun bağları bu yüzden satır
  bileşeninin kendi aralığında ölçülür — tablonun tamamında aramak, başlığın
  içerdiği metinle yanlış eşleşip iddiayı sahte yeşil yapardı.
*/
const rowSegment = (() => {
  const start = sheetSource.indexOf('function QuestionRow');
  const end = sheetSource.indexOf('function TopicOutcomeChips');
  return start < 0 || end < 0 ? '' : sheetSource.slice(start, end);
})();
/** Satır bileşenindeki hücre sayısı; başlık hücre sayısıyla eşleşmelidir. */
const rowCellCount = (rowSegment.match(/<td\b/g) ?? []).length;

/** Sonuç etiketini basan hücrenin sınıfı (satır gövdesi). */
const outcomeCellClass = (() => {
  const idx = sheetSource.lastIndexOf('meta.label');
  const open = sheetSource.lastIndexOf('<td className="', idx);
  if (open < 0) return '';
  const from = open + '<td className="'.length;
  return sheetSource.slice(from, sheetSource.indexOf('"', from));
})();

/** OUTCOME_META bloğu: dört sonuç hâlinin görsel karşılığı burada tanımlanır. */
const metaBlock = (() => {
  const start = sheetSource.indexOf('const OUTCOME_META');
  const end = sheetSource.indexOf('Sayı bilinmiyorsa');
  return start < 0 || end < 0 ? '' : sheetSource.slice(start, end);
})();

const outcomeKeys = ['dogru', 'yanlis', 'bos', "'anahtar-yok'"];
const usedOutcomes = [...new Set((ayseCard?.questions ?? []).map((q) => q.outcome))];
/** Satır gövdesindeki yedi sütunun veri kaynakları. */
const rowFieldRefs = [
  'row.no',
  'row.topics',
  'row.subject',
  'row.given',
  'row.answer',
  'signed(row.net)',
];
const missingRefs = rowFieldRefs.filter((ref) => !rowSegment.includes(ref));

console.log('\n— Soru tablosu sütun sözleşmesi (görünürlük) —');
check(
  'Karne bileşeni kaynağı okunabildi (yerleşim ölçülebilir)',
  sheetSource.length > 0,
  `${SHEET_PATH} okunamadı; yerleşim iddiaları ölçülemez`,
);
check(
  'Soru tablosu sabit sütun düzeninde (table-fixed)',
  tableSegment.includes('table-fixed'),
  'sabit düzen yok: uzun konu adı tabloyu sağa taşır',
);
check('Sütun sayısı 7 ve colgroup ile tanımlı', colCount === 7, `gelen ${colCount} col tanımı`);
check(
  'Sütun sırası: Soru · Konu · Ders · İşaretlediği · Doğru · Net · Sonuç',
  JSON.stringify(headerLabels) === JSON.stringify(expectedLabels),
  `gelen ${JSON.stringify(headerLabels)}`,
);
check(
  'Sonuç sütunu EN SONDA (sticky yalnızca son sütunda doğru çalışır)',
  headerLabels[headerLabels.length - 1] === 'Sonuç',
  `son sütun ${headerLabels[headerLabels.length - 1]}`,
);
check(
  'Sonuç sütun başlığı sağ kenara sabitlenmiş',
  (headerCells[headerCells.length - 1]?.attrs ?? '').includes('sticky'),
  'başlık sabit değil: kaydırırken hangi sütunun sonuç olduğu kaybolur',
);
check(
  'NEGATİF: başka sütun sabitlenmemiş (sticky katman başka sütunu gizlemiyor)',
  headerCells.slice(0, -1).every((c) => !c.attrs.includes('sticky')),
  `sabitlenen başlıklar: ${headerCells
    .filter((c) => c.attrs.includes('sticky'))
    .map((c) => c.label)
    .join(', ')}`,
);
check(
  'NEGATİF: dosyada "sticky right-0" yalnızca sonuç hücrelerinde (2)',
  stickyRightCount === 2,
  `gelen ${stickyRightCount}`,
);
check(
  'Satır gövdesindeki sonuç hücresi de sabit ve opak zeminde',
  outcomeCellClass.includes('sticky right-0') && outcomeCellClass.includes('bg-card'),
  `gelen sınıf "${outcomeCellClass}"`,
);
check(
  'Her satırda sonuç etiketi basılıyor (meta.label)',
  outcomeCellClass.length > 0,
  'sonuç hücresinde etiket metni yok',
);
check(
  'Sütunların veri kaynakları eksiksiz (7 sütun ↔ 7 bağ)',
  missingRefs.length === 0,
  `eksik bağlar: ${missingRefs.join(', ')}`,
);
check(
  'Başlık sütunu sayısı ile satır hücresi sayısı eşit',
  headerCells.length === rowCellCount && rowCellCount === 7,
  `gelen başlık ${headerCells.length}, hücre ${rowCellCount}`,
);
check(
  'Dört sonuç hâli de görsel karşılığa bağlı (Doğru/Yanlış/Boş/Anahtar yok)',
  outcomeKeys.every((k) => metaBlock.includes(`${k}:`)),
  `eksik hâller: ${outcomeKeys.filter((k) => !metaBlock.includes(`${k}:`)).join(', ')}`,
);
check(
  'Ölçülen karnede geçen her sonuç hâli karşılık buluyor (boş çip yok)',
  usedOutcomes.length > 0 &&
    usedOutcomes.every((o) => metaBlock.includes(o === 'anahtar-yok' ? "'anahtar-yok':" : `${o}:`)),
  `geçen hâller ${usedOutcomes.join(', ')}`,
);

/* ------------------------------------------------------------------ */
/* Sonuç                                                               */
/* ------------------------------------------------------------------ */

console.log(`\n${passed}/${passed + failures.length} iddia geçti.`);
if (failures.length) {
  console.log('\nBaşarısız iddialar:');
  failures.forEach((f) => console.log(` - ${f}`));
  process.exitCode = 1;
}