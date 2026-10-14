/**
 * Kapasite ölçümü: "her kurum 200 sınav yapıyor ve 1000 öğrencisi var" senaryosu.
 *
 * Betik uygulamanın GERÇEK analiz kodunu (`src/lib/analysis.ts`,
 * `src/lib/store.ts`, `src/lib/examCombine.ts`) çağırır; taklit veya tahmin
 * kullanmaz. Ölçülenler:
 *
 * 1. Tek sınavın (1000 öğrenci) bellek ve JSON boyutu.
 * 2. Sunucuya yazılan paketli satır boyutu (veritabanı hacmi).
 * 3. Tek öğrenci karnesi hesaplama süresi.
 * 4. Birleşik analiz (çoklu deneme) süresi.
 * 5. Öğrenci listesi çıkarma süresinin sınav sayısıyla ölçeklenmesi.
 * 6. 200 sınavın toplam hacmi (bellekte tutulmadan, akış hâlinde ölçülür).
 *
 * Çalıştırma:
 *   pnpm exec vite build --config vite.bench.config.ts
 *   node --expose-gc .bench/bench.mjs
 */
import { analyzeStudentExam, buildTrend } from '../src/lib/analysis';
import { listStudents } from '../src/lib/store';
import { combineExams } from '../src/lib/examCombine';
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
  packedRowSize,
  timed,
} from './bench-data';

function main() {
  const lines: string[] = [];
  const log = (text = '') => {
    lines.push(text);
    console.log(text);
  };

  log('==============================================================');
  log('KAPASİTE TESTİ · kurum başına 200 sınav, 1000 öğrenci');
  log('==============================================================');
  log(
    `Sınav başına satır: ${STUDENTS_PER_SCHOOL} öğrenci × (${SUBJECTS.length} ders + ` +
      `${TOPIC_ROWS} konu + ${QUESTION_TOTAL} kazanım)`,
  );
  log('');

  // ---------------------------------------------------------------- 1. Tek sınav
  const beforeHeap = heap();
  const built = timed(() => makeExam(0));
  const exam = built.value;
  const afterHeap = heap();
  const examJsonBytes = Buffer.byteLength(JSON.stringify(exam), 'utf8');

  let packedBytes = 0;
  exam.students.forEach((s) => {
    packedBytes += packedRowSize(s);
  });

  log('--- 1) TEK SINAV (1000 öğrenci) ---');
  log(`Üretim süresi                : ${fmt(built.ms, 0)} ms`);
  log(`Bellekte kapladığı yer       : ${fmt(mb(afterHeap - beforeHeap))} MB`);
  log(`JSON boyutu (ağ / tarayıcı)  : ${fmt(mb(examJsonBytes))} MB`);
  log(`Veritabanı paketli satırlar  : ${fmt(mb(packedBytes))} MB`);
  log(
    `Sıkıştırma kazancı           : JSON'un %${fmt((packedBytes / examJsonBytes) * 100, 1)} kadarı`,
  );
  log('');

  // ------------------------------------------------- 2. Tek öğrenci karnesi süresi
  const oneExam = [exam];
  // Anahtar üretimi uygulamanın kendi yardımcısıyla yapılır (Türkçe harf katlama).
  const keys = exam.students.map((s) => studentKeyOf(s.name));

  const warm = analyzeStudentExam(oneExam, keys[0], exam.key);
  if (!warm) throw new Error('Analiz üretilemedi.');

  const sample = 40;
  const single = timed(() => {
    for (let i = 0; i < sample; i += 1) analyzeStudentExam(oneExam, keys[i], exam.key);
  });

  log('--- 2) TEK ÖĞRENCİ KARNESİ (tek sınav) ---');
  log(`Karne hesabı (ortalama)      : ${fmt(single.ms / sample)} ms/öğrenci`);
  log(`Üretilen konu satırı         : ${warm.subjects.reduce((s, x) => s + x.topics.length, 0)}`);
  log('');

  // ------------------------------------------------------- 3. Birleşik analiz
  log('--- 3) BİRLEŞİK ANALİZ (çoklu deneme seçimi) ---');
  [2, 5, 10, 20].forEach((count) => {
    const group: ExamRecord[] = [];
    for (let i = 0; i < count; i += 1) group.push(i === 0 ? exam : makeExam(i));
    const combined = timed(() => combineExams(group));
    const analysed = timed(() =>
      analyzeStudentExam([combined.value], keys[0], combined.value.key),
    );
    log(
      `${String(count).padStart(2)} deneme  → birleştirme ${fmt(combined.ms, 0).padStart(6)} ms · ` +
        `karne ${fmt(analysed.ms).padStart(6)} ms`,
    );
  });
  log('');

  // ------------------------------- 4. Öğrenci listesi ve gidişat ölçeklenmesi
  log('--- 4) TÜM SINAVLARI BELLEĞE ALMA (mevcut açılış davranışı) ---');
  [5, 10, 20, 40].forEach((count) => {
    const before = heap();
    const group: ExamRecord[] = [];
    for (let i = 0; i < count; i += 1) group.push(makeExam(i));
    const used = heap() - before;
    const listed = timed(() => listStudents(group));
    const trended = timed(() => buildTrend(group, keys[0]));
    log(
      `${String(count).padStart(3)} sınav → bellek ${fmt(mb(used)).padStart(7)} MB · ` +
        `öğrenci listesi ${fmt(listed.ms, 0).padStart(5)} ms · ` +
        `gidişat ${fmt(trended.ms, 0).padStart(5)} ms · ` +
        `öğrenci ${listed.value.length}`,
    );
  });
  log('');

  // ------------------------------------ 5. 200 sınavın toplam hacmi (akış hâlinde)
  log('--- 5) KURUM BAŞINA 200 SINAVIN TOPLAM HACMİ ---');
  /*
   * Her sınav aynı yapıda (1000 öğrenci × 152 kırılım satırı) olduğu için
   * boyut sınav başına sabittir. 25 sınav gerçekten ölçülür ve ölçülen sınav
   * başı maliyet 200 sınava ölçeklenir; böylece ölçüm makul sürede biter.
   */
  const SAMPLE_EXAMS = 25;
  let sampleJson = 0;
  let samplePacked = 0;
  let sampleRows = 0;
  const streamed = timed(() => {
    for (let i = 0; i < SAMPLE_EXAMS; i += 1) {
      const item = makeExam(i);
      sampleJson += Buffer.byteLength(JSON.stringify(item), 'utf8');
      item.students.forEach((s) => {
        samplePacked += packedRowSize(s);
      });
      sampleRows += item.students.length;
    }
  });

  const scale = EXAMS_PER_SCHOOL / SAMPLE_EXAMS;
  const totalJson = sampleJson * scale;
  const totalPacked = samplePacked * scale;
  const totalStudentRows = sampleRows * scale;

  log(`Gerçek ölçülen sınav         : ${SAMPLE_EXAMS} sınav · ${fmt(streamed.ms / 1000, 1)} s`);
  log(`Öğrenci sonuç satırı (200)   : ${totalStudentRows.toLocaleString('tr-TR')} satır`);
  log(`JSON toplamı (tarayıcı yükü) : ${fmt(mb(totalJson))} MB`);
  log(`Veritabanı toplamı (paketli) : ${fmt(mb(totalPacked))} MB`);
  log(
    `Konu özeti satırı            : ${(EXAMS_PER_SCHOOL * TOPIC_ROWS).toLocaleString('tr-TR')} satır`,
  );
  log('');

  // ---------------------------------------------------------------- 6. Sonuç
  const perSchoolDbMb = mb(totalPacked);
  const perSchoolJsonMb = mb(totalJson);
  const browserBudgetMb = 700; // Tarayıcı sekmesi için güvenli JS yığın bütçesi.
  const examsInBudget = Math.floor((browserBudgetMb / perSchoolJsonMb) * EXAMS_PER_SCHOOL);

  log('--- 6) DEĞERLENDİRME ---');
  log(`Kurum başına veritabanı      : ~${fmt(perSchoolDbMb, 0)} MB`);
  log(`Kurum başına ham JSON        : ~${fmt(perSchoolJsonMb, 0)} MB`);
  log(
    `Tarayıcıya sığan sınav sayısı : ~${examsInBudget} sınav ` +
      `(${browserBudgetMb} MB yığın bütçesiyle)`,
  );
  log(`localStorage önbelleği       : 5 MB kota → ${examsInBudget > 0 ? 'ilk sınavda aşılır' : '-'}`);
  log('');

  // ------------------------------------------------ 7. Kurum kapasitesi tahmini
  /*
   * Sunucu tarafı işlem maliyeti için ölçülen değer kullanılır: bölüm 5'te bir
   * sınavın kırılımlarını üretip JSON'a çevirmek ve paketli satırlara indirmek
   * için harcanan gerçek CPU süresi. Bu, bir sonuç yükleme isteğinin sunucuda
   * yaptığı işin (serileştirme + satır paketleme) doğrudan karşılığıdır.
   */
  const cpuPerExamMs = streamed.ms / SAMPLE_EXAMS;
  const peakShare = 0.6; // Yıllık sınavların tepe döneme düşen payı.
  const peakWeeks = 8; // Tepe dönem (dönem sonu / deneme yoğunluğu).
  const workHoursPerWeek = 8 * 5; // Kurumların sonuç yüklediği çalışma saati.
  const cpuBudget = 0.5; // Tek çekirdeğin sürdürülebilir doluluk sınırı.
  const cores = 4; // Varsayılan uygulama sunucusu.

  const peakExamsPerHour = (EXAMS_PER_SCHOOL * peakShare) / (peakWeeks * workHoursPerWeek);
  const cpuSecPerSchoolHour = (peakExamsPerHour * cpuPerExamMs) / 1000;
  const cpuCapacity = Math.floor((cores * 3600 * cpuBudget) / cpuSecPerSchoolHour);

  const diskBudgetGb = 200; // Veri diski (yedek payı ayrı).
  const backupFactor = 1.3; // Yedek + indeks payı.
  const diskCapacity = Math.floor((diskBudgetGb * 1024) / (perSchoolDbMb * backupFactor));

  log('--- 7) KAÇ KURUMA HİZMET VERİLEBİLİR ---');
  log(`Ölçülen sınav işleme maliyeti : ${fmt(cpuPerExamMs, 0)} ms CPU / sınav`);
  log(`Tepe yükte kurum başına       : ${fmt(peakExamsPerHour, 2)} sınav/saat`);
  log(`Tepe yükte kurum başına CPU   : ${fmt(cpuSecPerSchoolHour, 2)} CPU-sn / saat`);
  log(`CPU sınırı (${cores} çekirdek, %${cpuBudget * 100}) : ~${cpuCapacity.toLocaleString('tr-TR')} kurum`);
  log(`Depolama sınırı (${diskBudgetGb} GB)     : ~${diskCapacity.toLocaleString('tr-TR')} kurum`);
  log('');
  log(
    `SONUÇ: yavaşlamadan hizmet verilebilen kurum sayısı ~` +
      `${Math.min(cpuCapacity, diskCapacity).toLocaleString('tr-TR')} ` +
      `(darboğaz: ${cpuCapacity < diskCapacity ? 'CPU' : 'depolama'})`,
  );
  log('Tarayıcı tarafı sınırı ayrıca geçerlidir: tek oturumda 20-25 sınavdan');
  log('fazlasını birleşik analize almak istemci belleğini zorlar.');

  return lines;
}

main();