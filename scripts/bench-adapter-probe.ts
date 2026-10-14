/**
 * Sonda: axios adapter'ı derleme sonrası gerçekten devrede mi?
 *
 * Neden gerekli
 * -------------
 * Bildirim kanıt betiğinin 9. ve 10. bölümleri hiç istek görmüyordu ve doğrudan
 * yapılan varlık çağrısı `Invalid URL` ile düşüyordu. Bu, "adapter atandı" /
 * "adapter devrede" ayrımının ölçülmediği anlamına gelir: atama kodda duruyor
 * ama isteği taşımıyorsa kanıt betiği sessizce boş liste görür.
 *
 * Bu dosya yalnızca o ayrımı ölçer; başarılı olursa sonda kaldırılır.
 */
import { axiosLog, setAxiosResponder } from './node-shim';

import axios from 'axios';
import { client } from '@/lib/api';

async function main(): Promise<void> {
  console.log('adapter tipi:', typeof axios.defaults.adapter);

  setAxiosResponder(() => ({ data: { items: [] } }));

  const plain = axios.create({ baseURL: '/' });
  try {
    await plain.get('/api/v1/entities/probe/all');
    console.log('düz axios: istek geçti, log =', axiosLog.length);
  } catch (error) {
    console.log('düz axios hata:', (error as Error)?.message);
  }

  try {
    const response = await client.entities.online_lesson_participants.queryAll({
      query: { parent_email: 'veli@okul.com' },
      limit: 1000,
      skip: 0,
    });
    console.log('SDK: yanıt =', JSON.stringify(response?.data), 'log =', axiosLog.length);
  } catch (error) {
    console.log('SDK hata:', (error as Error)?.message, '| log =', axiosLog.length);
  }

  console.log(
    'gözlenen yollar:',
    JSON.stringify(axiosLog.map((r) => `${r.method} ${r.url}`)),
  );
}

void main();