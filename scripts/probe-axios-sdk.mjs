/*
  Sonda (geçici): SDK istemcisi `axios.defaults.adapter` atamasını görüyor mu?

  Bildirim kanıt betiğinin 9. ve 10. bölümleri hiç istek görmüyordu; iki olasılık
  var ve ikisi farklı düzeltme gerektirir:
    (a) adapter ataması SDK örneğine hiç geçmiyor,
    (b) SDK ayrı bir axios kopyası değerlendiriyor.
  Bu sonda ikisini ayırır; sonuç alındıktan sonra dosya silinir.
*/
import axios from 'axios';
import { createClient } from '@metagptx/web-sdk';
import { createRequire } from 'node:module';
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

let hits = 0;
const patched = async (config) => {
  hits += 1;
  return { data: { items: [] }, status: 200, statusText: 'OK', headers: {}, config };
};
axios.defaults.adapter = patched;

const client = createClient();
console.log('atama sonrası defaults.adapter aynı fonksiyon mu:', axios.defaults.adapter === patched);

const require = createRequire(import.meta.url);
const root = process.cwd();
console.log('SDK modülünün çözüldüğü yer:', path.relative(root, require.resolve('@metagptx/web-sdk')));
const sdkAxios = createRequire(require.resolve('@metagptx/web-sdk')).resolve('axios');
console.log('SDK için axios yolu:', path.relative(root, sdkAxios));
console.log('SDK axios kopyası bizimle aynı mı:', sdkAxios === require.resolve('axios'));

try {
  await client.entities.online_lessons.queryAll({ query: { school_id: 1 }, limit: 10, skip: 0 });
  console.log('SDK isteği tamamlandı, adapter isabeti =', hits);
} catch (error) {
  console.log('SDK isteği düştü:', error?.message, '| adapter isabeti =', hits);
}