/**
 * Mağaza: ürün kataloğu, fiyatlar ve sepet.
 *
 * iyzico üye iş yeri koşulu gereği satılan ürünler, birim fiyatları ve sepet
 * yapısı bu sayfada görünür durumdadır. Sepet satırlarının tutarı istemcide
 * gösterim amacıyla hesaplanır; ödemeye esas tutar her zaman sunucudaki
 * `quote_cart` ve `create_payment_session` uçlarından gelir. Böylece tarayıcıda
 * yapılan bir değişiklik ödeme tutarını etkileyemez.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  Check,
  Loader2,
  Minus,
  Plus,
  ShieldCheck,
  ShoppingCart,
  Trash2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import SiteLayout from '@/components/SiteLayout';
import PurchaseDialog from '@/components/PurchaseDialog';
import { PaymentAssuranceStrip } from '@/components/PaymentBadges';
import {
  clearCart,
  fetchProducts,
  formatTRY,
  loadCart,
  purchaseErrorMessage,
  quoteCart,
  saveCart,
  type CartItemInput,
  type CartQuote,
  type StoreProduct,
} from '@/lib/purchase';

/** Ürün grubu başlıkları: vitrin okunabilir bloklara ayrılır. */
const GROUP_ORDER = ['Yıllık Lisans', 'Kontenjan Paketi', 'Süre Paketi', 'Hizmet'];

const GROUP_TINTS: Record<string, string> = {
  'Yıllık Lisans': 'tint-violet',
  'Kontenjan Paketi': 'tint-sky',
  'Süre Paketi': 'tint-indigo',
  Hizmet: 'tint-emerald',
};

const GROUP_NOTES: Record<string, string> = {
  'Yıllık Lisans':
    'Portal erişiminin temeli. Sepette en fazla bir lisans paketi bulunabilir ve her satın alma bir lisans içermek zorundadır.',
  'Kontenjan Paketi': 'Lisans kontenjanınız yetmezse öğrenci ve personel kapasitesini artırır.',
  'Süre Paketi': 'Lisans süresini satın alma anından itibaren uzatır.',
  Hizmet: 'Kurulum, veri aktarımı ve personel eğitimi gibi tek seferlik hizmetler.',
};

export default function StorePage() {
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [cart, setCart] = useState<CartItemInput[]>(() => loadCart());
  const [quote, setQuote] = useState<CartQuote | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [quoting, setQuoting] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      setProducts(await fetchProducts());
    } catch (error) {
      setLoadError(purchaseErrorMessage(error, 'Ürünler yüklenemedi. Lütfen sayfayı yenileyin.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  // Sepet her değiştiğinde tarayıcıya yazılır; sayfa yenilense de korunur.
  useEffect(() => {
    saveCart(cart);
  }, [cart]);

  const bySku = useMemo(() => {
    const map = new Map<string, StoreProduct>();
    products.forEach((product) => map.set(product.sku, product));
    return map;
  }, [products]);

  // Katalogda artık bulunmayan kalemler sepetten düşülür.
  useEffect(() => {
    if (products.length === 0) return;
    setCart((prev) => {
      const cleaned = prev.filter((item) => bySku.has(item.sku));
      return cleaned.length === prev.length ? prev : cleaned;
    });
  }, [products.length, bySku]);

  const cartKey = useMemo(() => cart.map((i) => `${i.sku}:${i.quantity}`).join('|'), [cart]);

  const refreshQuote = useCallback(async () => {
    if (cart.length === 0) {
      setQuote(null);
      setQuoteError('');
      return;
    }
    setQuoting(true);
    setQuoteError('');
    try {
      setQuote(await quoteCart(cart));
    } catch (error) {
      setQuote(null);
      setQuoteError(purchaseErrorMessage(error, 'Sepet tutarı hesaplanamadı.'));
    } finally {
      setQuoting(false);
    }
    // cartKey değişimi tetikleyicidir; `cart` referansı her render değişebilir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartKey]);

  useEffect(() => {
    void refreshQuote();
  }, [refreshQuote]);

  const quantityOf = (sku: string) => cart.find((item) => item.sku === sku)?.quantity ?? 0;

  const addToCart = (product: StoreProduct) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.sku === product.sku);
      const max = Math.max(1, product.max_quantity || 1);

      // Lisans paketi tek olmalı: yeni lisans seçilirse eskisi değiştirilir.
      const base =
        product.kind === 'license'
          ? prev.filter((item) => bySku.get(item.sku)?.kind !== 'license')
          : prev;

      if (existing && product.kind !== 'license') {
        if (existing.quantity >= max) {
          toast.error(`${product.name} için en fazla ${max} adet seçebilirsiniz.`);
          return prev;
        }
        return base.map((item) =>
          item.sku === product.sku ? { ...item, quantity: item.quantity + 1 } : item,
        );
      }

      if (product.kind === 'license' && existing) {
        toast.info('Bu lisans zaten sepetinizde.');
        return prev;
      }

      toast.success(`${product.name} sepete eklendi.`);
      return [...base, { sku: product.sku, quantity: 1 }];
    });
  };

  const changeQuantity = (sku: string, delta: number) => {
    const product = bySku.get(sku);
    const max = Math.max(1, product?.max_quantity || 1);
    setCart((prev) =>
      prev.flatMap((item) => {
        if (item.sku !== sku) return [item];
        const next = item.quantity + delta;
        if (next < 1) return [];
        if (next > max) {
          toast.error(`En fazla ${max} adet seçebilirsiniz.`);
          return [item];
        }
        return [{ ...item, quantity: next }];
      }),
    );
  };

  const removeItem = (sku: string) => setCart((prev) => prev.filter((i) => i.sku !== sku));

  const grouped = useMemo(() => {
    const map = new Map<string, StoreProduct[]>();
    products.forEach((product) => {
      const list = map.get(product.category) || [];
      list.push(product);
      map.set(product.category, list);
    });
    return GROUP_ORDER.filter((group) => map.has(group)).map((group) => ({
      group,
      items: map.get(group) as StoreProduct[],
    }));
  }, [products]);

  const hasLicense = cart.some((item) => bySku.get(item.sku)?.kind === 'license');
  const localTotal = cart.reduce((sum, item) => {
    const product = bySku.get(item.sku);
    return sum + (product ? product.price_try * item.quantity : 0);
  }, 0);
  const displayTotal = quote ? quote.total_try : localTotal;
  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <SiteLayout wide>
      <section className="surface tint-rail tint-violet p-6 sm:p-8">
        <span className="chip">Mağaza</span>
        <h1 className="mt-3.5 font-display text-3xl font-bold tracking-tight sm:text-4xl">
          Ürünler, fiyatlar ve sepet
        </h1>
        <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Kurumunuz için yıllık lisansı seçin, ihtiyaç duyarsanız kontenjan, süre ve hizmet
          paketlerini ekleyin. Sepet toplamı ödeme öncesinde sunucumuzda yeniden hesaplanır ve
          ödeme, Türkiye’de lisanslı iyzico altyapısında 3D Secure ile alınır. Tüm fiyatlar Türk
          Lirası ve KDV dahildir.
        </p>
        {/*
          Ürün akışı statik bir dosya (public/urunler.xml) olduğu için SPA
          yönlendirmesi değil, native bağlantı kullanılır.
        */}
        <p className="mt-4 text-xs text-muted-foreground">
          Fiyat karşılaştırma siteleri ve ürün kataloğu sistemleri için XML ürün akışı:{' '}
          <a
            href="/urunler.xml"
            className="font-semibold text-primary hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            /urunler.xml
          </a>
        </p>
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-10">
          {loading ? (
            <div className="surface flex items-center gap-3 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Ürünler yükleniyor...
            </div>
          ) : loadError ? (
            <div className="surface space-y-3 p-6">
              <p className="text-sm text-destructive">{loadError}</p>
              <Button variant="outline" size="sm" onClick={() => void loadProducts()}>
                Tekrar dene
              </Button>
            </div>
          ) : (
            grouped.map(({ group, items }) => (
              <section key={group}>
                <h2 className="font-display text-2xl font-bold tracking-tight">{group}</h2>
                <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
                  {GROUP_NOTES[group] || ''}
                </p>

                <div
                  className={`mt-5 grid gap-3 ${
                    group === 'Yıllık Lisans' ? 'lg:grid-cols-3' : 'sm:grid-cols-2'
                  }`}
                >
                  {items.map((product) => {
                    const inCart = quantityOf(product.sku);
                    return (
                      <article
                        key={product.sku}
                        // XML ürün akışındaki bağlantı bu çıpaya gelir; kimlik
                        // `sku` ile birebir aynı olmalı, yoksa bağlantı kırılır.
                        id={product.sku}
                        className={`surface tint-rail flex h-full flex-col scroll-mt-24 p-5 ${
                          GROUP_TINTS[group] || 'tint-sky'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <span
                            className="chip"
                            style={{
                              borderColor: 'hsl(var(--tint) / 0.3)',
                              backgroundColor: 'hsl(var(--tint) / 0.12)',
                              color: 'hsl(var(--tint-ink))',
                            }}
                          >
                            {product.category}
                          </span>
                          {inCart > 0 ? (
                            <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-600">
                              <BadgeCheck className="h-3.5 w-3.5" />
                              Sepette {inCart}
                            </span>
                          ) : null}
                        </div>

                        <h3 className="mt-3.5 text-[15px] font-bold leading-snug">
                          {product.name}
                        </h3>
                        <p className="mt-2 font-display text-3xl font-bold tracking-tight">
                          {formatTRY(product.price_try)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {product.kind === 'license'
                            ? `Yıllık lisans · ${product.student_limit.toLocaleString('tr-TR')} öğrenciye kadar`
                            : 'Birim fiyat · KDV dahil'}
                        </p>

                        <p className="mt-3.5 text-xs leading-relaxed text-muted-foreground">
                          {product.description}
                        </p>

                        {product.features.length > 0 ? (
                          <ul className="mt-4 flex-1 space-y-2 text-xs">
                            {product.features.map((line) => (
                              <li key={line} className="flex items-start gap-2">
                                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                                <span className="text-muted-foreground">{line}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className="flex-1" />
                        )}

                        <Button
                          className="mt-5"
                          variant={product.kind === 'license' ? 'default' : 'outline'}
                          onClick={() => addToCart(product)}
                        >
                          <ShoppingCart className="mr-1.5 h-4 w-4" />
                          Sepete ekle
                        </Button>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>

        {/* Sepet: masaüstünde sayfa boyunca sabit kalır. */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="surface p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-[15px] font-bold">
                <ShoppingCart className="h-4 w-4" />
                Sepetim
              </h2>
              <span className="chip">{itemCount} kalem</span>
            </div>

            {cart.length === 0 ? (
              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                Sepetiniz boş. Önce bir yıllık lisans paketi ekleyin; ardından dilerseniz kontenjan,
                süre ve hizmet paketleriyle genişletin.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {cart.map((item) => {
                  const product = bySku.get(item.sku);
                  if (!product) return null;
                  const isLicense = product.kind === 'license';
                  return (
                    <div key={item.sku} className="rounded-xl border border-border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 text-xs font-bold leading-snug">{product.name}</p>
                        <button
                          type="button"
                          aria-label={`${product.name} kalemini sepetten çıkar`}
                          className="rounded-md p-1 text-muted-foreground transition-colors hover:text-destructive"
                          onClick={() => removeItem(item.sku)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <div className="mt-2.5 flex items-center justify-between gap-2">
                        {isLicense ? (
                          <span className="text-[11px] text-muted-foreground">1 adet</span>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <Button
                              size="icon"
                              variant="outline"
                              className="h-7 w-7"
                              aria-label="Adet azalt"
                              onClick={() => changeQuantity(item.sku, -1)}
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </Button>
                            <span className="w-7 text-center text-xs font-bold tabular-nums">
                              {item.quantity}
                            </span>
                            <Button
                              size="icon"
                              variant="outline"
                              className="h-7 w-7"
                              aria-label="Adet artır"
                              onClick={() => changeQuantity(item.sku, 1)}
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                        <span className="text-xs font-bold tabular-nums">
                          {formatTRY(product.price_try * item.quantity)}
                        </span>
                      </div>
                    </div>
                  );
                })}

                <div className="flex items-center justify-between border-t border-border pt-3 text-base font-bold">
                  <span>Toplam</span>
                  <span className="flex items-center gap-2 tabular-nums">
                    {quoting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    {formatTRY(displayTotal)}
                  </span>
                </div>

                {quoteError ? (
                  <p className="text-[11px] leading-relaxed text-destructive">{quoteError}</p>
                ) : (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Tutar sunucumuzdaki ürün kataloğundan doğrulanır. KDV dahildir.
                  </p>
                )}

                {!hasLicense ? (
                  <p className="rounded-lg border border-border bg-muted/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                    Ödemeye geçmek için sepetinize bir yıllık lisans paketi eklemelisiniz.
                  </p>
                ) : null}

                {quote ? (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Tanımlanacak haklar: {quote.plan_label} lisansı ·{' '}
                    {quote.student_limit.toLocaleString('tr-TR')} öğrenci ·{' '}
                    {quote.seat_limit.toLocaleString('tr-TR')} personel hesabı · {quote.valid_days}{' '}
                    gün.
                  </p>
                ) : null}

                <Button
                  className="w-full"
                  disabled={!hasLicense || quoting || !quote}
                  onClick={() => setCheckoutOpen(true)}
                >
                  Ödemeye geç
                </Button>

                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setCart([]);
                    clearCart();
                  }}
                >
                  Sepeti boşalt
                </Button>
              </div>
            )}

            {/*
              Ödeme altyapısı ve kabul edilen kart markaları sepetin hemen
              altında gösteriliyor: kullanıcı ödemeye geçmeden önce hangi
              altyapının kullanıldığını görmeli.
            */}
            <div className="mt-4">
              <PaymentAssuranceStrip compact />
            </div>

            <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
              Satın alma öncesinde{' '}
              <Link to="/mesafeli-satis" className="font-semibold text-primary hover:underline">
                Mesafeli Satış Sözleşmesi
              </Link>
              ,{' '}
              <Link to="/teslimat-ve-iade" className="font-semibold text-primary hover:underline">
                Teslimat ve İade Şartları
              </Link>{' '}
              ve{' '}
              <Link to="/gizlilik" className="font-semibold text-primary hover:underline">
                Gizlilik Sözleşmesi
              </Link>{' '}
              onayınıza sunulur.
            </p>
          </div>
        </aside>
      </div>

      <PurchaseDialog
        open={checkoutOpen}
        items={cart}
        onClose={() => setCheckoutOpen(false)}
        onCheckoutStarted={() => {
          setCart([]);
          clearCart();
          setCheckoutOpen(false);
        }}
      />
    </SiteLayout>
  );
}