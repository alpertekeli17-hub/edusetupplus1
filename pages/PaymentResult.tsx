/**
 * Ödeme sonucu sayfası (iyzico).
 *
 * iyzico ödeme sayfası, sonucu backend callback ucuna POST eder; backend de bu
 * adrese `token` ile yönlendirir. Sayfa hiçbir zaman kendi başına "ödeme
 * başarılı" demez; durumu sunucudaki doğrulama ucundan okur. Plan ve öğrenci
 * sınırı yalnızca sunucu `paid` döndüğünde gösterilir.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SiteLayout from '@/components/SiteLayout';
import { purchaseErrorMessage, verifyPayment, type PaymentVerification } from '@/lib/purchase';

export default function PaymentResultPage() {
  const [params] = useSearchParams();
  // Eski Stripe bağlantılarıyla gelen kullanıcılar da kırılmasın diye iki
  // parametre adı da kabul edilir.
  const token = (params.get('token') || params.get('session_id') || '').trim();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PaymentVerification | null>(null);

  const check = useCallback(async () => {
    if (!token) {
      setError('Ödeme kaydı bulunamadı. Lütfen satın alma adımını yeniden başlatın.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      setResult(await verifyPayment(token));
    } catch (e) {
      setError(purchaseErrorMessage(e, 'Ödeme durumu doğrulanamadı.'));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void check();
  }, [check]);

  const paid = result?.status === 'paid';

  return (
    <SiteLayout>
      <section className="mx-auto max-w-2xl">
        <div className="surface p-6 sm:p-8">
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Ödemeniz doğrulanıyor...</p>
            </div>
          ) : error ? (
            <div className="space-y-5">
              <span className="icon-tile icon-tile-md bg-destructive/10 text-destructive">
                <AlertTriangle className="h-5 w-5" />
              </span>
              <div>
                <h1 className="font-display text-2xl font-bold tracking-tight">
                  Ödeme durumu okunamadı
                </h1>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{error}</p>
              </div>
              <div className="flex flex-wrap gap-2.5">
                <Button onClick={() => void check()}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Yeniden dene
                </Button>
                <Button asChild variant="outline">
                  <Link to="/">Ana sayfaya dön</Link>
                </Button>
              </div>
            </div>
          ) : paid ? (
            <div className="space-y-5">
              <span className="icon-tile icon-tile-md bg-emerald-500/10 text-emerald-600">
                <CheckCircle2 className="h-5 w-5" />
              </span>
              <div>
                <h1 className="font-display text-2xl font-bold tracking-tight">
                  Ödemeniz alındı, kurum kaydınız onaya düştü
                </h1>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {result?.plan_label} planı {result?.school_name} için kaydedildi ve platform
                  yönetimine iletildi. Kurumunuz, platform yöneticisi etkinleştirme adımını
                  tamamladığında kullanıma açılır. Yönetici girişiniz {result?.contact_email}{' '}
                  adresine bağlıdır.
                </p>
              </div>

              <dl className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-border bg-muted/40 p-4">
                  <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Sipariş numarası
                  </dt>
                  <dd className="mt-1 text-sm font-semibold">{result?.order_code}</dd>
                </div>
                <div className="rounded-xl border border-border bg-muted/40 p-4">
                  <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Ödenen tutar
                  </dt>
                  <dd className="mt-1 text-sm font-semibold">
                    {(result?.amount_try ?? 0).toLocaleString('tr-TR')} TL
                  </dd>
                </div>
                <div className="rounded-xl border border-border bg-muted/40 p-4">
                  <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Öğrenci sınırı
                  </dt>
                  <dd className="mt-1 text-sm font-semibold">
                    {(result?.student_limit ?? 0).toLocaleString('tr-TR')} öğrenci
                  </dd>
                </div>
                <div className="rounded-xl border border-border bg-muted/40 p-4">
                  <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Yönetici girişi
                  </dt>
                  <dd className="mt-1 text-sm font-semibold">{result?.contact_email || '—'}</dd>
                </div>
              </dl>

              <p className="rounded-xl border border-border bg-background p-4 text-xs leading-relaxed text-muted-foreground">
                Kurumunuz etkinleştirildikten sonra yönetici hesabınız için belirlenen e-posta ve
                şifreyle giriş yapabilirsiniz. Giriş şifresi platform yöneticisi tarafından
                belirlenir ve ilk girişte kendi şifrenizi oluşturmanız istenir. Şifrenizi
                bilmiyorsanız platform yöneticisinden yenilemesini talep edin.
              </p>

              <div className="flex flex-wrap gap-2.5">
                <Button asChild>
                  <Link to="/">Girişe git</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/iletisim">Destek talebi oluştur</Link>
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <span className="icon-tile icon-tile-md bg-amber-500/10 text-amber-600">
                <Clock className="h-5 w-5" />
              </span>
              <div>
                <h1 className="font-display text-2xl font-bold tracking-tight">
                  {result?.status === 'cancelled'
                    ? 'Ödeme tamamlanmadı'
                    : 'Ödemeniz henüz onaylanmadı'}
                </h1>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {result?.message ||
                    (result?.status === 'cancelled'
                      ? 'Ödeme bankanız tarafından tamamlanmadı veya işlem iptal edildi. Dilerseniz satın alma adımını yeniden başlatabilirsiniz.'
                      : 'Bankanız 3D Secure onayını henüz tamamlamamış olabilir. Bir dakika sonra durumu yeniden sorgulayın.')}
                </p>
              </div>
              <div className="flex flex-wrap gap-2.5">
                <Button onClick={() => void check()}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Durumu yenile
                </Button>
                <Button asChild variant="outline">
                  <Link to="/">Planlara dön</Link>
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>
    </SiteLayout>
  );
}