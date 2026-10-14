import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ClipboardList,
  Download,
  FileSpreadsheet,
  LineChart,
  UploadCloud,
  UserPlus,
} from 'lucide-react';
import SiteLayout from '@/components/SiteLayout';
import { Button } from '@/components/ui/button';

/** Kurumun portalı adım adım nasıl kullanacağını anlatan sayfa. */

const STEPS = [
  {
    icon: UserPlus,
    title: 'Kurum kaydını açın',
    text: 'Giriş kutusundan "Okul / kurs kaydı" seçeneğiyle kurumunuzu tanımlayın. Kayıt, platform yöneticisi onayladığında aktif olur.',
    detail: 'Onay sonrası kurum yöneticisi kendi öğretmen ve veli erişimlerini tanımlayabilir.',
  },
  {
    icon: ClipboardList,
    title: 'Öğrenci kayıtlarını girin',
    text: 'Öğrenci adı, sınıf, veli adı ve veli e-postası yeterlidir. Veli girişi bu e-posta üzerinden doğru öğrenciye bağlanır.',
    detail: 'Kayıt satırından doğrudan taksit planı veya karne ekranına geçebilirsiniz.',
  },
  {
    icon: Download,
    title: 'Örnek şablonu indirin',
    text: 'Ders netleri ve konu analizi için hazır Excel şablonlarını indirin. Şablonlar ayrıştırıcıyla birebir uyumludur.',
    detail: 'Her şablonda doldurma kurallarını açıklayan ayrı bir "Nasıl Kullanılır" sayfası vardır.',
  },
  {
    icon: UploadCloud,
    title: 'Deneme dosyasını yükleyin',
    text: 'Dosyayı yükleme alanına bırakın. Sistem dosya tipini (ders netleri / konu karnesi) kendisi tanır.',
    detail: 'Aynı denemenin iki dosyası sınav adına göre otomatik olarak tek karnede birleşir.',
  },
  {
    icon: LineChart,
    title: 'Karneyi ve gidişatı okuyun',
    text: 'Ders netleri, eksik konular, sınıf karşılaştırması ve denemeler arası eğri tek sayfada görünür.',
    detail: 'Eksik konular kaçırılan soru, eksiklik oranı ve soru ağırlığına göre önceliklendirilir.',
  },
  {
    icon: FileSpreadsheet,
    title: 'Planı ve tahsilatı takip edin',
    text: 'Ders programını oluşturun, ödeme planlarını kurun; vadesi geçen taksitler otomatik işaretlenir.',
    detail: 'Karne tek sayfada yazdırılabilir, veli görüşmesine hazır biçimde çıkar.',
  },
];

const FAQ = [
  {
    q: 'Yüklediğim dosya okunmazsa ne yapmalıyım?',
    a: 'Genellikle başlık satırı iki katlıdır veya sayısal hücreler metin biçimindedir. Örnek şablonu indirip satırları oraya taşımak sorunu tek adımda çözer.',
  },
  {
    q: 'Öğrenci adı iki dosyada farklı yazılmışsa birleşir mi?',
    a: 'Eşleştirme normalleştirilmiş adla yapılır; büyük/küçük harf, fazla boşluk ve benzeri farklar tolere edilir. Yine de ad ve soyadın aynı hücrede olması gerekir.',
  },
  {
    q: 'Veli hangi bilgileri görür?',
    a: 'Veli yalnızca kendi öğrencisinin karnesini, gidişatını, ödeme planını ve ders programını görür. Başka öğrencilerin verisi hiçbir ekranda görünmez.',
  },
  {
    q: 'Kullanıcı yetkilerini nasıl sınırlarım?',
    a: 'Yetkiler işlem düzeyindedir. Rol varsayılan paketi verir, kurum yöneticisi üzerine tek tek yetki ekleyebilir; rolle gelen yetkiler kilitli gösterilir.',
  },
  {
    q: 'Veriler cihazda mı tutuluyor?',
    a: 'Tarayıcı deposu yalnızca hızlı açılış önbelleğidir. Deneme verisi, kayıtlar ve program kurum klasöründe kalıcı olarak saklanır.',
  },
];

export default function HowItWorksPage() {
  return (
    <SiteLayout>
      <section className="rounded-[28px] border bg-card p-6 shadow-sm sm:p-9">
        <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
          Nasıl çalışır
        </span>
        <h1 className="mt-3 text-3xl font-extrabold leading-tight sm:text-4xl">
          Altı adımda kurulumdan karneye
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground sm:text-base">
          Portal, kurumun elindeki veriyi yeniden girmenizi istemez. Mevcut Excel çıktınızı
          yüklediğiniz anda ders netleri, eksik konular ve gidişat oluşur; program ve muhasebe
          modülleri aynı öğrenci kaydına bağlanır.
        </p>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {STEPS.map((step, index) => {
          const Icon = step.icon;
          return (
            <article key={step.title} className="rounded-2xl border bg-card p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  {index + 1}. adım
                </span>
              </div>
              <h2 className="mt-3 text-base font-extrabold">{step.title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.text}</p>
              <p className="mt-3 border-t pt-3 text-xs leading-5 text-muted-foreground">
                {step.detail}
              </p>
            </article>
          );
        })}
      </section>

      <section className="mt-8 rounded-2xl border bg-card p-6 shadow-sm">
        <h2 className="text-xl font-extrabold">Deneme sonrası önerilen döngü</h2>
        <ol className="mt-4 space-y-3 text-sm leading-6">
          <li className="flex gap-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
              1
            </span>
            <span>
              <strong>İlk 24 saat:</strong> öğrenci yanlışlarını “bilmiyordum / dikkatsizlik /
              zaman yetmedi” olarak sınıflandırır.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
              2
            </span>
            <span>
              <strong>24–48 saat:</strong> dosya yüklenir, öz değerlendirme panelin verisiyle
              karşılaştırılır.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
              3
            </span>
            <span>
              <strong>48–72 saat:</strong> öncelikli üç konu için etüt uygulanır ve kısa kontrol
              ölçümü yapılır.
            </span>
          </li>
        </ol>
        <Link
          to="/blog/deneme-sonrasi-72-saat-plani/"
          className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-primary underline-offset-4 hover:underline"
        >
          Ayrıntılı rehberi okuyun
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-extrabold">Sık sorulanlar</h2>
        <div className="mt-4 space-y-3">
          {FAQ.map((item) => (
            <details
              key={item.q}
              className="group rounded-2xl border bg-card p-4 shadow-sm [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm font-bold">
                {item.q}
                <span className="text-muted-foreground transition-transform duration-200 group-open:rotate-90">
                  <ArrowRight className="h-4 w-4" />
                </span>
              </summary>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-primary/5 p-6">
        <div>
          <p className="text-base font-extrabold">Sorunuz mu var?</p>
          <p className="text-sm text-muted-foreground">
            Kurulum, yetkiler veya dosya biçimi için bize yazabilirsiniz.
          </p>
        </div>
        <Button asChild size="sm">
          <Link to="/iletisim">
            İletişim formu
            <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </Link>
        </Button>
      </section>
    </SiteLayout>
  );
}