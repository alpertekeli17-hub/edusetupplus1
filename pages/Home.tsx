/** Portalın ana sayfası: tanıtım, kurum kaydı, rol girişleri ve bölüm kısayolları. */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Archive,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Building2,
  CalendarDays,
  Check,
  ClipboardList,
  CreditCard,
  HeartHandshake,
  KeyRound,
  LineChart,
  Mail,
  ShieldCheck,
  Sparkles,
  Target,
  UserRound,
  Users,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import SiteLayout, { useSession } from '@/components/SiteLayout';
import LoginDialog from '@/components/LoginDialog';
import PurchaseDialog from '@/components/PurchaseDialog';
import {
  ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  type Permission,
  type Role,
} from '@/lib/site';
import {
  PAID_SCHOOL_PLANS,
  formatPlanPrice,
  planSpecOf,
  type PaidSchoolPlan,
} from '@/lib/tenant';

/**
 * Fiyatlandırma kartlarının anlatım metinleri.
 *
 * Fiyat ve öğrenci sınırı `SCHOOL_PLAN_SPECS` içinden okunur; burada yalnızca
 * konumlandırma cümlesi ve öne çıkan plan işareti tutulur.
 */
const PLAN_PITCH: Record<PaidSchoolPlan, { audience: string; featured?: boolean }> = {
  baslangic: { audience: 'Tek şubeli kurs ve etüt merkezleri için · Tüm modüller dahil' },
  standart: {
    audience: 'Orta ölçekli okul ve dershaneler için · Tüm modüller dahil',
    featured: true,
  },
  pro: {
    audience: 'Çok şubeli kurumlar için · Tüm modüller dahil ve öncelikli destek',
  },
};

/** Ana sayfada vitrine çıkan blog yazıları; tam liste /blog/ sayfasında. */
const FEATURED_POSTS = [
  {
    to: '/blog/lgs-deneme-analizi-nasil-yapilir',
    tag: 'Deneme analizi',
    title: 'LGS deneme analizi nasıl yapılır?',
    text: 'Ders netlerinden kazanım kırılımına kadar bir denemeyi adım adım okumanın yolu.',
    tint: 'tint-violet',
  },
  {
    to: '/blog/eksik-konu-tespiti-ve-etut-planlama',
    tag: 'Etüt planı',
    title: 'Eksik konu tespiti ve etüt planlama',
    text: 'Öncelik skoruna göre hangi konuya kaç saat ayırmanız gerektiğini belirleyin.',
    tint: 'tint-sky',
  },
  {
    to: '/blog/veli-gorusmesinde-veri-kullanimi',
    tag: 'Veli iletişimi',
    title: 'Veli görüşmesinde veri kullanımı',
    text: 'Karneyi suçlayıcı değil yol gösterici bir konuşmaya dönüştüren pratik şablon.',
    tint: 'tint-emerald',
  },
] as const;

const ROLE_ICONS: Record<Role, typeof UserRound> = {
  ogretmen: ClipboardList,
  rehber: HeartHandshake,
  veli: UserRound,
  ogrenci: Target,
  admin: ShieldCheck,
};

/**
 * Rol renkleri.
 *
 * Her rolün kendi renk ailesi var; kullanıcı kendi kartını renkten tanıyor.
 * Renk sınıfı yalnızca ton değişkenini ayarlar, kutu geometrisi ortak kalır.
 */
const ROLE_TINTS: Record<Role, string> = {
  ogretmen: 'tint-violet',
  rehber: 'tint-rose',
  veli: 'tint-sky',
  ogrenci: 'tint-teal',
  admin: 'tint-amber',
};

const ROLE_TARGET: Record<Role, string> = {
  ogretmen: '/analiz',
  rehber: '/rehberlik',
  veli: '/analiz',
  ogrenci: '/analiz',
  admin: '/yonetim',
};

/**
 * Modül kartları.
 *
 * Sekiz modül dört kolonluk ızgarada iki tam satır oluşturuyor; hiçbir kart
 * farklı genişlikte değil, böylece satır sonlarında boş hücre kalmıyor ve
 * ızgara simetrisi korunuyor. Ayrışma boyutla değil renkle sağlanıyor: her
 * modülün kendi ton ailesi var, kart üstündeki ince renk şeridi ve ikon kutusu
 * aynı tonu paylaşıyor. Metin her kartta aynı uzunluk bandında tutuldu ki
 * kart yükseklikleri de birbirine yakın kalsın.
 */
const FEATURES: {
  icon: typeof BarChart3;
  title: string;
  text: string;
  to: string;
  tint: string;
  /**
   * Kart yalnızca bu yetkilerden en az biri varsa gösterilir.
   *
   * Giriş yapmamış ziyaretçi için tanıtım amacıyla tüm kartlar görünür; oturum
   * açıldıktan sonra kullanıcının erişemeyeceği bölüm listeden düşer. Böylece
   * öğrenci hesabı muhasebe kartını hiç görmez, tıklayıp "yetkiniz yok"
   * ekranına düşmez.
   */
  anyPermission?: Permission[];
}[] = [
  {
    icon: BarChart3,
    title: 'Deneme analiz paneli',
    text: 'Excel yükleyin; ders netleri, eksik konular ve öncelikli çalışma planı tek sayfada çıkar.',
    to: '/analiz',
    tint: 'tint-violet',
  },
  {
    icon: LineChart,
    title: 'Gidişat ve hedef takibi',
    text: 'Denemeler arası net ve puan gelişimi, hedef çizgileri, sınıf ve okul içi sıralama.',
    to: '/analiz',
    tint: 'tint-indigo',
  },
  {
    icon: CalendarDays,
    title: 'Ders programı',
    text: 'Sınıf bazlı haftalık program; öğretmen çakışması olmadan otomatik oluşturma.',
    to: '/ders-programi',
    tint: 'tint-sky',
  },
  {
    icon: Users,
    title: 'Öğrenci kayıt defteri',
    text: 'Öğrenci ve veli bilgileri, sınıf listeleri, kayıt durumu ve hızlı arama.',
    to: '/ogrenciler',
    tint: 'tint-teal',
  },
  {
    icon: Mail,
    title: 'Mesajlar ve duyurular',
    text: 'Kurum içi yazışma, okundu takibi ve hedefli duyurular tek ekranda.',
    to: '/mesajlar',
    tint: 'tint-teal',
  },
  {
    icon: Wallet,
    title: 'Muhasebe ve tahsilat',
    text: 'Taksit planları, geciken ödemeler, giderler, makbuz ve fatura üretimi.',
    to: '/muhasebe',
    tint: 'tint-emerald',
    anyPermission: ['view_accounting', 'manage_accounting'],
  },
  {
    icon: HeartHandshake,
    title: 'Rehberlik ve erken uyarı',
    text: 'Devamsızlık, sınav, gözlem ve ölçekler tek ekranda; risk uyarısı otomatik çıkar.',
    to: '/rehberlik',
    tint: 'tint-rose',
  },
  {
    icon: ShieldCheck,
    title: 'Yetki yönetimi',
    text: 'Her kullanıcıya tek tek yetki; yönetici şifreyi kendisi belirler, erişimi anında kesebilir.',
    to: '/yonetim',
    tint: 'tint-amber',
  },
  {
    icon: Archive,
    title: 'Yedekleme ve geri yükleme',
    text: 'Kurum verisi tek dosyada yedeklenir, silinen kayıtlar tek adımda geri gelir.',
    to: '/yedekleme',
    tint: 'tint-fuchsia',
  },
];

const STEPS = [
  {
    icon: Building2,
    title: 'Kurum kaydı',
    text: 'Okul veya kurs kaydınızı oluşturun. Platform yöneticisi onayladığında paneliniz açılır.',
    tint: 'tint-sky',
  },
  {
    icon: KeyRound,
    title: 'Kullanıcı hesapları',
    text: 'Yönetici e-postayı girer, yetkileri işaretler ve giriş şifresini kendisi belirler.',
    tint: 'tint-teal',
  },
  {
    icon: ShieldCheck,
    title: 'Güvenli giriş',
    text: 'Giriş yalnızca yöneticinin verdiği şifreyle yapılır; erişim kod veya e-posta ile açılmaz.',
    tint: 'tint-amber',
  },
];

/**
 * Açılış istatistikleri.
 *
 * Dört eş kart yerine tek satırda ayırıcılı bir şerit kullanılıyor: aynı
 * yapıda tekrar eden metrik kutuları şablon görünümünün en belirgin işareti.
 */
const HIGHLIGHTS = [
  { value: '8', label: 'Yönetim modülü' },
  { value: '5', label: 'Kullanıcı rolü' },
  { value: '∞', label: 'Okul ve kurs' },
  { value: '%100', label: 'Kurum izolasyonu' },
];

/** Kurumsal sayfa kısayolları. */
const CORPORATE_LINKS = [
  {
    to: '/hakkimizda',
    label: 'Hakkımızda',
    title: 'Portalın kapsamı ve ilkeleri',
    text: 'Hangi modülleri sunuyoruz, kimler için tasarlandı ve veri güvenliğini nasıl ele alıyoruz?',
    tint: 'tint-indigo',
  },
  {
    to: '/nasil-calisir',
    label: 'Nasıl çalışır',
    title: 'Altı adımda kurulumdan karneye',
    text: 'Kurum kaydı, öğrenci girişi, şablon indirme, dosya yükleme ve karne okuma adımları.',
    tint: 'tint-teal',
  },
  {
    to: '/iletisim',
    label: 'İletişim',
    title: 'Sorularınız için bize yazın',
    text: 'Kurulum, yetkiler veya dosya biçimi hakkında destek talebi oluşturun.',
    tint: 'tint-rose',
  },
];

export default function HomePage() {
  const { state, role, member, isSuperAdmin, reload, can } = useSession();
  const [loginOpen, setLoginOpen] = useState(false);
  const [params, setParams] = useSearchParams();

  /**
   * Satın alma penceresinin durumu.
   * - `purchasePlan` ücretli plan kodudur ve kredi kartı akışını açar.
   * - `trialOpen` ödeme içermeyen ücretsiz deneme talebini açar.
   */
  const [purchasePlan, setPurchasePlan] = useState<PaidSchoolPlan | null>(null);
  const [purchaseOpen, setPurchaseOpen] = useState(false);

  /** Ödeme yarıda kaldığında kullanıcıya sessiz kalmamak için bilgi verilir. */
  useEffect(() => {
    if (params.get('odeme') !== 'iptal') return;
    toast.info('Ödeme tamamlanmadı. Dilediğiniz zaman yeniden başlatabilirsiniz.');
    const next = new URLSearchParams(params);
    next.delete('odeme');
    setParams(next, { replace: true });
  }, [params, setParams]);

  const openPurchase = (plan: PaidSchoolPlan | null) => {
    setPurchasePlan(plan);
    setPurchaseOpen(true);
  };

  /**
   * Oturum açıkken erişilemeyen bölüm kartları listeden düşürülür.
   * Anonim ziyaretçide tanıtım amacıyla tüm başlıklar görünür kalır.
   */
  const visibleFeatures = FEATURES.filter((f) => {
    if (!f.anyPermission?.length) return true;
    if (state !== 'authenticated') return true;
    if (isSuperAdmin) return true;
    return f.anyPermission.some((p) => can(p));
  });

  return (
    <SiteLayout>
      {/*
        Açılış bölümü. Metni gradyanla boyamak yerine tek kelime altı boyalı
        vurguyla işaretleniyor; böylece başlık kontrastı ve seçilebilirliği
        korunuyor. Zeminde ince ızgara dokusu ve çok yavaş kayan tek bir ışık
        lekesi var — hareket dikkat dağıtmayacak kadar sessiz.
      */}
      <section className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[hsl(264_38%_9%)] text-white shadow-lift">
        <span className="pointer-events-none absolute inset-0 bg-grid-invert opacity-70" />
        <span className="pointer-events-none absolute -left-24 -top-32 h-80 w-80 animate-drift rounded-full bg-primary/35 blur-3xl" />
        <span
          className="pointer-events-none absolute -bottom-32 right-0 h-72 w-72 animate-drift rounded-full bg-spark/25 blur-3xl"
          style={{ animationDelay: '-9s' }}
        />

        {/* Asimetrik ızgara: sol tarafta anlatı, sağda kurulum kartı. */}
        <div className="relative grid gap-8 p-6 sm:p-10 lg:grid-cols-12 lg:gap-10 lg:p-12">
          <div className="animate-rise lg:col-span-7">
            <img
              src="/assets/edusetupplus-logo-wide.png?v=4"
              alt="EduSetupPlus"
              width={320}
              height={140}
              className="h-12 w-auto object-contain sm:h-14"
            />

            <p className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-white/85 backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-spark" />
              Okul &amp; Kurs Yönetim Portalı
            </p>

            <h1 className="mt-5 font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-[3.4rem]">
              Kurumunuzun tamamı <span className="mark-spark">tek panelde</span> yönetiliyor
            </h1>

            <p className="mt-5 max-w-xl text-sm leading-relaxed text-white/70 sm:text-base">
              Öğrenci kayıtları, ders programı, yoklama, sınav analizleri, rehberlik ve muhasebe
              aynı çatı altında. Her kurum yalnızca kendi verisini görür; yönetici istediği kişiye
              istediği yetkiyi tanımlar.
            </p>

            <div className="mt-8 flex flex-wrap gap-2.5">
              {state === 'authenticated' ? (
                <Button
                  asChild
                  size="lg"
                  className="group bg-white text-[hsl(264_38%_9%)] hover:md:bg-white/90"
                >
                  <Link to={member ? (role ? ROLE_TARGET[role] : '/analiz') : '/analiz'}>
                    {member ? 'Panelime git' : 'Kuruma katıl'}
                    <ArrowRight className="ml-1.5 h-4 w-4 transition-transform duration-200 ease-out-quart group-hover:md:translate-x-1" />
                  </Link>
                </Button>
              ) : (
                <Button
                  size="lg"
                  className="group bg-white text-[hsl(264_38%_9%)] hover:md:bg-white/90"
                  onClick={() => setLoginOpen(true)}
                >
                  Giriş yap
                  <ArrowRight className="ml-1.5 h-4 w-4 transition-transform duration-200 ease-out-quart group-hover:md:translate-x-1" />
                </Button>
              )}
              {state === 'authenticated' && isSuperAdmin ? (
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="border-white/25 !bg-transparent text-white hover:md:border-white hover:!bg-transparent"
                >
                  <Link to="/admin">Platform yönetimi</Link>
                </Button>
              ) : state === 'authenticated' ? (
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="border-white/25 !bg-transparent text-white hover:md:border-white hover:!bg-transparent"
                >
                  <Link to="/analiz">Okul / kurs kaydı oluştur</Link>
                </Button>
              ) : (
                <Button
                  size="lg"
                  variant="outline"
                  className="border-white/25 !bg-transparent text-white hover:md:border-white hover:!bg-transparent"
                  onClick={() => setLoginOpen(true)}
                >
                  Kurum kaydı için giriş yap
                </Button>
              )}
            </div>

            {/* Metrik şeridi: kutu tekrarı yerine ince ayırıcılı tek satır. */}
            <dl className="mt-9 flex flex-wrap items-end gap-x-8 gap-y-4 border-t border-white/10 pt-6">
              {HIGHLIGHTS.map((h) => (
                <div key={h.label}>
                  <dt className="font-display text-3xl font-bold tabular-nums leading-none text-white">
                    {h.value}
                  </dt>
                  <dd className="mt-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/55">
                    {h.label}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Kurulum adımları açılışın içinde: "üç adımda başla" için ayrı bölüm gerekmiyor. */}
          <div
            className="animate-rise rounded-2xl border border-white/12 bg-white/[0.04] p-5 backdrop-blur-sm lg:col-span-5"
            style={{ animationDelay: '120ms' }}
          >
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/55">
              Üç adımda başlayın
            </p>
            <ol className="mt-4 space-y-4">
              {STEPS.map((s, i) => {
                const Icon = s.icon;
                return (
                  <li key={s.title} className={`flex gap-3 ${s.tint}`}>
                    <span className="icon-tile icon-tile-md icon-tile-tint-invert">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="text-sm font-bold text-white">{s.title}</span>
                        <span className="text-[11px] font-bold tabular-nums text-white/35">
                          0{i + 1}
                        </span>
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed text-white/60">
                        {s.text}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </section>

      {/*
        Fiyatlandırma. Üç ücretli plan aynı genişlikte kartlarda; öne çıkan plan
        boyutla değil renk şeridi ve rozetle işaretleniyor. Her kartın kendi
        satın alma düğmesi var, böylece satın alma yolu tek tıkla ulaşılabilir.
      */}
      <section id="fiyatlandirma" className="mt-14 scroll-mt-24">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-bold tracking-tight">Fiyatlandırma</h2>
            <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
              Yıllık lisans; tüm planlarda bütün modüller açıktır. Fark yalnızca kurumunuzun
              tutabileceği öğrenci sayısındadır.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/*
              Mağaza girişi: ürün kataloğu, birim fiyatlar ve sepet ayrı bir
              sayfada toplanıyor. Fiyat kartlarından tek ürünle doğrudan
              satın alma yolu korunuyor.
            */}
            <Button asChild size="sm">
              <Link to="/magaza">
                <CreditCard className="mr-1.5 h-4 w-4" />
                Mağaza ve sepet
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={() => openPurchase(null)}>
              <Sparkles className="mr-1.5 h-4 w-4" />
              Ücretsiz deneme iste
            </Button>
          </div>
        </div>

        <div className="mt-6 grid gap-3 lg:grid-cols-4">
          {/* Deneme: ödeme yok, talep üzerine açılır. */}
          <div className="surface tint-rail tint-indigo flex h-full flex-col p-5">
            <span className="chip">Deneme</span>
            <p className="mt-3.5 font-display text-3xl font-bold tracking-tight">Ücretsiz</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {planSpecOf('deneme').validDays} gün · talep üzerine
            </p>
            <p className="mt-3.5 text-xs leading-relaxed text-muted-foreground">
              Kurumunuzu kurmadan önce portalı kendi verinizle deneyin.
            </p>
            <ul className="mt-4 flex-1 space-y-2 text-xs">
              {planSpecOf('deneme').highlights.map((line) => (
                <li key={line} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  <span className="text-muted-foreground">{line}</span>
                </li>
              ))}
            </ul>
            <Button variant="outline" className="mt-5" onClick={() => openPurchase(null)}>
              Deneme talebi gönder
            </Button>
          </div>

          {PAID_SCHOOL_PLANS.map((plan) => {
            const spec = planSpecOf(plan);
            const pitch = PLAN_PITCH[plan];
            return (
              <div
                key={plan}
                className={`surface tint-rail relative flex h-full flex-col p-5 ${
                  pitch.featured ? 'tint-violet ring-1 ring-primary/40' : 'tint-sky'
                }`}
              >
                {pitch.featured ? (
                  <span className="absolute right-4 top-4 rounded-full bg-primary px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary-foreground">
                    En çok seçilen
                  </span>
                ) : null}
                <span
                  className="chip"
                  style={{
                    borderColor: 'hsl(var(--tint) / 0.3)',
                    backgroundColor: 'hsl(var(--tint) / 0.12)',
                    color: 'hsl(var(--tint-ink))',
                  }}
                >
                  {spec.label}
                </span>
                <p className="mt-3.5 font-display text-3xl font-bold tracking-tight">
                  {formatPlanPrice(plan)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Yıllık · {spec.studentLimit.toLocaleString('tr-TR')} öğrenciye kadar
                </p>
                <p className="mt-3.5 text-xs leading-relaxed text-muted-foreground">
                  {pitch.audience}
                </p>
                <ul className="mt-4 flex-1 space-y-2 text-xs">
                  {spec.highlights.map((line) => (
                    <li key={line} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                      <span className="text-muted-foreground">{line}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  className="mt-5"
                  variant={pitch.featured ? 'default' : 'outline'}
                  onClick={() => openPurchase(plan)}
                >
                  <CreditCard className="mr-1.5 h-4 w-4" />
                  Kredi kartı ile satın al
                </Button>
              </div>
            );
          })}
        </div>

        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          Üç paketin modül kapsamı aynıdır; aralarındaki tek fark öğrenci kontenjanıdır. Pro
          pakette ek olarak öncelikli destek sunulur. Kontenjan, lisans süresi uzatma, kurulum ve
          personel eğitimi paketlerini{' '}
          <Link to="/magaza" className="font-semibold text-primary underline-offset-4 hover:underline">
            mağaza sayfasından
          </Link>{' '}
          sepete ekleyerek tek ödemede satın alabilirsiniz. Ödemeler Türkiye’de lisanslı iyzico
          altyapısında, 3D Secure ile alınır; kart bilgileri portalda saklanmaz. Ödeme
          onaylandığında kurum kaydınız aldığınız paketle birlikte platform yönetimine düşer ve
          etkinleştirildikten sonra yönetici girişinizle kullanıma açılır.
        </p>
      </section>

      <section className="mt-14">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-bold tracking-tight">Rol girişleri</h2>
            <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
              Herkes aynı giriş ekranını kullanır; yetkiler kurum yöneticinizin tanımına göre
              belirlenir.
            </p>
          </div>
        </div>
        {/*
          Beş rol beş kolona yerleşiyor: dörtlü ızgarada beşinci kart tek başına
          alt satırda kalıp simetriyi bozuyordu. Küçük ekranda ikili düzen
          korunuyor, orta ekranda üçe geçiliyor.
        */}
        <div className="mt-6 grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {ROLES.map((r) => {
            const Icon = ROLE_ICONS[r];
            return (
              <div
                key={r}
                className={`surface surface-hover tint-rail flex flex-col p-5 ${ROLE_TINTS[r]}`}
              >
                <span className="icon-tile icon-tile-md icon-tile-tint">
                  <Icon className="h-5 w-5" />
                </span>
                <p className="mt-4 text-[15px] font-bold">{ROLE_LABELS[r]}</p>
                <p className="mt-1.5 flex-1 text-xs leading-relaxed text-muted-foreground">
                  {ROLE_DESCRIPTIONS[r]}
                </p>
                {state === 'authenticated' ? (
                  <Button asChild size="sm" variant="outline" className="mt-5">
                    <Link to={ROLE_TARGET[r]}>Panele git</Link>
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-5"
                    onClick={() => setLoginOpen(true)}
                  >
                    Giriş yap
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-14">
        <h2 className="font-display text-2xl font-bold tracking-tight">Portal bölümleri</h2>
        <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
          Kurum yönetiminin tüm başlıkları; karta dokunarak ilgili bölüme geçin.
        </p>
        {/*
          Sekiz kart dört kolonda iki tam satır: tüm kartlar aynı genişlik ve
          aynı iç boşlukta, satır sonu boşluğu yok. Kartlar `h-full` ile satır
          yüksekliğine uzatıldığı için aynı satırdaki kartların alt kenarı
          hizalı kalıyor.
        */}
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {visibleFeatures.map((f) => {
            const Icon = f.icon;
            return (
              <Link
                key={f.title}
                to={f.to}
                className={`surface surface-hover tint-rail group flex h-full flex-col p-5 ${f.tint}`}
              >
                <span className="icon-tile icon-tile-md icon-tile-tint group-hover:md:-translate-y-0.5">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="mt-4 flex items-start gap-1.5 text-[15px] font-bold leading-snug">
                  <span className="min-w-0 flex-1">{f.title}</span>
                  <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-200 ease-out-quart group-hover:md:opacity-100" />
                </span>
                <span className="mt-1.5 block text-xs leading-relaxed text-muted-foreground">
                  {f.text}
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="mt-14 grid gap-3 md:grid-cols-3">
        {CORPORATE_LINKS.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={`surface surface-hover tint-rail group flex h-full flex-col p-5 ${item.tint}`}
          >
            <p
              className="text-[11px] font-bold uppercase tracking-[0.16em]"
              style={{ color: 'hsl(var(--tint-ink))' }}
            >
              {item.label}
            </p>
            <h3 className="mt-2.5 flex items-start gap-1.5 text-[15px] font-bold leading-snug">
              <span className="min-w-0 flex-1">{item.title}</span>
              <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-200 ease-out-quart group-hover:md:opacity-100" />
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{item.text}</p>
          </Link>
        ))}
      </section>

      <section className="mt-14">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-bold tracking-tight">Blog</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Deneme analizi, etüt planlama ve okul yönetimi üzerine 20 uygulamalı rehber.
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link to="/blog/">Tüm yazılar</Link>
          </Button>
        </div>
        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {FEATURED_POSTS.map((post) => (
            <Link
              key={post.to}
              to={post.to}
              className={`surface surface-hover tint-rail flex h-full flex-col p-5 ${post.tint}`}
            >
              <span
                className="chip"
                style={{
                  borderColor: 'hsl(var(--tint) / 0.3)',
                  backgroundColor: 'hsl(var(--tint) / 0.12)',
                  color: 'hsl(var(--tint-ink))',
                }}
              >
                {post.tag}
              </span>
              <h3 className="mt-3.5 text-[15px] font-bold leading-snug">{post.title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{post.text}</p>
            </Link>
          ))}
        </div>
      </section>

      <LoginDialog open={loginOpen} onClose={() => setLoginOpen(false)} onSuccess={reload} />
      <PurchaseDialog
        open={purchaseOpen}
        plan={purchasePlan}
        onClose={() => setPurchaseOpen(false)}
      />
    </SiteLayout>
  );
}