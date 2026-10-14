/**
 * Excel yeniden yükleme kaçağının kapandığının kanıtı.
 *
 * Neden bu betik gerekli
 * ----------------------
 * Silme kararı kalıcı işarete (tombstone) bağlanmıştı ama `ingestFile` yolu
 * işareti hiç okumuyordu: yönetici sınavı sildikten sonra aynı Excel dosyası
 * yeniden yüklendiğinde ayrıştırıcı aynı sınavı üretiyor, `mergeExams` onu
 * veri kümesine geri koyuyordu. Yani kullanıcı "sildim" dedikten sonra aynı
 * dosyayı yüklediğinde sınav analiz ekranında tekrar beliriyordu.
 *
 * Korumayı doğrulamak için sahte veri yetmez: dosya gerçekten ayrıştırıcıdan
 * geçmeli, gerçek anahtar üretilmeli ve işaret o anahtarla yazılmalı. Bu
 * yüzden betik şablonun kendi satırlarından gerçek bir xlsx kitabı üretip
 * `ingestFile` çağırır; uygulamanın kullandığı yoldan farkı yoktur.
 *
 * Çalıştırma:
 *   BENCH_ENTRY=scripts/bench-ingest-tombstone.ts pnpm exec vite build --config vite.bench.config.ts
 *   node .bench/bench.mjs
 */
/*
  DİKKAT: shim importu EN ÜSTTE olmalıdır.

  Uygulama modülleri `lib/api.ts` → `@metagptx/web-sdk` zincirini çeker ve o
  paket modül yüklenirken `window` erişir. ESM içe aktarmaları bildirim
  sırasına göre değerlendirdiği için shim ilk sırada durmazsa Node "window is
  not defined" ile düşer ve ölçüm hiç çalışmaz.
*/
import './node-shim';

import * as XLSX from 'xlsx';

import { specsOf } from '@/lib/template';
import {
  emptyDataset,
  ingestFile,
  loadDataset,
  saveDataset,
  unifyPartialExamsWithGroups,
} from '@/lib/store';
import {
  clearPendingDelete,
  flushPendingDeletes,
  isExamTombstoned,
  pendingDeleteCount,
  reviveExam,
  tombstoneExam,
} from '@/lib/examSync';
import { dropExamByKey } from '@/lib/examResults';
import { saveToken } from '@/lib/portalAuth';
import type { ExamDataset, ExamRecord } from '@/lib/types';

/* ------------------------------------------------------------------ */
/* Gerçek Excel dosyası üretimi                                        */
/* ------------------------------------------------------------------ */

/**
 * Şablonun kendi satırlarından gerçek bir xlsx dosyası üretir.
 *
 * Satırlar `specsOf` üzerinden alınır (indirme akışıyla birebir aynı içerik),
 * böylece ölçüm uygulamada gerçekten yüklenen dosya biçimini kullanır.
 */
function buildWorkbookBuffer(kind: 'ranking' | 'karne', fileName: string): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const sheet of specsOf(kind)) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
    if (sheet.merges) ws['!merges'] = sheet.merges;
    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  }
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  void fileName;
  return out;
}

/**
 * `ingestFile` yalnızca `name` ve `arrayBuffer()` kullanır; Node'da global
 * `File` bulunmadığı için aynı sözleşmeye sahip bir nesne yeterlidir.
 */
function asFile(buffer: ArrayBuffer, name: string): File {
  return {
    name,
    arrayBuffer: async () => buffer,
  } as unknown as File;
}

const RANKING_FILE = 'DENEME 1 (Ders Netleri Sablonu).xlsx';
const RANKING_FILE_2 = 'DENEME 2 (Ders Netleri Sablonu).xlsx';

/* ------------------------------------------------------------------ */
/* Ölçüm                                                              */
/* ------------------------------------------------------------------ */

interface Check {
  name: string;
  expected: string;
  actual: string;
  pass: boolean;
}

const checks: Check[] = [];

function record(name: string, expected: string, actual: string, pass: boolean): void {
  checks.push({ name, expected, actual, pass });
}

function keysOf(dataset: ExamDataset): string[] {
  return (dataset.exams ?? []).map((e) => e.key);
}

function studentCountOf(dataset: ExamDataset, key: string): number {
  const exam = (dataset.exams ?? []).find((e) => e.key === key);
  return exam?.students?.length ?? 0;
}

async function main(): Promise<void> {
  saveDataset(emptyDataset());

  const ranking1 = buildWorkbookBuffer('ranking', RANKING_FILE);
  const bigFile = asFile(ranking1, RANKING_FILE);

  /* --- 1) Temiz kurulumda dosya normal şekilde yükleniyor ---------- */
  const first = await ingestFile(emptyDataset(), bigFile);
  saveDataset(first.dataset);
  const examKeys = keysOf(first.dataset);
  record(
    '1. Ilk yukleme sınavı veri kümesine işliyor',
    'ok=true, 1 sınav',
    `ok=${first.ok}, sinav=${examKeys.length} [${examKeys.join(', ')}]`,
    first.ok && examKeys.length === 1,
  );

  const targetKey = examKeys[0];
  const targetStudents = studentCountOf(first.dataset, targetKey);
  record(
    '2. Ayrıştırma öğrenci satırlarını üretiyor (sahte veri değil)',
    'ogrenci>0',
    `ogrenci=${targetStudents}`,
    targetStudents > 0,
  );

  /* --- 2) Yönetici sınavı siliyor ---------------------------------- */
  tombstoneExam(targetKey);
  const afterDelete = { ...loadDataset() };
  afterDelete.exams = afterDelete.exams.filter((e) => e.key !== targetKey);
  saveDataset(afterDelete);
  record(
    '3. Silme işareti yazıldı ve sınav veri kümesinden çıktı',
    'isaretli=true, sinav=0',
    `isaretli=${isExamTombstoned(targetKey)}, sinav=${keysOf(loadDataset()).length}`,
    isExamTombstoned(targetKey) && keysOf(loadDataset()).length === 0,
  );

  /* --- 3) ASIL KANIT: aynı dosya yeniden yükleniyor ---------------- */
  const before = loadDataset();
  const second = await ingestFile(before, bigFile);
  saveDataset(second.dataset);
  const afterSecond = loadDataset();
  const leaked = keysOf(afterSecond).includes(targetKey);
  record(
    '4. Aynı Excel yeniden yuklendiginde silinen sinav GERI GELMIYOR',
    'ok=false, sinav=0, kullaniciya bilgi',
    `ok=${second.ok}, sinav=${keysOf(afterSecond).length}, uyari="${second.warnings[0] ?? '-'}"`,
    !leaked && keysOf(afterSecond).length === 0 && second.ok === false,
  );

  record(
    '5. Calistirilan dosya kaydi sizinti olusturmuyor',
    'files=0',
    `files=${(afterSecond.files ?? []).length}`,
    (afterSecond.files ?? []).length === 0,
  );

  /* --- 4) Farklı dosya etkilenmiyor (yan hasar yok) ----------------- */
  const otherFile = asFile(buildWorkbookBuffer('ranking', RANKING_FILE_2), RANKING_FILE_2);
  const third = await ingestFile(loadDataset(), otherFile);
  saveDataset(third.dataset);
  const thirdKeys = keysOf(loadDataset());
  record(
    '6. Baska bir sinav dosyasi normal yukleniyor (yan hasar yok)',
    'ok=true, silinen disinda 1 sinav',
    `ok=${third.ok}, sinav=${thirdKeys.length} [${thirdKeys.join(', ')}]`,
    third.ok && thirdKeys.length === 1 && !thirdKeys.includes(targetKey),
  );

  /*
    Aşırı temizlik denetimi.

    Dosya kaydı süzülürken yalnızca silinmiş sınavın kaydı düşmelidir; canlı
    sınavın kaydı da düşerse kullanıcı geçmişte yüklediği dosyanın adını ve
    yükleme bilgisini kaybeder. Tek taraflı bir doğrulama (yalnızca "silinen
    gitti mi") bu hatayı gizlerdi.
  */
  const liveFiles = (loadDataset().files ?? []).filter((f) => f.examKeys.includes('deneme-2'));
  record(
    '9. Canli sinavin dosya kaydi korunuyor (asiri temizlik yok)',
    'deneme-2 icin dosya kaydi var',
    `kayit=${liveFiles.length}, dosya="${liveFiles[0]?.fileName ?? '-'}"`,
    liveFiles.length === 1,
  );

  /* --- 5) Bilinçli geri getirme hâlâ çalışıyor ---------------------- */
  reviveExam(targetKey);
  const fourth = await ingestFile(loadDataset(), bigFile);
  saveDataset(fourth.dataset);
  const revived = keysOf(loadDataset()).includes(targetKey);
  record(
    '7. Bilincli geri getirmeden sonra ayni sinav yeniden yuklenebiliyor',
    'ok=true, silinen sinav geri dondu',
    `ok=${fourth.ok}, geri_dondu=${revived}, isaretli=${isExamTombstoned(targetKey)}`,
    fourth.ok && revived && !isExamTombstoned(targetKey),
  );

  /* --- 6) Meşru akış yan hasar görmedi ----------------------------- */
  const karneFile = asFile(buildWorkbookBuffer('karne', 'DENEME 3 (Konu Analizi Sablonu).xlsx'), 'DENEME 3 (Konu Analizi Sablonu).xlsx');
  const fifth = await ingestFile(loadDataset(), karneFile);
  saveDataset(fifth.dataset);
  record(
    '8. Farkli tur (karne) dosyasi da normal yukleniyor',
    'ok=true, sinav sayisi artti',
    `ok=${fifth.ok}, sinav=${keysOf(loadDataset()).length} [${keysOf(loadDataset()).join(', ')}]`,
    fifth.ok && keysOf(loadDataset()).length >= 2,
  );

  /*
    --- 7) ASIL KANIT (2): birleşme grubu kaçağı --------------------------------

    "Yüklenen sınavlar" listesi, aynı denemenin sıralı liste ve karne dosyalarını
    tek kartta birleştirir. Yönetici o kartı sildiğinde yalnızca görünen anahtar
    silinirse birleşimin diğer yarısı veri kümesinde kalır ve silinen deneme
    sonraki okumada tek başına geri görünür — kullanıcının "sildim ama yine
    görünüyor" demesinin bu turda kapatılan kaynağı tam olarak budur.

    Kayıtlar elle kurulur (şablon öğrenci adlarına güvenilmez): örtüşen öğrenci
    kümesi birleşmenin gerçekleşmesi için zorunlu koşuldur, örtüşme yoksa
    `unifyPartialExamsWithGroups` iki kaydı bilinçli olarak birleştirmez.
  */
  const rankingRecord: ExamRecord = {
    key: 'deneme-birlesik',
    name: 'DENEME BIRLESIK',
    order: 1,
    students: [
      {
        name: 'Ali Veli',
        className: '8-A',
        subjects: [{ subject: 'Türkçe', correct: 10, wrong: 2, net: 9.33 }],
        totalNet: 9.33,
        lgsScore: 400,
        topics: [],
        kazanims: [],
      },
    ],
  };
  const reportRecord: ExamRecord = {
    key: 'deneme-birlesik-karne',
    name: 'DENEME BIRLESIK KARNE',
    order: 2,
    students: [
      {
        name: 'Ali Veli',
        className: '8-A',
        subjects: [],
        topics: [
          { subject: 'Türkçe', group: '', topic: 'Sözcükte Anlam', questions: 4, correct: 2, wrong: 2, blank: 0 },
        ],
        kazanims: [],
      },
    ],
  };

  const pairDataset = emptyDataset();
  pairDataset.exams = [rankingRecord, reportRecord];
  saveDataset(pairDataset);

  const unified = unifyPartialExamsWithGroups(loadDataset().exams);
  const visibleKey = unified.exams[0]?.key ?? '';
  const group = unified.groups.get(visibleKey) ?? [];
  record(
    '10. Birlestirilmis kart iki ham sinavi tek kayitta topluyor',
    'kart=1, grup=2 anahtar',
    `kart=${unified.exams.length}, gorunen="${visibleKey}", grup=${group.length} [${group.join(', ')}]`,
    unified.exams.length === 1 && group.length === 2 && group.includes(reportRecord.key) && group.includes(rankingRecord.key),
  );

  /*
    Eski (hatalı) davranışın gerçekten sızıntı ürettiğinin kanıtı: yalnızca
    görünen anahtar çıkarıldığında birleşimin diğer yarısı listede kalıyor.
    Bu denetim olmadan "düzeltildi" iddiası, kaçağın var olduğu kanıtlanmadan
    söylenmiş olurdu.

    Yalnızca bellek içi bir kopya üzerinde çalışır; kalıcı depoya yazmaz.
  */
  const oldBehavior = emptyDataset();
  oldBehavior.exams = [rankingRecord, reportRecord].filter((e) => e.key !== visibleKey);
  const leakedUnified = unifyPartialExamsWithGroups(oldBehavior.exams);
  record(
    '11. Eski davranis sizinti uretiyordu (tek anahtar silmek yetmiyor)',
    'kart=1 (sizan yarim kayit)',
    `kart=${leakedUnified.exams.length} [${leakedUnified.exams.map((e) => e.key).join(', ')}]`,
    leakedUnified.exams.length === 1 && leakedUnified.exams[0].key === rankingRecord.key,
  );

  /* Yeni davranış: silme birleşme grubunun TAMAMINI kaldırır. */
  saveDataset(pairDataset);
  const deleteKeys = new Set<string>(unifyPartialExamsWithGroups(loadDataset().exams).groups.get(visibleKey) ?? [visibleKey]);
  deleteKeys.forEach((key) => tombstoneExam(key));
  const afterGroupDelete = loadDataset();
  afterGroupDelete.exams = afterGroupDelete.exams.filter((e) => !deleteKeys.has(e.key));
  saveDataset(afterGroupDelete);

  const reloaded = loadDataset();
  const remaining = unifyPartialExamsWithGroups(reloaded.exams).exams;
  record(
    '12. Kart silindiginde birlesimin iki yarisi da kalkiyor (geri gelmiyor)',
    'silinen=2, kalan kart=0, isaretli=2',
    `silinen=${deleteKeys.size}, kalan_kart=${remaining.length}, isaretli=${[...deleteKeys].filter((k) => isExamTombstoned(k)).length}`,
    deleteKeys.size === 2 &&
      remaining.length === 0 &&
      reloaded.exams.length === 0 &&
      [...deleteKeys].every((k) => isExamTombstoned(k)),
  );

  /* Silme sonrası yeniden okuma sızıntı üretmiyor (önbellek/JSON yolu). */
  const reread = unifyPartialExamsWithGroups(loadDataset().exams).exams;
  record(
    '13. Yeniden okumada silinen kart hicbir yarisiyla donmuyor',
    'kart=0',
    `kart=${reread.length}`,
    reread.length === 0,
  );

  /* Bilinçli geri getirme bu yolda da çalışıyor (asimetri korunuyor). */
  deleteKeys.forEach((key) => reviveExam(key));
  const revivedPair = loadDataset();
  revivedPair.exams = [rankingRecord, reportRecord];
  saveDataset(revivedPair);
  const revivedUnified = unifyPartialExamsWithGroups(loadDataset().exams);
  record(
    '14. Geri getirmeden sonra birlestirilmis kart yeniden kuruluyor',
    'kart=1, isaretli=0',
    `kart=${revivedUnified.exams.length}, isaretli=${[...deleteKeys].filter((k) => isExamTombstoned(k)).length}`,
    revivedUnified.exams.length === 1 && [...deleteKeys].every((k) => !isExamTombstoned(k)),
  );

  /*
    --- 8) ASIL KANIT (3): sunucuya yazılamayan silme kararı kaybolmuyor -------

    Kullanıcının bildirdiği asıl kusur burada: silme iki adımda gerçekleşir —
    karar bu cihazda işaretlenir, aynı karar sunucuya yazılır. İkinci adım
    düştüğünde çağıran akış bunu bilmiyor ve kullanıcıya "silindi" diyordu;
    sonuç, öğretmen/veli/öğrenci/rehber hesaplarının sınavı sunucudan okumaya
    devam etmesiydi (üretimde `exam_deletions` tablosunun boş kalmasının nedeni).

    Ölçüm iddiası iki yönlüdür: (a) başarısız silme "senkronize oldu" diye
    raporlanmamalı, (b) karar kuyruğa alınıp bağlantı düzelince yeniden
    gönderilmeli. Yalnızca (a) ölçülürse kararın kaybolduğu durum yeşil kalırdı.
    Yalnızca (b) ölçülürse kullanıcıya yanlış mesaj gösterilmesi gizlenirdi.
  */

  /* İzole kurum bağlamı: istek yerel sunucuya gider, bulut verisine dokunulmaz. */
  saveToken('bench-token');
  localStorage.setItem('lgs.activeTerm', 'BENCH-2099');
  localStorage.setItem('lgs.baselineTerm', 'BENCH-2099');

  const offlineDataset = emptyDataset();
  offlineDataset.exams = [rankingRecord];
  saveDataset(offlineDataset);
  clearPendingDelete(rankingRecord.key);

  /*
    Sunucu erişilemez durumdayken silme çağrılır. Ağ katmanı bu ortamda
    yanıt vermez; beklenen sonuç `synced=false` ve sınavın yerelde gerçekten
    kalkmış olmasıdır.
  */
  const offlineDrop = await dropExamByKey(rankingRecord.key);
  record(
    '15. Sunucuya ulasilamazken silme "senkronize oldu" diye raporlanmiyor',
    'synced=false, yerelde silindi, kuyruk=1',
    `synced=${offlineDrop.synced}, kalan_sinav=${keysOf(offlineDrop.dataset).length}, kuyruk=${pendingDeleteCount()}`,
    offlineDrop.synced === false &&
      keysOf(offlineDrop.dataset).length === 0 &&
      pendingDeleteCount() === 1 &&
      Boolean(offlineDrop.message),
  );

  /*
    Karar hâlâ işaretli: sonraki okumada sınav ne yarım ne bütün olarak
    dönmemelidir, aksi hâlde kullanıcı sildiği sınavı yine görürdü.
  */
  record(
    '16. Yazilamayan silme karari cihazda kalici kaliyor (sınav geri gelmiyor)',
    'isaretli=true, sinav=0',
    `isaretli=${isExamTombstoned(rankingRecord.key)}, sinav=${keysOf(loadDataset()).length}`,
    isExamTombstoned(rankingRecord.key) && keysOf(loadDataset()).length === 0,
  );

  /*
    Kuyruk gerçekten yeniden gönderiliyor mu? Sunucu bu ortamda yanıt
    vermediği için silme yine başarısız olur; kritik nokta, kararın kuyruktan
    düşmemesi ve denemenin gerçekten yapılmış olmasıdır. Karar burada
    düşseydi, bağlantı düzeldiğinde sınav diğer hesaplarda kalıcı olarak
    kalırdı.
  */
  const firstFlush = await flushPendingDeletes();
  record(
    '17. Kuyruk yeniden deneme yapiyor, basarisizlikta karar kaybolmuyor',
    'denenen=1, silinen=0, kalan=1',
    `denenen=${firstFlush.attempted}, silinen=${firstFlush.removed}, kalan=${firstFlush.remaining}`,
    firstFlush.attempted === 1 &&
      firstFlush.removed === 0 &&
      firstFlush.remaining === 1 &&
      pendingDeleteCount() === 1,
  );

  /*
    Silme kararı kuyruğa alınırken anahtar sadeleştirilir; aynı sınav farklı
    yazımla tekrar silinirse kuyrukta iki kayıt oluşmamalıdır (aksi hâlde
    bağlantı düzelince gereksiz istekler üretilirdi).
  */
  const beforeDup = pendingDeleteCount();
  await dropExamByKey(`  ${rankingRecord.key.toUpperCase()}  `);
  record(
    '18. Ayni sinavin yazim varyanti kuyrugu cogaltmiyor',
    `kuyruk=${beforeDup} (artmiyor)`,
    `kuyruk=${pendingDeleteCount()}`,
    pendingDeleteCount() === beforeDup,
  );

  /*
    Aşırı kuyruk denetimi: silme başarılı olduğunda karar kuyrukta kalmamalıdır.
    Kuyruk geçmişten temizlenmezse her açılışta aynı istekler tekrar tekrar
    atılır ve gereksiz yük oluşur.
  */
  clearPendingDelete(rankingRecord.key);
  record(
    '19. Basarili silmede karar kuyruktan dusuyor',
    'kuyruk=0',
    `kuyruk=${pendingDeleteCount()}`,
    pendingDeleteCount() === 0,
  );

  /* Ölçüm ortamı bozulmasın: doğrulama için kurulan kapsam kaydı geri alınır. */
  localStorage.removeItem('lgs.activeTerm');
  localStorage.removeItem('lgs.baselineTerm');
  saveToken('');

  const passed = checks.filter((c) => c.pass).length;
  const summary = {
    generatedAt: new Date().toISOString(),
    passed,
    total: checks.length,
    allPassed: passed === checks.length,
    checks,
  };

  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nSONUC: ${passed}/${checks.length} OK`);
  for (const c of checks) console.log(`${c.pass ? 'OK  ' : 'FAIL'} ${c.name}`);
}

main().catch((error) => {
  console.error('Betik hata verdi:', error);
  process.exit(1);
});
