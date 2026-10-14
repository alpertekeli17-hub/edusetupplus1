/**
 * Kapasite ölçümleri için ortak veri üreticisi ve ölçüm yardımcıları.
 *
 * Üretilen kayıtlar uygulamanın gerçek `ExamRecord` / `StudentExam` tiplerine
 * birebir uyar; böylece ölçüm betikleri taklit bir yapı yerine analiz
 * motorunun beklediği veriyi işler.
 */
import type { ExamRecord, StudentExam, SubjectScore, TopicStat } from '../src/lib/types';

/** Senaryo sabitleri: kurum başına öğrenci ve yıllık sınav sayısı. */
export const STUDENTS_PER_SCHOOL = 1000;
export const EXAMS_PER_SCHOOL = 200;

/** LGS benzeri ders dağılımı: 90 soru, 56 konu satırı, 90 kazanım satırı. */
export const SUBJECTS = [
  { name: 'Türkçe', questions: 20, topics: 12 },
  { name: 'Matematik', questions: 20, topics: 12 },
  { name: 'Fen Bilimleri', questions: 20, topics: 12 },
  { name: 'Sosyal Bilgiler', questions: 10, topics: 8 },
  { name: 'İngilizce', questions: 10, topics: 6 },
  { name: 'Din Kültürü', questions: 10, topics: 6 },
];

export const TOPIC_ROWS = SUBJECTS.reduce((s, x) => s + x.topics, 0);
export const QUESTION_TOTAL = SUBJECTS.reduce((s, x) => s + x.questions, 0);

/** Deterministik sözde rastgele üretici (ölçüm tekrarlanabilir olsun). */
function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tek öğrencinin tek sınavdaki tam kırılımını üretir. */
export function makeStudent(index: number, examIndex: number): StudentExam {
  const random = rng(index * 7919 + examIndex * 104729);
  const subjects: SubjectScore[] = [];
  const topics: TopicStat[] = [];
  const kazanims: TopicStat[] = [];

  SUBJECTS.forEach((subject) => {
    let correct = 0;
    let wrong = 0;
    const perTopic = Math.max(1, Math.round(subject.questions / subject.topics));

    for (let t = 0; t < subject.topics; t += 1) {
      const questions = perTopic;
      const c = Math.min(questions, Math.round(random() * questions));
      const w = Math.min(questions - c, Math.round(random() * (questions - c)));
      const b = questions - c - w;
      correct += c;
      wrong += w;
      topics.push({
        subject: subject.name,
        group: `${subject.name} Ünite ${1 + (t % 4)}`,
        topic: `${subject.name} Konu ${t + 1}`,
        questions,
        correct: c,
        wrong: w,
        blank: b,
      });
    }

    for (let q = 0; q < subject.questions; q += 1) {
      const c = random() > 0.35 ? 1 : 0;
      kazanims.push({
        subject: subject.name,
        group: `${subject.name} Ünite ${1 + (q % 4)}`,
        topic: `${subject.name} Konu ${1 + (q % subject.topics)}`,
        kazanim: `${subject.name} kazanım ${q + 1}: hedef davranış tanımı`,
        questions: 1,
        correct: c,
        wrong: 1 - c,
        blank: 0,
      });
    }

    subjects.push({
      subject: subject.name,
      correct,
      wrong,
      net: Math.round((correct - wrong / 3) * 100) / 100,
    });
  });

  const net = subjects.reduce((s, x) => s + x.net, 0);
  return {
    name: `Öğrenci ${String(index + 1).padStart(4, '0')} Soyad`,
    className: `8-${'ABCDEFGH'[index % 8]}`,
    studentNo: String(1000 + index),
    subjects,
    totalNet: Math.round(net * 100) / 100,
    lgsScore: Math.round((200 + net * 3.5) * 100) / 100,
    generalRank: index + 1,
    classRank: 1 + (index % 40),
    branchRank: index + 1,
    topics,
    kazanims,
  };
}

/** Tek sınavı verilen öğrenci sayısıyla üretir. */
export function makeExam(examIndex: number, studentCount = STUDENTS_PER_SCHOOL): ExamRecord {
  const students: StudentExam[] = [];
  for (let i = 0; i < studentCount; i += 1) students.push(makeStudent(i, examIndex));
  const day = String(1 + (examIndex % 28)).padStart(2, '0');
  const month = String(1 + (examIndex % 12)).padStart(2, '0');
  return {
    key: `deneme-${examIndex + 1}`,
    name: `Deneme Sınavı ${examIndex + 1}`,
    date: `2026-${month}-${day}`,
    order: examIndex + 1,
    section: 'LGS',
    students,
  };
}

/**
 * Sunucuya yazılan paketli satırın boyutunu ölçer.
 *
 * Biçim `app/backend/services/exam_store.py` dosyasında tanımlıdır: segmentler
 * `;`, segment içindeki sayılar `,` ile ayrılır ve sınavın dizinine hizalıdır.
 */
export function packedRowSize(student: StudentExam): number {
  const pack = (rows: { a: number; b: number; c: number; d: number }[]) =>
    rows.map((r) => `${r.a},${r.b},${r.c},${r.d}`).join(';');

  const subjects = pack(
    student.subjects.map((s) => ({ a: s.correct, b: s.wrong, c: 0, d: s.net })),
  );
  const topics = pack(
    student.topics.map((t) => ({ a: t.questions, b: t.correct, c: t.wrong, d: t.blank })),
  );
  const kazanims = pack(
    student.kazanims.map((t) => ({ a: t.questions, b: t.correct, c: t.wrong, d: t.blank })),
  );

  const identity = `${student.name}|${student.className}|${student.studentNo}|${student.totalNet}|${student.lgsScore}|${student.generalRank}|${student.classRank}|${student.branchRank}`;
  return Buffer.byteLength(identity + subjects + topics + kazanims, 'utf8');
}

export const mb = (bytes: number) => bytes / 1024 / 1024;

export const fmt = (value: number, digits = 2) =>
  value.toLocaleString('tr-TR', { maximumFractionDigits: digits, minimumFractionDigits: digits });

/** Çöp toplayıcıyı zorlayıp kullanılan yığın boyutunu döner. */
export function heap(): number {
  if (typeof globalThis.gc === 'function') globalThis.gc();
  return process.memoryUsage().heapUsed;
}

/** Bir işi ölçer, geçen süreyi milisaniye döner. */
export function timed<T>(work: () => T): { ms: number; value: T } {
  const start = process.hrtime.bigint();
  const value = work();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  return { ms, value };
}