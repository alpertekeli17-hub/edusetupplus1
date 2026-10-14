/**
 * Gerçek tahsilat mahsubunun kanıtı (kısmi ödeme · fazla ödeme · geri alma).
 *
 * Neden bu betik gerekli
 * ----------------------
 * Mahsup hesabı doğru yazılmış olsa bile **yanlış bağlanabilir**: ekran kendi
 * hesabını yapar, yalnızca `status` alanını günceller veya `settle_log`'u hiç
 * yazmaz. Bu durumda ekranda hata görünmez — liste normal çizilir, yalnızca
 * tutarlar yanlıştır. Bu yüzden iddialar gerçek uygulama fonksiyonlarıyla
 * (`applyPayment`, `revertPayment`, `settlementOf`, `settledStatus`,
 * `summarizeSettlement`, `missingRevertTargets`) ölçülür ve her olumlu iddianın
 * karşıtı da aynı koşuda sınanır:
 *   - kısmi ödeme bakiye bırakmalı, taksit kapanmamalı
 *   - fazla ödeme en eski vadeli taksitlerden dağıtılmalı
 *   - dağıtılamayan artık kaybolmamalı (`overflow`)
 *   - tarih ve ödeme yöntemi dağıtılan tüm taksitlerde doğru yazılmalı
 *   - geri alma mahsubun değdiği HER taksiti geri almalı
 *   - başka öğrencinin taksiti ve gider kalemi mahsuptan etkilenmemeli (negatif)
 *   - eksik kurum listesinde geri alma durdurulmalı (negatif)
 *   - eski `paid_amount` kaydı çift sayılmamalı (negatif)
 *
 * Kusurun maliyeti iddia olarak bırakılmaz: `BENCH_LEGACY_BODY=1` ile eski
 * davranış (yalnızca `status`+`paid_date` yazma) yeniden üretilir ve kaç iddianın
 * düştüğü ölçülür.
 *
 * Çalıştırma:
 *   BENCH_ENTRY=scripts/bench-settlement.ts pnpm exec vite build --config vite.bench.config.ts
 *   node .bench/bench.mjs
 *   BENCH_LEGACY_BODY=1 node .bench/bench.mjs
 */
/*
  DİKKAT: shim importu EN ÜSTTE olmalıdır. Uygulama modülleri `window`/`localStorage`
  bekler; ESM içe aktarmaları sırayla değerlendirildiği için shim ilk sırada olmazsa
  Node "window is not defined" ile düşer.
*/
import './node-shim';

import {
  applyPayment,
  missingRevertTargets,
  parseSettleLog,
  recordTotal,
  revertPayment,
  serializeSettleLog,
  settledStatus,
  settlementOf,
  summarizeSettlement,
  type SettlementPatch,
  type SettlementResult,
} from '@/lib/settlement';
import type { AccountingEntry } from '@/lib/site';
import { accountingImportDecision } from '@/lib/moduleExcel';

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

/** Para karşılaştırması kuruş hassasiyetinde yapılır (0,005 TL tolerans). */
const money = (value: number): number => Math.round((Number(value) || 0) * 100) / 100;

function checkMoney(label: string, actual: number, expected: number): void {
  check(
    label,
    Math.abs(money(actual) - money(expected)) < 0.005,
    `beklenen ${expected}, gelen ${actual}`,
  );
}

/* ------------------------------------------------------------------ */
/* Sahne kurulumu                                                      */
/* ------------------------------------------------------------------ */

const STUDENT = 'Zeynep Kaya';
const OTHER_STUDENT = 'Mert Demir';
const PAST = '2026-08-01';
const SOON = '2026-09-25';
const NEXT = '2026-10-25';
const LATER = '2026-11-25';

let sequence = 0;

function entry(over: Partial<AccountingEntry> = {}): AccountingEntry {
  sequence += 1;
  return {
    id: sequence,
    entry_type: 'tahsilat',
    title: `Taksit ${sequence}`,
    amount: 1000,
    status: 'bekliyor',
    student_name: STUDENT,
    payment_method: 'nakit',
    due_date: SOON,
    ...over,
  } as AccountingEntry;
}

/** Uygulamanın sunucuya yazdığı düzeltmeleri veri kümesine uygular. */
function commit(entries: AccountingEntry[], patches: SettlementPatch[]): AccountingEntry[] {
  const map = new Map<number, AccountingEntry>(entries.map((item) => [Number(item.id), item]));
  for (const patch of patches) {
    const current = map.get(patch.id);
    if (!current) continue;
    map.set(patch.id, { ...current, ...patch.patch } as AccountingEntry);
  }
  return [...map.values()];
}

function byId(entries: AccountingEntry[], id: number): AccountingEntry {
  const found = entries.find((item) => Number(item.id) === id);
  if (!found) throw new Error(`kayıt bulunamadı: ${id}`);
  return found;
}

/** Kaydın gerçek durumunu özetleyen okunabilir metin (hata mesajları için). */
const stateOf = (item: AccountingEntry): string =>
  JSON.stringify({
    paid: settlementOf(item).paid,
    remaining: settlementOf(item).remaining,
    overflow: settlementOf(item).overflow,
    status: item.status,
    paid_date: item.paid_date ?? '',
  });

/*
  Eski (hatalı) davranış: girilen tutar ne olursa olsun taksit "ödendi" sayılır,
  mahsup günlüğü hiç yazılmaz ve fazla ödeme ileri taksitlere dağıtılmaz.
  Bu şube yalnızca kusurun maliyetini ölçmek için vardır.
*/
const LEGACY = process.env.BENCH_LEGACY_BODY === '1';

function legacyApply(input: Parameters<typeof applyPayment>[0]): SettlementResult {
  const { entry: target } = input;
  const amount = money(Number(input.amount) || 0);
  if (amount <= 0) {
    return { patches: [], applied: 0, overflow: 0, lines: [], closedCount: 0, forwarded: 0 };
  }
  return {
    patches: [
      {
        id: Number(target.id),
        entry: target,
        patch: { status: 'odendi', paid_date: (input.date || '').slice(0, 10) },
      },
    ],
    applied: amount,
    overflow: 0,
    lines: [{ entryId: Number(target.id), amount }],
    closedCount: 1,
    forwarded: 0,
  };
}

const apply = (input: Parameters<typeof applyPayment>[0]): SettlementResult =>
  LEGACY ? legacyApply(input) : applyPayment(input);

/* ------------------------------------------------------------------ */
/* 1) Kısmi ödeme — bakiye kalmalı                                     */
/* ------------------------------------------------------------------ */

console.log('\n1) Kısmi ödeme bakiye bırakır\n');
{
  const taksit = entry({ id: 101, amount: 1000, due_date: SOON });
  const others = [taksit, entry({ id: 102, amount: 500, due_date: NEXT })];
  const result = apply({ entry: taksit, all: others, amount: 400, date: '2026-09-20', method: 'nakit' });
  const updated = commit(others, result.patches);
  const after = byId(updated, 101);

  checkMoney('400 TL ödemede tahsil edilen 400', settlementOf(after).paid, 400);
  checkMoney('400 TL ödemede kalan bakiye 600', settlementOf(after).remaining, 600);
  check('kısmi ödemede taksit kapanmaz', result.closedCount === 0, `closedCount=${result.closedCount}`);
  checkMoney('kısmi ödemede fazla dağıtım yok', result.forwarded, 0);
  checkMoney('kısmi ödemede iade/avans yok', result.overflow, 0);
  check(
    'kısmi ödemede durum "odendi" olmaz',
    settledStatus(after) !== 'odendi',
    `durum=${settledStatus(after)}`,
  );
  check(
    'ileri taksit kısmi ödemeden etkilenmez',
    settlementOf(byId(updated, 102)).paid === 0,
    stateOf(byId(updated, 102)),
  );
  check('tek mahsup satırı yazılır', result.lines.length === 1, `satır=${result.lines.length}`);
}

/* ------------------------------------------------------------------ */
/* 2) Tam ödeme — taksit kapanır, durum ödendi                         */
/* ------------------------------------------------------------------ */

console.log('\n2) Tam ödeme taksiti kapatır\n');
{
  const taksit = entry({ id: 201, amount: 1250.5, due_date: SOON });
  const result = apply({ entry: taksit, all: [taksit], amount: 1250.5, date: '2026-09-20' });
  const after = byId(commit([taksit], result.patches), 201);

  checkMoney('tam ödemede kalan bakiye 0', settlementOf(after).remaining, 0);
  checkMoney('tam ödemede tahsil tam tutar', settlementOf(after).paid, 1250.5);
  check('tam ödemede taksit kapanır', result.closedCount === 1, `closedCount=${result.closedCount}`);
  check('tam ödemede durum "odendi"', settledStatus(after) === 'odendi', settledStatus(after));
  check(
    'tam ödemede fazla bakiye uyarısı yok',
    settlementOf(after).overflow === 0,
    stateOf(after),
  );
}

/* ------------------------------------------------------------------ */
/* 3) Fazla ödeme en eski vadeden dağıtılır                            */
/* ------------------------------------------------------------------ */

console.log('\n3) Fazla ödeme sonraki taksitlere dağıtılır\n');
{
  const own = entry({ id: 301, amount: 1000, due_date: SOON });
  const later = entry({ id: 302, amount: 400, due_date: LATER, installment_no: 3 });
  const past = entry({ id: 303, amount: 300, due_date: PAST, installment_no: 2 });
  const all = [own, later, past];

  /*
    1500 TL = kendi taksiti 1000 + en eski vadesi geçmiş taksit 300 + sıradaki
    ileri taksite 200. Fazla ödeme ileri taksiti atlamaz, dolayısıyla dağıtım
    "en eski vade önce" kuralıyla üç satıra yayılır.
  */
  const result = apply({ entry: own, all, amount: 1500, date: '2026-09-20', method: 'kredi-karti' });
  const updated = commit(all, result.patches);

  checkMoney('kendi taksiti tam kapanır', settlementOf(byId(updated, 301)).remaining, 0);
  checkMoney(
    'fazla, en eski vadeli taksiti önce kapatır',
    settlementOf(byId(updated, 303)).remaining,
    0,
  );
  checkMoney('kalan fazla sıradaki taksite geçer', settlementOf(byId(updated, 302)).paid, 200);
  checkMoney('sıradaki taksitte bakiye kalır', settlementOf(byId(updated, 302)).remaining, 200);
  checkMoney('dağıtılan toplam 1500', result.applied, 1500);
  checkMoney('ileri dağıtılan 500', result.forwarded, 500);
  checkMoney('iade/avans kalmaz', result.overflow, 0);
  check('iki taksit kapanır', result.closedCount === 2, `closedCount=${result.closedCount}`);
  check('üç mahsup satırı yazılır', result.lines.length === 3, `satır=${result.lines.length}`);

  const shuffled = commit(
    [own, past, later],
    apply({ entry: own, all: [own, past, later], amount: 1500, date: '2026-09-20' }).patches,
  );
  check(
    'dağıtım liste sırasından bağımsız, vade belirler',
    settlementOf(byId(shuffled, 302)).paid === 200,
    stateOf(byId(shuffled, 302)),
  );
}

/* ------------------------------------------------------------------ */
/* 4) Fazla ödeme birden çok taksite yayılır + overflow                */
/* ------------------------------------------------------------------ */

console.log('\n4) Fazla ödeme birden çok taksite yayılır, artık kaybolmaz\n');
{
  const own = entry({ id: 401, amount: 1000, due_date: SOON });
  const first = entry({ id: 402, amount: 300, due_date: '2026-10-01' });
  const second = entry({ id: 403, amount: 400, due_date: '2026-10-15' });
  const all = [own, first, second];

  const result = apply({ entry: own, all, amount: 2000, date: '2026-09-20' });
  const updated = commit(all, result.patches);

  checkMoney('ilk ileri taksit kapanır', settlementOf(byId(updated, 402)).remaining, 0);
  checkMoney('ikinci ileri taksit kapanır', settlementOf(byId(updated, 403)).remaining, 0);
  checkMoney('dağıtılan toplam 1700', result.applied, 1700);
  checkMoney('dağıtılamayan artık 300 olarak döner', result.overflow, 300);
  check('üç mahsup satırı yazılır', result.lines.length === 3, `satır=${result.lines.length}`);
  check(
    'iade/avans uyarısı tek sayıyla bildirilir',
    money(result.overflow) === 300,
    `overflow=${result.overflow}`,
  );
  const own2 = apply({ entry: own, all, amount: 1500, date: '2026-09-20' });
  checkMoney('tam sığan ödemede artık kalmaz', own2.overflow, 0);
}

/* ------------------------------------------------------------------ */
/* 5) Tarih ve ödeme yöntemi dağıtılan taksitlerde doğru               */
/* ------------------------------------------------------------------ */

console.log('\n5) Tarih ve ödeme yöntemi tüm dağıtılan taksitlere yazılır\n');
{
  const own = entry({
    id: 501,
    amount: 1000,
    due_date: SOON,
    payment_method: 'nakit',
  });
  const next = entry({ id: 502, amount: 400, due_date: NEXT, payment_method: 'havale' });
  const all = [own, next];

  const result = apply({
    entry: own,
    all,
    amount: 1400,
    date: '2026-09-18',
    method: 'kredi-karti',
  });
  const updated = commit(all, result.patches);

  check(
    'kendi taksitinde kullanıcının girdiği tarih yazılır',
    byId(updated, 501).paid_date === '2026-09-18',
    `paid_date=${byId(updated, 501).paid_date}`,
  );
  check(
    'fazla ödemeyi alan taksitte de aynı tarih yazılır',
    byId(updated, 502).paid_date === '2026-09-18',
    `paid_date=${byId(updated, 502).paid_date}`,
  );
  check(
    'kendi taksitinin ödeme yöntemi işlemin yöntemidir',
    byId(updated, 501).payment_method === 'kredi-karti',
    `yöntem=${byId(updated, 501).payment_method}`,
  );
  check(
    'fazla ödemeyi alan taksitin yöntemi de işlemin yöntemidir',
    byId(updated, 502).payment_method === 'kredi-karti',
    `yöntem=${byId(updated, 502).payment_method}`,
  );
  const noMethod = commit(all, applyPayment({ entry: own, all, amount: 100, date: '2026-09-18' }).patches);
  check(
    'yöntem verilmezse kaydın kendi yöntemi korunur',
    byId(noMethod, 501).payment_method === 'nakit',
    `yöntem=${byId(noMethod, 501).payment_method}`,
  );
  check(
    'kısmi ödemede dokunulmayan taksit yöntemi değişmez',
    byId(noMethod, 502).payment_method === 'havale',
    `yöntem=${byId(noMethod, 502).payment_method}`,
  );
}

/* ------------------------------------------------------------------ */
/* 6) Geri alma tüm mahsubu geri çevirir (negatiflerle)                */
/* ------------------------------------------------------------------ */

console.log('\n6) Geri alma mahsubun değdiği her taksiti geri çevirir\n');
{
  const own = entry({ id: 601, amount: 1000, due_date: SOON });
  const next = entry({ id: 602, amount: 400, due_date: NEXT });
  const foreign = entry({ id: 603, amount: 700, due_date: NEXT, student_name: OTHER_STUDENT });
  const expense = entry({ id: 604, amount: 900, due_date: NEXT, entry_type: 'gider', title: 'Kira' });
  const all = [own, next, foreign, expense];

  const result = apply({ entry: own, all, amount: 1400, date: '2026-09-20', opId: 'op-test-1' });
  const paid = commit(all, result.patches);
  const opId = settlementOf(byId(paid, 601)).records[0]?.opId ?? '';

  check('işlem kimliği günlüğe yazılır', opId === 'op-test-1', `opId=${opId}`);
  checkMoney('geri alma öncesi ilk taksit kapalı', settlementOf(byId(paid, 601)).remaining, 0);
  checkMoney('geri alma öncesi ileri taksit kapalı', settlementOf(byId(paid, 602)).remaining, 0);

  const missing = missingRevertTargets(opId, paid);
  check('eksik kayıt yoksa geri alma engellenmez', missing.length === 0, `eksik=${missing.join(',')}`);

  const reverted = commit(paid, revertPayment(opId, paid));

  checkMoney('geri alma ilk taksiti geri yükler', settlementOf(byId(reverted, 601)).remaining, 1000);
  checkMoney(
    'geri alma ileri taksiti de geri yükler (hayalet ödeme kalmaz)',
    settlementOf(byId(reverted, 602)).remaining,
    400,
  );
  check(
    'geri alınan taksit "bekliyor"a döner',
    byId(reverted, 601).status === 'bekliyor' && byId(reverted, 602).status === 'bekliyor',
    `${byId(reverted, 601).status}/${byId(reverted, 602).status}`,
  );
  check(
    'geri alınan taksitte ödeme tarihi temizlenir',
    !byId(reverted, 601).paid_date && !byId(reverted, 602).paid_date,
    `${byId(reverted, 601).paid_date}/${byId(reverted, 602).paid_date}`,
  );
  check(
    'geri alınan taksitte mahsup günlüğü boşalır',
    !byId(reverted, 601).settle_log && !byId(reverted, 602).settle_log,
    `${byId(reverted, 601).settle_log}/${byId(reverted, 602).settle_log}`,
  );
  check(
    'başka öğrencinin taksiti geri almadan etkilenmez',
    settlementOf(byId(reverted, 603)).paid === 0,
    stateOf(byId(reverted, 603)),
  );
  check(
    'gider kalemi mahsup günlüğü taşımaz',
    settlementOf(byId(reverted, 604)).paid === 0,
    stateOf(byId(reverted, 604)),
  );
  check('aynı işlem ikinci kez geri alınamaz', revertPayment(opId, reverted).length === 0, 'ikinci çağrı boş değil');

  const partial = apply({ entry: own, all: [own, next], amount: 300, date: '2026-09-20', opId: 'op-test-2' });
  const partialPaid = commit([own, next], partial.patches);
  const partialReverted = commit(partialPaid, revertPayment('op-test-2', partialPaid));
  checkMoney('kısmi ödeme geri alınınca bakiye tam tutara döner', settlementOf(byId(partialReverted, 601)).remaining, 1000);
  check(
    'kısmi ödeme geri alınınca fazla satır kapanmaz',
    settlementOf(byId(partialReverted, 602)).paid === 0,
    stateOf(byId(partialReverted, 602)),
  );
}

/* ------------------------------------------------------------------ */
/* 7) Eksik kurum listesinde geri alma durdurulur                      */
/* ------------------------------------------------------------------ */

console.log('\n7) Eksik liste geri almayı durdurur\n');
{
  const own = entry({ id: 701, amount: 1000, due_date: SOON });
  const next = entry({ id: 702, amount: 400, due_date: NEXT });
  const all = [own, next];
  const result = apply({ entry: own, all, amount: 1400, date: '2026-09-20', opId: 'op-test-3' });
  const paid = commit(all, result.patches);

  const incomplete = paid.filter((item) => Number(item.id) !== 702);
  const missing = missingRevertTargets('op-test-3', incomplete);
  check(
    'eksik listede dağıtım hedefi tespit edilir',
    missing.length === 1 && missing[0] === 702,
    `eksik=${missing.join(',')}`,
  );
  const blind = commit(incomplete, revertPayment('op-test-3', incomplete));
  checkMoney(
    'eksik listeyle geri alma hayalet ödeme bırakır (durdurulması gerekir)',
    settlementOf(byId(blind, 701)).remaining,
    1000,
  );
  check(
    'eksik yoksa denetim temiz döner',
    missingRevertTargets('op-test-3', paid).length === 0,
    'tam listede eksik raporlandı',
  );
  check(
    'olmayan işlem kimliği için denetim boş döner',
    missingRevertTargets('op-yok', paid).length === 0,
    'olmayan işlem eksik raporladı',
  );
}

/* ------------------------------------------------------------------ */
/* 8) Kısmi ödemede vade geçmişse gecikti kalır                        */
/* ------------------------------------------------------------------ */

console.log('\n8) Kısmi ödeme vadesi geçmiş taksiti kapatmaz\n');
{
  const taksit = entry({ id: 801, amount: 1000, due_date: PAST });
  const result = apply({ entry: taksit, all: [taksit], amount: 250, date: '2026-09-20' });
  const after = byId(commit([taksit], result.patches), 801);

  check('vadesi geçmiş kısmi taksit "gecikti" kalır', settledStatus(after) === 'gecikti', settledStatus(after));
  checkMoney('kısmi ödemede kalan bakiye gecikmiş alacak sayılır', summarizeSettlement([after]).overdueRemaining, 750);
  const stale = { ...entry({ id: 802, amount: 1000, due_date: SOON }), status: 'bekliyor' as const };
  const stalePaid = byId(commit([stale], applyPayment({ entry: stale, all: [stale], amount: 1000 }).patches), 802);
  check('durum alanı bayat kalsa da bakiye bitince ödendi sayılır', settledStatus(stalePaid) === 'odendi', settledStatus(stalePaid));
}

/* ------------------------------------------------------------------ */
/* 9) Eski kayıtlar ve günlük formatı                                  */
/* ------------------------------------------------------------------ */

console.log('\n9) Eski kayıtlar ve günlük formatı\n');
{
  const legacy = entry({ id: 901, amount: 1000, paid_amount: 600, settle_log: '' });
  const state = settlementOf(legacy);
  checkMoney('eski `paid_amount` tahsilat sayılır', state.paid, 600);
  checkMoney('eski kayıtta kalan bakiye doğru', state.remaining, 400);
  check('eski kayıt kısmi ödeme sayılır', state.count === 1, `count=${state.count}`);

  /*
    1000 TL'lik taksite eski kayıttan 900 TL tahsil edilmiş (günlük yok).
    200 TL ödenmek istenirse taksitin kalanı yalnızca 100 TL olduğu için 100 TL
    işlenir; kalan 100 TL dağıtılacak başka taksit olmadığından avans/iade
    olarak kullanıcıya bildirilir. Buradaki iki "artık" kavramı bilinçli olarak
    ayrılır: kaydın kendi artığı (settlement.overflow) ile işlemin
    dağıtılamayan kısmı (apply.overflow) aynı şey değildir.
  */
  const both = entry({ id: 902, amount: 1000, paid_amount: 900 });
  const withLog = apply({ entry: both, all: [both], amount: 200, date: '2026-09-20' });
  const merged = byId(commit([both], withLog.patches), 902);
  checkMoney('eski tahsilat devralınır, kaybolmaz (900 + 100)', settlementOf(merged).paid, 1000);
  checkMoney('kayıt bakiyesi bitince kaydın kendi artığı kalmaz', settlementOf(merged).overflow, 0);
  checkMoney('işlemin dağıtılamayan kısmı avans olarak raporlanır', withLog.overflow, 100);
  checkMoney('dağıtılan tutar 100', withLog.applied, 100);
  check(
    'devralınan tahsilat günlüğe yazılır',
    settlementOf(merged).records.length === 2,
    `${settlementOf(merged).records.length} kayıt`,
  );
  checkMoney(
    'günlük toplamı gösterilen tahsilata eşit',
    settlementOf(merged).records.reduce((sum, item) => sum + item.amount, 0),
    1000,
  );

  /* Açılış satırı devralınan tahsilattan bir fazlasını yazsaydı bakiye yeniden doğardı. */
  const reopened = entry({ id: 903, amount: 1000, paid_amount: 400 });
  const reopenedPaid = byId(
    commit([reopened], applyPayment({ entry: reopened, all: [reopened], amount: 600, date: '2026-09-20' }).patches),
    903,
  );
  checkMoney('eski kısmi tahsilat + yeni ödeme taksiti kapatır', settlementOf(reopenedPaid).remaining, 0);
  check('günlük iki tahsilatı da taşır', settlementOf(reopenedPaid).records.length === 2, `${settlementOf(reopenedPaid).records.length} kayıt`);
  const reopenedBack = commit([reopenedPaid], revertPayment(settlementOf(reopenedPaid).records[1].opId, [reopenedPaid]));
  checkMoney(
    'geri alma yalnızca son tahsilatı düşürür',
    settlementOf(byId(reopenedBack, 903)).paid,
    400,
  );

  const roundTrip = serializeSettleLog(settlementOf(merged).records);
  const parsed = parseSettleLog(roundTrip);
  check('günlük JSON olarak yazılır ve geri okunur', parsed.length === 2, roundTrip);
  checkMoney('devralınan açılış satırı kendi tutarını taşır', recordTotal(parsed[0]), 900);
  checkMoney('yeni tahsilat satırı yalnızca kendi payını taşır', recordTotal(parsed[1]), 100);
  check('bozuk günlük sessizce yok sayılır', parseSettleLog('{bozuk').length === 0, 'bozuk metin kayıt üretti');
  check('boş günlük metni boş liste döner', serializeSettleLog([]) === '', 'boş günlük boş dönmedi');
}

/* ------------------------------------------------------------------ */
/* 10) Öğrenci özeti (ekranda gösterilen sayılar)                      */
/* ------------------------------------------------------------------ */

console.log('\n10) Öğrenci mahsup özeti\n');
{
  const first = entry({ id: 1001, amount: 1000, due_date: PAST });
  const second = entry({ id: 1002, amount: 500, due_date: NEXT });
  const third = entry({ id: 1003, amount: 300, due_date: LATER });
  const foreign = entry({ id: 1004, amount: 800, due_date: LATER, student_name: OTHER_STUDENT });
  const expense = entry({ id: 1005, amount: 500, due_date: LATER, entry_type: 'gider' });
  let all = [first, second, third, foreign, expense];

  all = commit(all, apply({ entry: first, all, amount: 400, date: '2026-09-20' }).patches);
  all = commit(all, apply({ entry: second, all, amount: 500, date: '2026-09-20' }).patches);
  const summary = summarizeSettlement(all.filter((item) => item.student_name === STUDENT));

  checkMoney('özet tahakkuk 1800', summary.total, 1800);
  checkMoney('özet tahsilat 900', summary.paid, 900);
  checkMoney('özet kalan 900', summary.remaining, 900);
  checkMoney('özet gecikmiş alacak 600', summary.overdueRemaining, 600);
  check('kısmi ödeme almış taksit 1', summary.partialCount === 1, `partial=${summary.partialCount}`);
  check('hiç ödeme almamış taksit 1', summary.unpaidCount === 1, `unpaid=${summary.unpaidCount}`);
  check(
    'başka öğrencinin taksiti özete girmez',
    !summarizeSettlement([foreign]).paid,
    'yabancı öğrenci tahsilat gösterdi',
  );
  check(
    'gider kalemi özete girmez',
    summarizeSettlement([expense]).total === 0,
    'gider tahakkuk sayıldı',
  );
}

/* ------------------------------------------------------------------ */
/* 11) Excel'den gerçek tahsilat aktarımı                              */
/* ------------------------------------------------------------------ */

console.log('\n11) Excel gerçek tahsilatı doğru karara ve doğru bakiyeye dönüşür\n');
{
  /*
    Bu bölüm saf kararı ölçer: kolon yokluğu, tavanlama, durum tutarlılığı ve
    tarih. Bunlar sessiz veri kaybı sınıfındandır — yanlış karar ekranda hata
    üretmez, yalnızca tutarları kaydırır.
  */
  const withoutColumn = accountingImportDecision({
    amount: 1000,
    paidFromFile: null,
    status: 'bekliyor',
    date: '2026-09-20',
  });
  check(
    'tahsilat kolonu yoksa dosya mahsubu değiştirmez',
    !withoutColumn.paidGiven && withoutColumn.paid === 0,
    JSON.stringify(withoutColumn),
  );

  const partial = accountingImportDecision({
    amount: 1000,
    paidFromFile: 400,
    status: 'odendi',
    date: '2026-09-20',
  });
  checkMoney('kısmi tahsilat dosyadan okunur', partial.paid, 400);
  check(
    'bakiye kalırken durum "odendi"ye yükseltilmez (veliye yanlış bilgi gitmez)',
    partial.status === 'bekliyor',
    `durum=${partial.status}`,
  );
  check('kısmi tahsilatta ödeme tarihi korunur', partial.paidDate === '2026-09-20', partial.paidDate);

  const full = accountingImportDecision({
    amount: 1000,
    paidFromFile: 1000,
    status: 'bekliyor',
    date: '2026-09-20',
  });
  check('tam tahsilat taksiti "odendi" yapar', full.status === 'odendi', `durum=${full.status}`);

  const over = accountingImportDecision({
    amount: 400,
    paidFromFile: 1500,
    status: 'odendi',
    date: '2026-09-20',
  });
  checkMoney(
    'taksidi aşan dosya tutarı taksit tutarına tavanlanır (hayalet fazla ödeme yok)',
    over.paid,
    400,
  );

  const zero = accountingImportDecision({
    amount: 1000,
    paidFromFile: 0,
    status: 'odendi',
    date: '2026-09-20',
  });
  check(
    'para alınmadıysa ödeme tarihi yazılmaz',
    zero.paid === 0 && zero.paidDate === '',
    JSON.stringify(zero),
  );

  /* Kararın ürettiği kayıt gerçekten taksite işlendiğinde bakiye doğru düşmeli. */
  const taksit = entry({ id: 1101, amount: 1000, due_date: SOON });
  const imported = {
    ...taksit,
    paid_amount: partial.paid,
    status: partial.status,
    paid_date: partial.paidDate,
  };
  checkMoney('içe aktarılan kısmi tahsilat bakiyeyi düşürür', settlementOf(imported).remaining, 600);
  check(
    'içe aktarılan kısmi tahsilat taksiti kapatmaz',
    settledStatus(imported) !== 'odendi',
    settledStatus(imported),
  );
}

/* ------------------------------------------------------------------ */
/* Sonuç                                                               */
/* ------------------------------------------------------------------ */

const total = passed + failures.length;
console.log(`\n${passed}/${total} OK`);
if (LEGACY) {
  console.log('BENCH_LEGACY_BODY=1 → eski (hatalı) davranış ölçüldü; FAIL beklenir.');
}
if (failures.length) {
  console.log('\nFAIL listesi:');
  failures.forEach((item) => console.log(` - ${item}`));
  process.exitCode = 1;
}
