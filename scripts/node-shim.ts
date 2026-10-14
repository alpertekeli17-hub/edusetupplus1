/**
 * Node ortamında tarayıcı API'lerinin karşılanması (ölçüm betikleri için).
 *
 * Neden ayrı dosya
 * ----------------
 * Uygulama modülleri `lib/api.ts` → `@metagptx/web-sdk` zincirini içe aktarır
 * ve bu paket modül yüklenirken `window`/`localStorage` erişiyor. Node'da bu
 * arayüzler olmadığı için ölçüm betiği "window is not defined" ile düşerdi.
 *
 * ESM'de içe aktarmalar bildirim sırasına göre değerlendirilir; bu modül
 * ölçüm betiğinin **ilk** importu olduğu için shim'ler diğer modüller
 * değerlendirilmeden önce kurulur.
 *
 * Burada taklit edilen şey yalnızca ortam arayüzüdür; ölçülen davranış
 * (ayrıştırma, birleştirme, silme işareti) uygulamanın gerçek kodudur.
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import axios, { type AxiosAdapter, type AxiosResponse } from 'axios';

/**
 * Ağ katmanı gözlemcisi.
 *
 * Neden `fetch` dinlemek yetmedi (ölçülen hata)
 * --------------------------------------------
 * SDK'nın varlık katmanı `fetch` değil **axios** kullanıyor ve örneği göreli
 * `baseURL: '/'` ile kuruyor (`requestInstance.get('/api/v1/entities/<ad>/all',
 * { params })`). Tarayıcı göreli adresi sayfanın kökenine göre çözer; Node'un
 * axios adapter'ı ise göreli adresle çalışamaz ve `TypeError: Invalid URL`
 * fırlatır. Bu yüzden `fetch`'i saran önceki sonda hiçbir çıktı üretmedi ve
 * "çağrı yapılmadı" gibi okundu — oysa çağrı yapılıyor, alt katmanda düşüyordu.
 *
 * Burada dinlenen katman axios adapter'ıdır: hem **gerçekten hangi adrese**
 * gidildiği görünür, hem de senaryo yanıtı verilerek uygulamanın kendi okuma
 * fonksiyonları gerçek veriyle koşturulabilir. Ölçülen iş mantığı yine
 * uygulamanın kendi kodudur; yalnızca ortam ve sunucu yanıtı taklit edilir.
 *
 * Adapter, `@/lib/api` (dolayısıyla `axios.create`) değerlendirilmeden **önce**
 * kurulur: `axios.create` varsayılanları çağrı anında kopyaladığı için adapter
 * sonradan atanırsa örnek onu görmez. Bu yüzden shim ilk import olmalıdır.
 */
export interface ObservedRequest {
  method: string;
  /** `baseURL` + `url` birleşimi: isteğin gittiği gerçek yol. */
  url: string;
  /** SDK'nın kurduğu ham parçalar (aynı kalıbın doğrulanması için). */
  baseURL: string;
  rawUrl: string;
  /** Sorgu parametreleri (SDK `query` alanını JSON metni olarak taşır). */
  params: Record<string, unknown>;
  /** Gövde (create/update çağrılarında). */
  data: unknown;
}

/** Yakalanan tüm istekler (sıra korunur). */
export const axiosLog: ObservedRequest[] = [];

type Responder = (request: ObservedRequest) => unknown | undefined;

let responder: Responder | null = null;

/**
 * Ağ yanıtlarını senaryoya göre üreten fonksiyonu ayarlar.
 *
 * `undefined` dönen istek "ağ hatası" ile düşer. Bu bilinçli bir sertliktir:
 * tanımsız bir isteği sessizce boş liste ile yanıtlamak, kanıt betiğinin
 * "0 kayıt" görmesine ve gerçek bir kusurun gizlenmesine yol açardı.
 */
export function setAxiosResponder(fn: Responder | null): void {
  responder = fn;
}

/** Göreli adresi kökene göre birleştirir (tarayıcı davranışının eşdeğeri). */
function joinUrl(base: string, url: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  const left = (base || '').replace(/\/+$/, '');
  const right = (url || '').replace(/^\/+/, '');
  if (!left) return `/${right}`;
  return `${left}/${right}`;
}

const benchAdapter: AxiosAdapter = async (config) => {
  const request: ObservedRequest = {
    method: String(config.method ?? 'get').toUpperCase(),
    baseURL: String(config.baseURL ?? ''),
    rawUrl: String(config.url ?? ''),
    url: joinUrl(String(config.baseURL ?? ''), String(config.url ?? '')),
    params: (config.params ?? {}) as Record<string, unknown>,
    data: config.data,
  };
  axiosLog.push(request);

  const body = responder?.(request);
  if (body === undefined) {
    throw new Error(`bench: tanimsiz istek ${request.method} ${request.url}`);
  }

  return {
    data: body,
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  } as AxiosResponse;
};

/** localStorage sözleşmesini karşılayan bellek içi depo. */
function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

/**
 * Göreli adresleri çözebilen `fetch`.
 *
 * Neden gerekli (ölçülen hata)
 * ----------------------------
 * Sonda betiği ilk koşularda hiçbir çıktı üretmedi; doğrudan varlık ucu
 * çağrıldığında gerçek neden göründü: `TypeError: Invalid URL`. Sebep şu ki SDK
 * istekleri **göreli** adresle (`/api/v1/entities/...`) kuruyor, tarayıcı bunları
 * sayfanın kökenine göre çözer, Node'un `fetch`'i ise göreli adresi reddeder.
 *
 * Bu fark sessiz bir tuzağa yol açıyordu: çağrı `fetchAllPages`'in `catch` bloğunda
 * yutulduğu için kanıt betiği "0 bildirim" görüyor ve bu, gerçek bir kusurdan
 * ayırt edilemiyordu. Burada yalnızca **ortam** davranışı tarayıcıya uydurulur;
 * ölçülen iş mantığı yine uygulamanın kendi kodudur.
 */
function installFetchResolver(origin: string): void {
  const g = globalThis as unknown as Record<string, unknown>;
  const nativeFetch = globalThis.fetch.bind(globalThis);

  g.fetch = (input: unknown, init?: RequestInit) => {
    if (typeof input === 'string' && !/^[a-z][a-z0-9+.-]*:/i.test(input)) {
      return nativeFetch(new URL(input, origin).toString(), init);
    }
    return nativeFetch(input as RequestInfo, init);
  };
}

/**
 * SDK'nın **kendi** axios kopyasını da yamalar.
 *
 * Neden gerekli (ölçülen hata)
 * ---------------------------
 * Sonda ile ölçüldü: SDK, `node_modules/.pnpm/axios@1.19.0/...` yolundaki ayrı
 * bir axios kopyasını değerlendiriyor, bizim yamaladığımız kopya ise başka bir
 * örnek. `axios.defaults.adapter` ataması yalnızca kendi kopyamızı etkilediği
 * için SDK istekleri hiç yakalanmıyor, istekler `Invalid URL` ile düşüyordu.
 *
 * İkinci ayrım (ikinci sonda): o paketin **CJS** girdisini yamamak da yetmedi.
 * Paket dışa aktarım haritası `default` olarak `index.js` (ESM) veriyor ve SDK
 * bu ESM girdisini yüklediği için CJS kopyasındaki varsayılanlar ayrı bir nesne
 * olarak kalıyordu. Ölçüm: CJS + ESM girdileri birlikte yamandığında gerçek SDK
 * isteği yakalandı (`isabet = 1`).
 *
 * Bu sessiz bir tuzaktı: yakalanmayan istek `fetchAllPages` içinde yutulduğu
 * için kanıt betiği "0 kayıt" görüyor ve bu, gerçek bir kusurdan ayırt
 * edilemiyordu.
 *
 * Yalnızca **ortam** katmanı taklit edilir; ölçülen iş mantığı yine uygulamanın
 * kendi kodudur.
 */
async function patchSdkAxiosCopy(adapter: AxiosAdapter): Promise<void> {
  const localRequire = createRequire(import.meta.url);
  // SDK'nın giriş dosyasından çözümlemek, onun gördüğü kopyayı verir.
  const sdkRequire = createRequire(localRequire.resolve('@metagptx/web-sdk'));

  // Aday girdiler: SDK'nın `require` çözümü, ESM girişi ve tarayıcı paketi.
  const candidates = new Set<string>();
  try {
    candidates.add(sdkRequire.resolve('axios'));
  } catch {
    /* çözülemezse diğer adaylar denenir */
  }
  try {
    const packageRoot = packageRootOf(sdkRequire.resolve('axios'));
    candidates.add(path.join(packageRoot, 'index.js'));
    candidates.add(path.join(packageRoot, 'dist', 'esm', 'axios.js'));
  } catch {
    /* paket kökü bulunamazsa yalnızca çözülen girdi denenir */
  }

  for (const candidate of candidates) {
    try {
      // ESM girdisi `require` ile yüklenemez; dosya adresiyle içe aktarılır.
      const module_ = (await import(pathToFileURL(candidate).href)) as {
        default?: { defaults?: { adapter?: unknown } };
        defaults?: { adapter?: unknown };
      };
      const instance = module_.default ?? module_;
      if (instance?.defaults) instance.defaults.adapter = adapter;
    } catch {
      /*
        Tek bir aday yüklenemezse diğerleri denenir: biri yamalanmazsa SDK
        istekleri yakalanmaz ve kanıt betiği sessizce boş liste görürdü.
      */
    }
  }
}

/** `package.json`'ı yukarı doğru arayarak gerçek paket kökünü bulur. */
function packageRootOf(startFile: string): string {
  let dir = path.dirname(startFile);
  for (let i = 0; i < 6; i += 1) {
    if (fileExists(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.dirname(startFile);
}

/*
  Ölçülen tuzak: burada önce `require('node:fs')` kullanılıyordu. ESM modülünde
  `require` tanımlı olmadığı için çağrı `ReferenceError` atıyor ve hata içteki
  `catch` tarafından yutulduğu için fonksiyon **her zaman false** dönüyordu.
  Sonucu sessizdi: `packageRootOf` paket kökünü hiç bulamıyor, adaylar
  `.../axios/dist/node/index.js` gibi var olmayan yollara düşüyor ve ESM girdisi
  yamanmıyordu — yani betik çalışır ama SDK istekleri yakalanmaz.
*/
function fileExists(target: string): boolean {
  return existsSync(target);
}

async function install(): Promise<void> {
  const g = globalThis as unknown as Record<string, unknown>;

  /*
    Adapter **burada** atanır, ölçüm betiğinde değil: `@/lib/api` içindeki
    `axios.create()` varsayılanları çağrı anında kopyalar, dolayısıyla adapter
    SDK örneği kurulduktan sonra atanırsa örnek onu hiç görmez ve istekler eski
    (göreli adresle düşen) adapter'a giderdi. Shim ilk import olduğu için bu
    atama her zaman örnekten önce çalışır.

    Yama `await` ile tamamlanır: SDK'nın kopyası ESM girdisinden geldiği için
    yalnızca içe aktarma ile yamanabilir ve sıra bozulursa `axios.create` onu
    görmeden örnek kurulur.
  */
  axios.defaults.adapter = benchAdapter;
  // SDK ayrı bir axios kopyası (ESM girdisi) kullandığı için o kopya da yamanır.
  await patchSdkAxiosCopy(benchAdapter);

  if (!g.localStorage) g.localStorage = makeStorage();

  if (!g.window) {
    const origin = 'http://127.0.0.1:5173';
    installFetchResolver(origin);
    const fakeWindow: Record<string, unknown> = {
      location: {
        origin,
        href: `${origin}/`,
        search: '',
        pathname: '/',
        protocol: 'http:',
        hash: '',
      },
      origin,
      name: '',
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      postMessage: () => undefined,
    };
    // `window.self !== window.top` kontrolü güvenli biçimde false dönmelidir.
    fakeWindow.self = fakeWindow;
    fakeWindow.top = fakeWindow;
    fakeWindow.window = fakeWindow;
    g.window = fakeWindow;
  }
}

/*
  Yama **await edilir**: SDK'nın kopyası ESM girdisinden geldiği için yalnızca
  dinamik içe aktarma ile yamanabilir ve await edilmezse sıra bozulur — ölçüm
  betiği `createClient()`'ı çağırdığında yama hâlâ bekliyor olabilir, istekler
  yakalanmaz ve kanıt yanlışlıkla "0 kayıt" görür.
  ESM'de içe aktarma, modül değerlendirmesi (top-level await dahil) bitmeden
  tamamlanmaz; bu yüzden sıra garantidir.
*/
await install();

export {};
