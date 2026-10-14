/**
 * Analiz mod filtresinin İSTEMCİ ayağının kanıtı.
 *
 * Neden bu betik gerekli
 * ----------------------
 * Mod metadata'sının veritabanına yazıldığı ve okuma yollarından döndüğü ayrı
 * bir canlı HTTP betiğiyle kanıtlanıyor (`.bench/verify_exam_mode.py`). Ama
 * kullanıcının gördüğü yer ekran; sunucudan doğru gelen bir alan istemcide
 * yanlış çözülürse kullanıcı yine "deneme Mod belirtilmemiş altında" der ve bu
 * durum veri kaybından ayırt edilemez. Özellikle "temiz cihaz" (önbelleği ve
 * yerel kurgusu olmayan tarayıcı) senaryosu kritiktir: orada mod adı yalnızca
 * sunucudan gelen alanlardan çözülebilir.
 *
 * Bu yüzden iddialar taklit bir kopyayla değil, ekranda çalışan gerçek
 * fonksiyonlarla ölçülür:
 *   `examModes` → `resolveExamMode` → `modeOptionsOf` → `filterExamsByMode`
 *   → `examModeLabelMap` (+ `normalizeSetup` kalıcı depo turu)
 *
 * Her olumlu iddianın karşıtı da aynı koşuda sınanır: mod alanı taşımayan bir
 * kayıt kurum şablonunun moduna SIZMAMALI ve LGS kaydı kurum şablonu
 * filtresine girmemelidir; aksi hâlde yalnızca olumlu iddialara bakan bir
 * ölçüm, her şeyi tek modda toplayan bir kusuru yeşil bırakırdı.
 *
 * Çalıştırma:
 *   BENCH_ENTRY=scripts/bench-exam-mode.ts pnpm exec vite build --config vite.bench.config.ts
 *   node .bench/bench.mjs
 */
/*
  DİKKAT: shim importu EN ÜSTTE olmalıdır. Uygulama modülleri `window`/`localStorage`
  bekler; ESM içe aktarmaları sırayla değerlendirildiği için shim ilk sırada olmazsa
  Node "window is not defined" ile düşer.
*/
import './node-shim';

import {
  blueprintToTemplate,
  derivedTemplateNote,
  emptySetup,
  examModes,
  linkDerivedTemplates,
  normalizeSetup,
  type ExamBlueprint,
  type ExamPreset,
} from '@/lib/examSetup';
import { examKeyOf } from '@/lib/text';
import {
  ALL_MODES,
  UNKNOWN_MODE,
  examModeLabelMap,
  filterExamsByMode,
  modeOptionsOf,
  resolveExamMode,
} from '@/lib/analysisModes';
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

/* ------------------------------------------------------------------ */
/* Kurum şablonu ve kurgusu (yöneticinin oluşturduğu hâl)              */
/* ------------------------------------------------------------------ */

/** Kurumun kendi oluşturduğu sınav şablonu (hazır modlarla aynı yapı). */
const TEMPLATE: ExamPreset = {
  id: 'sablon-kurum-1',
  name: 'Deneme Kulübü Şablonu',
  // Bölüm varsayılanı "Şablon adı" seçilir; şablonun kendi adı mod etiketi olur.
  section: 'Deneme Kulübü Şablonu',
  className: '8',
  penalty: 3,
  scaleMin: 100,
  scaleMax: 500,
  note: 'Kurumun kendi sınav kurgusu',
  subjects: [{ subject: 'Türkçe', questions: 20, coefficient: 1 }],
  custom: true,
};

/** Kurum şablonundan kurulmuş tek sınav kurgusu. */
const BLUEPRINT: ExamBlueprint = {
  id: 'kurgu-kurum-1',
  name: 'Kurum Şablonu Denemesi',
  section: TEMPLATE.section,
  className: '8',
  penalty: 3,
  presetId: TEMPLATE.id,
  scaleMin: 100,
  scaleMax: 500,
  subjects: [{ subject: 'Türkçe', questions: 2, coefficient: 1 }],
  questions: [
    { no: 1, subject: 'Türkçe', topics: ['Sözcükte Anlam'], answer: 'A' },
    { no: 2, subject: 'Türkçe', topics: ['Cümlede Anlam'], answer: 'B' },
  ],
  sheets: [],
  results: [],
  updatedAt: '2026-09-19T00:00:00.000Z',
};

/** Yerel kurgusu ve şablonu olan cihaz. */
const localSetup = { ...emptySetup(), templates: [TEMPLATE], blueprints: [BLUEPRINT] };

/* ------------------------------------------------------------------ */
/* Sonuç kayıtları                                                     */
/* ------------------------------------------------------------------ */

/** Kurum şablonundan üretilmiş sonuç; mod alanları sunucudan gelir. */
const examTemplate: ExamRecord = {
  key: 'kurum-sabloni-denemesi',
  name: 'Kurum Şablonu Denemesi',
  order: 1,
  section: TEMPLATE.section,
  presetId: TEMPLATE.id,
  blueprintId: BLUEPRINT.id,
  students: [],
};

/** Hazır LGS modundan üretilmiş sonuç (karşıt iddialar için). */
const examLgs: ExamRecord = {
  key: 'lgs-denemesi-1',
  name: 'LGS Denemesi 1',
  order: 2,
  section: 'LGS',
  presetId: 'lgs',
  students: [],
};

/** Mod alanı hiç taşımayan eski kayıt. */
const examBare: ExamRecord = {
  key: 'modsuz-deneme',
  name: 'Modsuz Deneme',
  order: 3,
  students: [],
};

/* ------------------------------------------------------------------ */
/* 1) Mod listesi                                                      */
/* ------------------------------------------------------------------ */

check(
  'Kurum şablonu mod listesinde hazır modlarla birlikte görünüyor',
  (() => {
    const modes = examModes(localSetup);
    const found = modes.find((m) => m.id === TEMPLATE.id);
    return Boolean(found) && found?.custom === true && modes.some((m) => m.id === 'lgs');
  })(),
  'şablon listede yok ya da custom işareti düşmüş',
);

check(
  'NEGATİF: ders planı olmayan şablon listeye hiç girmiyor (boş mod üretilmiyor)',
  (() => {
    const broken = normalizeSetup({
      ...emptySetup(),
      templates: [{ ...TEMPLATE, id: 'sablon-bos', subjects: [] }],
    });
    return !examModes(broken).some((m) => m.id === 'sablon-bos');
  })(),
  'ders planı boş şablon mod listesine sızdı',
);

/* ------------------------------------------------------------------ */
/* 2) TEMİZ CİHAZ: yalnızca sunucudan gelen mod alanları               */
/* ------------------------------------------------------------------ */

check(
  'TEMİZ CİHAZ: yerel kurgu/şablon yokken mod, sunucudan gelen bölüm alanından çözülüyor',
  (() => {
    const resolved = resolveExamMode(examTemplate, emptySetup());
    return resolved.id !== UNKNOWN_MODE && resolved.label === TEMPLATE.section;
  })(),
  `etiket=${resolveExamMode(examTemplate, emptySetup()).label}`,
);

check(
  'TEMİZ CİHAZ: kayıt numarası/bölümü değişse de etiket kayıttaki gerçek moddan geliyor',
  (() => {
    const renamed: ExamRecord = { ...examTemplate, name: 'Kurum Denemesi (düzenlendi)', key: 'x' };
    const resolved = resolveExamMode(renamed, emptySetup());
    return resolved.label === TEMPLATE.section;
  })(),
  'kayıt adı değişince etiket kayboldu',
);

check(
  'DÜRÜSTLÜK: şablon tanımı ve bölüm alanı yoksa uydurma mod adı üretilmiyor',
  (() => {
    // `presetId` dolu ama yerel şablonda karşılığı yok: ad bilinemez, uydurulmaz.
    const orphan: ExamRecord = { ...examTemplate, section: undefined };
    return resolveExamMode(orphan, emptySetup()).id === UNKNOWN_MODE;
  })(),
  'bilinmeyen şablon kimliğinden ad uyduruldu',
);

/* ------------------------------------------------------------------ */
/* 3) Yerel kurulum varken çözümleme                                   */
/* ------------------------------------------------------------------ */

check(
  'Bölüm alanı doluysa filtre kimliği bölümden üretiliyor (uygulamadan üretilen tüm kayıtlar böyle)',
  (() => {
    // `buildExamRecord` bölümü kurgudan kopyalar ve kurum şablonu oluşturulurken
    // bölüm varsayılanı şablonun kendi adıdır; yani uygulama üzerinden üretilen
    // her kayıtta bu alan doludur.
    const resolved = resolveExamMode(examTemplate, localSetup);
    return resolved.id === `bolum:${'deneme kulubu sablonu'}` && resolved.label === TEMPLATE.section;
  })(),
  `id=${resolveExamMode(examTemplate, localSetup).id}`,
);

check(
  'Bölüm alanı boşsa bölüm yerel kurgudan GERİ KAZANILIYOR (mod bilgisi kaybolmuyor)',
  (() => {
    const record: ExamRecord = { ...examTemplate, section: undefined };
    const resolved = resolveExamMode(record, localSetup);
    return resolved.id === `bolum:${'deneme kulubu sablonu'}` && resolved.label === BLUEPRINT.section;
  })(),
  `id=${resolveExamMode({ ...examTemplate, section: undefined }, localSetup).id}`,
);

check(
  'Kurgunun bölümü de boşsa mod, kurgunun şablon kimliğinden (`mod:`) çözülüyor',
  (() => {
    // Kurum şablonu bölümsüz kurulmuş olabilir; o zaman kurgu da bölümsüzdür ve
    // tek kalan işaret `presetId` olur. Bu dalın gerçekten çalıştığı ölçülür.
    const sectionless = { ...localSetup, blueprints: [{ ...BLUEPRINT, section: '' }] };
    const record: ExamRecord = {
      ...examTemplate,
      section: undefined,
      presetId: undefined,
    };
    const resolved = resolveExamMode(record, sectionless);
    return resolved.id === `mod:${TEMPLATE.id}` && resolved.label === TEMPLATE.name;
  })(),
  (() => {
    const sectionless = { ...localSetup, blueprints: [{ ...BLUEPRINT, section: '' }] };
    return `id=${
      resolveExamMode({ ...examTemplate, section: undefined, presetId: undefined }, sectionless).id
    }`;
  })(),
);

check(
  'ÖLÇÜLEN SINIR: şablon tanımı olan ama kurgusu olmayan kayıt, bölüm kimliğiyle AYNI etiketi `mod:` kimliğiyle üretebilir',
  (() => {
    // Kurgu silinmiş, kayıt kalmış: liste yalnızca şablon kimliğinden çözülür ve
    // etiket şablon adı olur. Aynı ada sahip bölüm kimliği (`bolum:` biçimi) ile
    // yan yana geldiğinde filtre iki ayrı seçenek gösterir. Bu sınır ölçümle
    // görüldü ve gizlenmiyor: kurgusu silinmiş bir kayıtla aynı adda yeni bir
    // sınav üretilirse filtre iki satır gösterebilir.
    const noBlueprints = { ...localSetup, blueprints: [] };
    const fromTemplate: ExamRecord = { ...examTemplate, key: 'k1', section: undefined };
    const fromSection: ExamRecord = { ...examTemplate, key: 'k2' };
    const options = modeOptionsOf([fromTemplate, fromSection], noBlueprints);
    const ids = options.map((o) => o.id);
    return (
      options.length === 2 &&
      options.every((o) => o.label === TEMPLATE.section) &&
      ids.includes(`mod:${TEMPLATE.id}`) &&
      ids.includes(`bolum:${'deneme kulubu sablonu'}`)
    );
  })(),
  (() => {
    const noBlueprints = { ...localSetup, blueprints: [] };
    return JSON.stringify(
      modeOptionsOf(
        [{ ...examTemplate, key: 'k1', section: undefined }, { ...examTemplate, key: 'k2' }],
        noBlueprints,
      ),
    );
  })(),
);

check(
  'Kalıcı kurgu kimliği: section/presetId taşımayan kayıt blueprintId ile modunu buluyor',
  (() => {
    const record: ExamRecord = {
      ...examTemplate,
      section: undefined,
      presetId: undefined,
    };
    const resolved = resolveExamMode(record, localSetup);
    return resolved.id !== UNKNOWN_MODE && resolved.label === BLUEPRINT.section;
  })(),
  'kurgu kimliği eşleşmedi',
);

check(
  'NEGATİF: kurgu kimliği yerel kurulumda yoksa eski yanlış eşleşmeye düşülmüyor',
  (() => {
    const record: ExamRecord = {
      ...examTemplate,
      section: undefined,
      presetId: undefined,
      blueprintId: 'kurgu-yok',
    };
    return resolveExamMode(record, localSetup).id === UNKNOWN_MODE;
  })(),
  'tanınmayan kurgu kimliği bir moda bağlandı',
);

/* ------------------------------------------------------------------ */
/* 4) Filtre seçenekleri ve süzme                                      */
/* ------------------------------------------------------------------ */

const dataset = [examTemplate, examLgs, examBare];

check(
  'Filtre seçenekleri veride gerçekten bulunan modları kayıt sayısıyla listeliyor',
  (() => {
    const options = modeOptionsOf(dataset, localSetup);
    const template = options.find((o) => o.label === TEMPLATE.section);
    // LGS kaydında da bölüm alanı dolu olduğu için kimlik bölümden üretilir.
    const lgs = options.find((o) => o.label === 'LGS');
    const unknown = options.find((o) => o.id === UNKNOWN_MODE);
    return (
      options.length === 3 &&
      template?.examCount === 1 &&
      lgs?.examCount === 1 &&
      unknown?.examCount === 1
    );
  })(),
  JSON.stringify(modeOptionsOf(dataset, localSetup)),
);

check(
  'Kurum şablonu filtresi yalnızca kendi kaydını veriyor',
  (() => {
    const filtered = filterExamsByMode(dataset, localSetup, resolveExamMode(examTemplate, localSetup).id);
    return filtered.length === 1 && filtered[0].key === examTemplate.key;
  })(),
  JSON.stringify(filterExamsByMode(dataset, localSetup, resolveExamMode(examTemplate, localSetup).id).map((e) => e.key)),
);

check(
  'NEGATİF: LGS kaydı kurum şablonu filtresine girmiyor',
  (() => {
    const filtered = filterExamsByMode(dataset, localSetup, resolveExamMode(examTemplate, localSetup).id);
    return !filtered.some((e) => e.key === examLgs.key);
  })(),
  'başka modun kaydı şablon moduna karıştı',
);

check(
  'NEGATİF: mod alanı olmayan kayıt şablon moduna sızmıyor, "Mod belirtilmemiş"te kalıyor',
  (() => {
    const filtered = filterExamsByMode(dataset, localSetup, resolveExamMode(examTemplate, localSetup).id);
    const unknown = filterExamsByMode(dataset, localSetup, UNKNOWN_MODE);
    return (
      !filtered.some((e) => e.key === examBare.key) &&
      unknown.length === 1 &&
      unknown[0].key === examBare.key
    );
  })(),
  'modsuz kayıt yanlış modda göründü',
);

check(
  '"Tüm sınavlar" seçimi hiçbir kaydı düşürmüyor',
  filterExamsByMode(dataset, localSetup, ALL_MODES).length === dataset.length,
  'tüm sınavlar seçiminde liste kısaldı',
);

/* ------------------------------------------------------------------ */
/* 5) Sınav listesi etiketleri ve yazım birleştirme                    */
/* ------------------------------------------------------------------ */

check(
  'Sınav listesi etiketleri her kaydın modunu doğru veriyor',
  (() => {
    const labels = examModeLabelMap(dataset, localSetup);
    return (
      labels[examTemplate.key] === TEMPLATE.section &&
      labels[examLgs.key] === 'LGS' &&
      labels[examBare.key] === 'Mod belirtilmemiş'
    );
  })(),
  JSON.stringify(examModeLabelMap(dataset, localSetup)),
);

check(
  'Türkçe/büyük-küçük harf farkı aynı modda toplanıyor (tek seçenek, iki kayıt)',
  (() => {
    const a: ExamRecord = { ...examTemplate, key: 'a', section: 'AYT Eşit Ağırlık' };
    const b: ExamRecord = { ...examTemplate, key: 'b', section: 'AYT EŞİT AĞIRLIK' };
    const options = modeOptionsOf([a, b], localSetup);
    const same = options.find((o) => o.label === 'AYT Eşit Ağırlık');
    return options.length === 1 && same?.examCount === 2;
  })(),
  JSON.stringify(modeOptionsOf([
    { ...examTemplate, key: 'a', section: 'AYT Eşit Ağırlık' },
    { ...examTemplate, key: 'b', section: 'AYT EŞİT AIRLIK' },
  ], localSetup)),
);

/* ------------------------------------------------------------------ */
/* 6) Kalıcı depo turu: şablon metadata'sı korunuyor mu                */
/* ------------------------------------------------------------------ */

check(
  'Kalıcı depo turu kurum şablonunu adı ve custom işaretiyle koruyor',
  (() => {
    const restored = normalizeSetup(JSON.parse(JSON.stringify(localSetup)));
    const found = restored.templates.find((t) => t.id === TEMPLATE.id);
    return Boolean(found) && found?.name === TEMPLATE.name && found?.custom === true;
  })(),
  JSON.stringify(normalizeSetup(JSON.parse(JSON.stringify(localSetup))).templates),
);

check(
  'Kalıcı depo turu mod etiketini bozmuyor (Türkçe karakter ve harf duyarlılığı)',
  (() => {
    const restored = normalizeSetup(JSON.parse(JSON.stringify(localSetup)));
    return resolveExamMode(examTemplate, restored).label === TEMPLATE.section;
  })(),
  resolveExamMode(examTemplate, normalizeSetup(JSON.parse(JSON.stringify(localSetup)))).label,
);

/* ------------------------------------------------------------------ */
/* 7) ŞABLONDAN TÜREYEN KURGUNUN KOPAN BAĞI VE ONARIMI                 */
/* ------------------------------------------------------------------ */

/**
 * Kullanıcının canlıda yaşadığı durum birebir kurulur: "Deneme Şablonu" adlı
 * bir sınavdan kurum şablonu üretilmiş ("Şablon olarak kaydet"), ama kurgunun
 * `presetId`si hiç yazılmamış ve bölümü boş bırakılmış. Bu yüzden o denemenin
 * sonucu analiz filtresinde "Mod belirtilmemiş" altında kalıyordu.
 */
const TARGET: ExamBlueprint = {
  id: 'kurgu-deneme-sablon',
  name: 'Deneme Şablonu',
  // Ölçülen canlı kayıtta bölüm de boştu; onarımın bunu tamamlaması beklenir.
  section: '',
  className: '8',
  penalty: 3,
  scaleMin: 100,
  scaleMax: 500,
  subjects: [
    { subject: 'Türkçe', questions: 20, coefficient: 1 },
    { subject: 'Matematik', questions: 20, coefficient: 1 },
  ],
  questions: [],
  sheets: [],
  results: [],
  updatedAt: '2026-09-19T00:00:00.000Z',
};

/** Kullanıcının akışıyla üretilen kurum şablonu (not alanını uygulama yazar). */
const derived = blueprintToTemplate(TARGET, 'Deneme Şablon');
const brokenSetup = { ...emptySetup(), templates: [derived], blueprints: [TARGET] };
const repaired = linkDerivedTemplates(brokenSetup);

/** Kurguya ad üzerinden bağlı sonuç kaydı (canlıda kayıtlar böyle bağlanıyor). */
const targetRecord = {
  key: examKeyOf(TARGET.name),
  name: TARGET.name,
  order: 1,
  students: [],
} as ExamRecord;

check(
  'KANIT: onarım öncesi deneme "Mod belirtilmemiş", onarım sonrası "Deneme Şablon" modu altında görünüyor',
  (() => {
    const before = resolveExamMode(targetRecord, brokenSetup);
    const after = resolveExamMode(targetRecord, repaired.setup);
    const options = modeOptionsOf([targetRecord], repaired.setup);
    return (
      before.id === UNKNOWN_MODE &&
      // Canlı kayıtta şablonun da bölümü boş olduğu için mod etiketi doğrudan
      // şablonun adıdır; kullanıcının görmek istediği etiket de budur.
      after.label === derived.name &&
      after.id === `mod:${derived.id}` &&
      options.length === 1 &&
      options[0].label === derived.name &&
      options[0].examCount === 1
    );
  })(),
  (() => {
    const before = resolveExamMode(targetRecord, brokenSetup);
    const after = resolveExamMode(targetRecord, repaired.setup);
    return `önce=${before.label} sonra=${after.label} seçenek=${JSON.stringify(
      modeOptionsOf([targetRecord], repaired.setup),
    )}`;
  })(),
);

check(
  'Onarım kopan bağı kuruyor ve BÖLÜMÜ DOLU şablonda boş bölümü şablondan tamamlıyor',
  (() => {
    const withSection: ExamPreset = { ...derived, section: 'Deneme Şablonu' };
    const result = linkDerivedTemplates({
      ...emptySetup(),
      templates: [withSection],
      blueprints: [TARGET],
    });
    const record: ExamRecord = { ...targetRecord, section: undefined };
    return (
      result.linked.includes(TARGET.id) &&
      result.setup.blueprints[0].presetId === withSection.id &&
      result.setup.blueprints[0].section === 'Deneme Şablonu' &&
      resolveExamMode(record, result.setup).label === 'Deneme Şablonu'
    );
  })(),
  (() => {
    const withSection: ExamPreset = { ...derived, section: 'Deneme Şablonu' };
    const result = linkDerivedTemplates({
      ...emptySetup(),
      templates: [withSection],
      blueprints: [TARGET],
    });
    return `section=${result.setup.blueprints[0].section} etiket=${
      resolveExamMode({ ...targetRecord, section: undefined }, result.setup).label
    }`;
  })(),
);

check(
  'Onarım işareti tek kaynaktan üretiliyor (şablon oluşturma ve geri kazanım aynı metni kullanıyor)',
  derived.note === derivedTemplateNote(TARGET.name),
  `note=${derived.note}`,
);

check(
  'NEGATİF: ders planı ayrışmışsa bağ kurulmuyor (şablona sonradan ders eklenmiş olabilir)',
  (() => {
    const drifted: ExamPreset = {
      ...derived,
      subjects: [...derived.subjects, { subject: 'Fen Bilimleri', questions: 20, coefficient: 1 }],
    };
    const result = linkDerivedTemplates({ ...emptySetup(), templates: [drifted], blueprints: [TARGET] });
    return result.linked.length === 0 && !result.setup.blueprints[0].presetId;
  })(),
  JSON.stringify(linkDerivedTemplates({ ...emptySetup(), templates: [derived], blueprints: [TARGET] }).linked),
);

check(
  'NEGATİF: bağı bilinçli kaldırılmış kurguya onarım dokunmuyor (yöneticinin kararı geri alınmıyor)',
  (() => {
    const cleared: ExamBlueprint = { ...TARGET, presetLinkCleared: true };
    const result = linkDerivedTemplates({ ...emptySetup(), templates: [derived], blueprints: [cleared] });
    return result.linked.length === 0 && !result.setup.blueprints[0].presetId;
  })(),
  'bilinçli kaldırılan bağ her eşitlemede geri kuruluyor',
);

check(
  'NEGATİF: iki şablon adayı varsa bağ kurulmuyor (belirsizlikte tahmin edilmiyor)',
  (() => {
    const clone: ExamPreset = { ...derived, id: 'sablon-kopya' };
    const result = linkDerivedTemplates({
      ...emptySetup(),
      templates: [derived, clone],
      blueprints: [TARGET],
    });
    return result.linked.length === 0 && !result.setup.blueprints[0].presetId;
  })(),
  'iki aday arasında tahmin yapıldı',
);

check(
  'Zaten bağlı kurgu işaretlenmiyor (onarım tek kez çalışır)',
  (() => {
    const already: ExamBlueprint = { ...TARGET, presetId: derived.id };
    const result = linkDerivedTemplates({ ...emptySetup(), templates: [derived], blueprints: [already] });
    return result.linked.length === 0 && result.setup.blueprints[0].presetId === derived.id;
  })(),
  'bağlı kurgu gereksiz yere yeniden yazıldı',
);

check(
  'Kalıcı depo turu "bağ bilinçli kaldırıldı" işaretini koruyor',
  (() => {
    const restored = normalizeSetup(
      JSON.parse(JSON.stringify({ ...emptySetup(), blueprints: [{ ...TARGET, presetLinkCleared: true }] })),
    );
    return restored.blueprints[0].presetLinkCleared === true;
  })(),
  'presetLinkCleared kalıcı depo turunda düştü',
);

/* ------------------------------------------------------------------ */
/* Sonuç                                                              */
/* ------------------------------------------------------------------ */

console.log('');
if (failures.length) {
  console.log(`BAŞARISIZ: ${failures.length}/${passed + failures.length}`);
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exitCode = 1;
} else {
  console.log(`TÜM BEKLENTİLER KARŞILANDI: ${passed}/${passed}`);
}