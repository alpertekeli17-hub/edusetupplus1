/*
  Sonda (geçici): SDK hangi axios dosyasını yüklüyor ve yama oraya ulaşıyor mu?

  Ölçülen durum: `axios.defaults.adapter` yaması SDK isteklerine geçmiyor.
  İki olası neden var:
    (a) SDK ayrı bir axios **sürümü** kullanıyor (.pnpm/axios@1.19.0),
    (b) aynı paketin **ESM** girdisini yüklerken yamamız CJS girdisine gitti.
  Bu sonda ikisini ayırır: önce paketin dışa aktarım haritası okunur, sonra hem
  CJS hem ESM girdisi yamanıp gerçek bir SDK isteğiyle isabet ölçülür.
*/
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};
globalThis.window = {
  location: {
    origin: 'http://127.0.0.1:5173',
    href: 'http://127.0.0.1:5173/',
    search: '',
    pathname: '/',
    protocol: 'http:',
    hash: '',
  },
  addEventListener: () => {},
  removeEventListener: () => {},
  name: '',
};

const localRequire = createRequire(import.meta.url);
const sdkPath = localRequire.resolve('@metagptx/web-sdk');
const sdkRequire = createRequire(sdkPath);
const cjsPath = sdkRequire.resolve('axios');

/** `package.json`'ı yukarı doğru arayarak gerçek paket kökünü bulur. */
function packageRootOf(startFile) {
  let dir = path.dirname(startFile);
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.dirname(startFile);
}

const pkgDir = packageRootOf(cjsPath);

const pkg = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
console.log('SDK axios sürümü:', pkg.version);
console.log('exports:', JSON.stringify(pkg.exports));

const candidates = [cjsPath];
const rootIndex = path.join(pkgDir, 'index.js');
if (existsSync(rootIndex)) candidates.push(rootIndex);
const esmPath = path.join(pkgDir, 'dist', 'esm', 'axios.js');
if (existsSync(esmPath)) candidates.push(esmPath);

let hits = 0;
const spy = async (config) => {
  hits += 1;
  return { data: { items: [] }, status: 200, statusText: 'OK', headers: {}, config };
};

for (const candidate of candidates) {
  try {
    const mod = await import(`file://${candidate}`);
    const instance = mod.default ?? mod;
    if (instance?.defaults) {
      instance.defaults.adapter = spy;
      console.log('yamalandı:', path.relative(pkgDir, candidate));
    }
  } catch (error) {
    console.log('yüklenemedi:', path.relative(pkgDir, candidate), error.message);
  }
}

const { createClient } = await import('@metagptx/web-sdk');

try {
  await createClient().entities.online_lessons.queryAll({ limit: 5, skip: 0 });
  console.log('SDK isteği tamamlandı, isabet =', hits);
} catch (error) {
  console.log('SDK isteği düştü:', error.message, '| isabet =', hits);
}