/**
 * Google (platform) girişi dönüş sayfası.
 *
 * Platform, girişten sonra kullanıcıyı buraya `?token=...` ile geri gönderir.
 * Burada belirteç kaydedilir ve ardından portal oturum belirteci alınır; böylece
 * Google ile giren kullanıcı da manuel giriş yapanla aynı yetki kontrollerinden
 * geçer.
 *
 * Önemli: SDK'nın `auth.login()` çağrısı belirteci kaydettikten hemen sonra
 * sayfayı `/` adresine zorla yönlendiriyor ve portal oturum isteği yarıda
 * kesiliyordu (mobil ağlarda her denemede). Bu yüzden belirteci kendimiz
 * kaydedip yönlendirmeyi React Router ile yapıyoruz.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  GOOGLE_POPUP_MESSAGE,
  errorMessage,
  hasPlatformToken,
  savePlatformToken,
  ssoLogin,
  startGoogleLogin,
  takeReturnPath,
} from '@/lib/portalAuth';

/** Adresten platform belirtecini okur (sorgu veya hash biçiminde gelebilir). */
function readTokenFromUrl(): string {
  try {
    const fromSearch = new URLSearchParams(window.location.search).get('token');
    if (fromSearch) return fromSearch;
    const hash = window.location.hash.replace(/^#/, '');
    if (hash.includes('token=')) return new URLSearchParams(hash).get('token') ?? '';
  } catch {
    /* adres okunamazsa belirteç yok sayılır */
  }
  return '';
}

/** Belirteci adres çubuğundan temizler; geri tuşunda tekrar işlenmesini engeller. */
function cleanUrl(): void {
  try {
    window.history.replaceState(null, '', '/auth/callback');
  } catch {
    /* tarayıcı izin vermezse adres olduğu gibi kalır */
  }
}

/** Ana sekmeye girişin bittiğini bildirir; pencere modunda değilse `false`. */
function notifyOpener(): boolean {
  try {
    const opener = window.opener as Window | null;
    if (!opener || opener.closed) return false;
    opener.postMessage({ type: GOOGLE_POPUP_MESSAGE }, window.location.origin);
    window.close();
    return true;
  } catch {
    return false;
  }
}

/** Yalnızca sitenin logosu (giriş sırasında gösterilen tek görsel). */
function SiteLogo() {
  return (
    <img
      src="/assets/edusetupplus-icon.png?v=4"
      alt="EduSetupPlus"
      width={72}
      height={72}
      className="h-18 w-18 animate-pulse object-contain"
    />
  );
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const started = useRef(false);

  const finish = useCallback(async () => {
    setError('');
    const token = readTokenFromUrl();
    if (token) {
      savePlatformToken(token);
      cleanUrl();
    }

    if (!token && !hasPlatformToken()) {
      // Belirteç hiç gelmediyse giriş akışı yarıda kalmıştır; tekrar başlatılır.
      startGoogleLogin();
      return;
    }

    // Mobil ağlarda ilk istek zaman aşımına düşebiliyor; kısa bir bekleme ile
    // ikinci deneme yapılır.
    let lastError: unknown = null;
    for (let i = 0; i < 2; i += 1) {
      try {
        await ssoLogin();
        // Açılır pencerede açıldıysa ana sekmeye haber verilip pencere kapanır.
        if (notifyOpener()) return;
        navigate(takeReturnPath(), { replace: true });
        return;
      } catch (e) {
        lastError = e;
        if (i === 0) await wait(900);
      }
    }
    setError(errorMessage(lastError, 'Google ile giriş tamamlanamadı.'));
  }, [navigate]);

  useEffect(() => {
    if (started.current && attempt === 0) return;
    started.current = true;
    void finish();
  }, [finish, attempt]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md space-y-4 rounded-2xl border bg-card p-6 text-center shadow-sm">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-lg font-extrabold">Google ile giriş tamamlanamadı</h1>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          </div>
          <div className="space-y-2">
            <Button className="w-full" onClick={() => setAttempt((v) => v + 1)}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Tekrar dene
            </Button>
            <Button asChild variant="outline" className="w-full !bg-transparent">
              <Link to="/">Ana sayfaya dön</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <SiteLogo />
    </div>
  );
}