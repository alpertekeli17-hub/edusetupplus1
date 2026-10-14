/**
 * TAM YÜK ölçümü: birleşik analiz kullanılmadan, 200 sınavın 1000 öğrencilik
 * tüm verisi aynı anda belleğe alınırsa ne olur?
 *
 * Bu betik `bench-capacity.ts`ten şu yönüyle ayrılır: orada 200 sınav akış
 * hâlinde ölçülüyor (bellekte tek sınav tutuluyor) ve çoklu deneme birleşik
 * analize indiriliyordu. Burada hiçbir sadeleştirme yok: sınavlar dizide
 * birikiyor ve her ara duraklamada uygulamanın gerçek fonksiyonları
 * (`analyzeStudentExam`, `buildTrend`, `listStudents`, `classAverageNet`)
 * tüm veri kümesi üzerinde çalıştırılıyor.
 *
 * Çalıştırma:
 *   BENCH_ENTRY=scripts/bench-full-load.ts pnpm exec vite build --config vite.bench.config.ts
 *   node --expose-gc --max-old-space-size=20480 .bench/bench.mjs
 */
import { analyzeStudentExam, buildTrend, classAverageNet } from '../src/lib/analysis';
import { listStudents } from '../src/lib/store';
import { studentKeyOf } from '../src/lib/text';
import type { ExamRecord } from '../src/lib/types';
import {
  EXAMS_PER_SCHOOL,
  QUESTION_TOTAL,
  STUDENTS_PER_SCHOOL,
  SUBJECTS,
  TOPIC_ROWS,
  fmt,
  heap,
  makeExam,
  mb,
  timed,
} from './bench-data';

/** Ölçüm duraklamaları: bu sınav sayılarına ulaşınca tüm veri kümesi ölçülür. */
const CHECKPOINTS = [25, 50, 100, EXAMS_PER_SCHOOL];

/** Karne süresi ortalaması için kaç öğrenci ölçülecek. */
const REPORT_SAMPLES = 5;

function main() {
  const log = (text = '') => console.log(text);

  log('==============================================================');
  log('TAM YÜK TESTİ · 200 sınav × 1000 öğrenci, birleşik analiz YOK');
  log('==============================================================');
  log(
    `Veri kümesi: ${EXAMS_PER_SCHOOL} sınav × ${STUDENTS_PER_SCHOOL} öğrenci × ` +
      `(${SUBJECTS.length} ders + ${TOPIC_ROWS} konu + ${QUESTION_TOTAL} kazanım)`,
  );
  log(
    `Toplam kırılım satırı: ` +
      `${(EXAMS_PER_SCHOOL * STUDENTS_PER_SCHOOL * (SUBJECTS.length + TOPIC_ROWS + QUESTION_TOTAL)).toLocaleString('tr-TR')}`,
  );
  log('');

  const baseHeap = heap();
  const exams: ExamRecord[] = [];
  let keys: string[] = [];
  let buildMs = 0;

  /** 200 sınavdaki tek öğrencinin toplam veri boyutu (sayfalı okuma senaryosu). */
  let studentSliceBytes = 0;

  log('--- SINAV SAYISINA GÖRE TAM VERİ KÜMESİ ---');
  log(
    'sınav |    bellek |  yükleme |   öğr.listesi |     gidişat | karne (tek öğrenci)',
  );

  CHECKPOINTS.forEach((target) => {
    // Duraklamaya kadar eksik sınavları üret ve dizide TUT (akış yok).
    const chunk = timed(() => {
      for (let i = exams.length; i < target; i += 1) exams.push(makeExam(i));
    });
    buildMs += chunk.ms;

    if (!keys.length) keys = exams[0].students.map((s) => studentKeyOf(s.name));

    const usedMb = mb(heap() - baseHeap);
    const listed = timed(() => listStudents(exams));
    const trended = timed(() => buildTrend(exams, keys[0]));

    // Karne: en son sınav seçili, gidişat tüm geçmişten hesaplanıyor.
    const lastKey = exams[exams.length - 1].key;
    const report = timed(() => {
      for (let i = 0; i < REPORT_SAMPLES; i += 1) {
        analyzeStudentExam(exams, keys[i], lastKey);
      }
    });

    log(
      `${String(target).padStart(5)} | ` +
        `${fmt(usedMb, 0).padStart(6)} MB | ` +
        `${fmt(buildMs / 1000, 1).padStart(6)} s | ` +
        `${fmt(listed.ms, 0).padStart(7)} ms (${listed.value.length}) | ` +
        `${fmt(trended.ms, 0).padStart(7)} ms | ` +
        `${fmt(report.ms / REPORT_SAMPLES, 0).padStart(7)} ms`,
    );
  });

  log('');

  // ------------------------------------------------ Sayfalı okuma karşılaştırması
  /*
   * Uygulamanın önerilen yolu tüm kurumu değil tek öğrencinin geçmişini
   * indirmektir. Bu bölüm o yükü gerçek veriden ölçer: 200 sınavdan aynı
   * öğrencinin kayıtları çıkarılıp JSON boyutu hesaplanır.
   */
  const slice = timed(() => {
    const records = exams.map((item) => ({
      key: item.key,
      name: item.name,
      date: item.date,
      order: item.order,
      section: item.section,
      students: [item.students[0]],
    }));
    studentSliceBytes = Buffer.byteLength(JSON.stringify(records), 'utf8');
    return records;
  });

  const perStudentTrend = timed(() => buildTrend(slice.value, keys[0]));
  const perStudentReport = timed(() =>
    analyzeStudentExam(slice.value, keys[0], slice.value[slice.value.length - 1].key),
  );

  log('--- TEK ÖĞRENCİ GEÇMİŞİ (sayfalı okuma yolu) ---');
  log(`200 sınavda tek öğrenci JSON : ${fmt(mb(studentSliceBytes))} MB`);
  log(`Dilim çıkarma süresi         : ${fmt(slice.ms, 0)} ms`);
  log(`Gidişat (200 nokta)          : ${fmt(perStudentTrend.ms, 0)} ms`);
  log(`Karne (200 sınav geçmişiyle) : ${fmt(perStudentReport.ms, 0)} ms`);
  log('');

  // ------------------------------------------------------- Sınıf ortalamaları
  const classAvg = timed(() => exams.map((item) => classAverageNet(item)));
  log('--- OKUL GENELİ HESAP (200 sınavın tamamı) ---');
  log(`200 sınav sınıf ortalaması   : ${fmt(classAvg.ms, 0)} ms`);
  log('');

  // ------------------------------------------------------------------- Sonuç
  const totalMb = mb(heap() - baseHeap);
  const browserBudgetMb = 700; // Tarayıcı sekmesi için güvenli JS yığın bütçesi.
  const chromeHardLimitMb = 4096; // 64-bit Chrome sekmesinin pratik üst sınırı.

  log('--- SONUÇ ---');
  log(`Tam veri kümesi belleği      : ${fmt(totalMb, 0)} MB`);
  log(`Tarayıcı güvenli bütçesi     : ${browserBudgetMb} MB → ${fmt(totalMb / browserBudgetMb, 1)} kat aşım`);
  log(`Chrome sekmesi sert sınırı   : ${chromeHardLimitMb} MB → ${fmt(totalMb / chromeHardLimitMb, 1)} kat aşım`);
  log(`Tek öğrenci geçmişi ise      : ${fmt(mb(studentSliceBytes))} MB (bütçenin %${fmt((mb(studentSliceBytes) / browserBudgetMb) * 100, 1)}\'i)`);
  log(
    `Bellek kazancı               : ${fmt(totalMb / mb(studentSliceBytes), 0)} kat ` +
      `(tam yük yerine öğrenci bazlı okuma)`,
  );

  return 0;
}

main();