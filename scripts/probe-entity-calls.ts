/**
 * Sonda (probe): SDK'nın varlık sorgu çağrılarının adres ve gövde biçimini
 * gözlemler.
 *
 * Neden gerekli: bildirim kanıtının ilk sürümü yalnızca `portal-data` köprüsünü
 * taklit ediyordu; online ders ve rehberlik bildirimleri ise `client.entities.*`
 * üzerinden gidiyor ve bu çağrıların hangi adrese, hangi gövdeyle gittiği
 * uygulama kodunda görünmüyor. Adres biçimi tahmin edilerek yazılırsa kanıt
 * "0 bildirim" üretir ve bu sessizlik gerçek bir kusurdan ayırt edilemez.
 *
 * ÖLÇÜLEN HATA (bu sürümün nedeni)
 * --------------------------------
 * Önceki sürüm `fetch` ve `apiCall.invoke` katmanlarını dinliyordu ve **hiçbir
 * çıktı üretmedi**. Boş çıktı yanıltıcıydı: "çağrı hiç yapılmadı" değil, çağrı
 * alt katmanda düştüğü için `fetchAllPages` onu kendi `catch` bloğunda yuttu ve
 * kanıt betiği sessizce 0 kayıt gördü. Bu yüzden sonda artık `fetchAllPages`'i
 * değil, varlık uçlarını DOĞRUDAN çağırır ve ham sonucu/hatayı yazdırır.
 *
 * Bu betik hiçbir şey ölçmez; yalnızca çağrıları kaydedip yazdırır.
 */
import './node-shim';

import { client } from '@/lib/api';
import { saveToken } from '@/lib/portalAuth';

const log: string[] = [];

/*
  İki ağ katmanı birlikte dinlenir: SDK `fetch` kullanıyorsa adres + gövde,
  uygulama köprüsü (`apiCall`) kullanıyorsa istek nesnesi görünür.
*/
const g = globalThis as unknown as Record<string, unknown>;
const realFetch = globalThis.fetch.bind(globalThis);
g.fetch = async (input: unknown, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : String((input as Request)?.url ?? input);
  log.push(`FETCH URL: ${url}\n  BODY: ${String(init?.body ?? '')}`);
  return realFetch(input as RequestInfo, init);
};

const apiCall = client.apiCall as unknown as { invoke: (req: unknown) => Promise<unknown> };
apiCall.invoke = async (req: unknown) => {
  log.push(`BRIDGE: ${JSON.stringify(req)}`);
  return { data: { items: [] } };
};

/** Ham çağrı: SDK'nın kendi hatası burada görünür (kanıt betiği onu yutuyordu). */
async function probe(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    const result = await run();
    log.push(`${label} → TAMAM: ${JSON.stringify(result).slice(0, 300)}`);
  } catch (error) {
    const err = error as Error;
    log.push(`${label} → HATA: ${err?.name}: ${err?.message}`);
  }
}

async function main(): Promise<void> {
  saveToken('probe-token');

  await probe('entities.guidance_entries.queryAll', () =>
    client.entities.guidance_entries.queryAll({ query: { school_id: 1 }, limit: 5, skip: 0 }),
  );
  await probe('entities.online_lesson_participants.queryAll', () =>
    client.entities.online_lesson_participants.queryAll({
      query: { parent_email: 'veli@okul.com' },
      limit: 5,
      skip: 0,
    }),
  );
  await probe('entities.online_lessons.queryAll', () =>
    client.entities.online_lessons.queryAll({ query: {}, limit: 5, skip: 0 }),
  );

  log.push(`--- toplam kayıt: ${log.length} ---`);
  log.forEach((line) => console.log(line));
}

void main().catch((error: Error) => {
  console.log(`BEKLENMEYEN HATA: ${error?.name}: ${error?.message}`);
  console.log(error?.stack ?? '');
});