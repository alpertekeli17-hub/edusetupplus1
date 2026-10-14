/**
 * İletişim sayfası.
 *
 * Ziyaretçi "Deneme talep ediyorum", "Not gönder", "Destek ve soru" veya
 * "Fiyat teklifi istiyorum" seçeneklerinden birini seçip formu gönderdiğinde
 * mesaj backend üzerinden kurumun e-posta adresine otomatik iletilir; ayrıca
 * gönderene bilgilendirme e-postası gider. Otomatik gönderim yapılandırılmamışsa
 * veya bir hata olursa WhatsApp / e-posta taslağı / kopyalama yedekleri kullanılır.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2,
  Copy,
  Loader2,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import SiteLayout from '@/components/SiteLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  CONTACT_INFO,
  REQUEST_TYPES,
  fetchContactStatus,
  sendContactMessage,
  whatsappLink,
  type ContactRequestType,
} from '@/lib/contact';

const SUBJECTS = [
  'Kurum kaydı ve kurulum',
  'Deneme dosyası / şablon sorunu',
  'Kullanıcı yetkileri',
  'Muhasebe ve taksit takibi',
  'Ders programı',
  'Diğer',
] as const;

export default function ContactPage() {
  const [requestType, setRequestType] = useState<ContactRequestType>('demo');
  const [name, setName] = useState('');
  const [institution, setInstitution] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [subject, setSubject] = useState<string>(SUBJECTS[0]);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sentInfo, setSentInfo] = useState<{ ackSent: boolean } | null>(null);
  const [autoReady, setAutoReady] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchContactStatus()
      .then((status) => {
        if (alive) setAutoReady(status.configured);
      })
      .catch(() => {
        if (alive) setAutoReady(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const activeType = REQUEST_TYPES.find((t) => t.value === requestType) ?? REQUEST_TYPES[0];

  const plainText = useMemo(
    () =>
      [
        `Talep türü: ${activeType.label}`,
        `Ad soyad: ${name.trim() || '-'}`,
        `Kurum: ${institution.trim() || '-'}`,
        `E-posta: ${email.trim() || '-'}`,
        `Telefon: ${phone.trim() || '-'}`,
        `Konu: ${subject}`,
        '',
        'Mesaj:',
        message.trim() || '-',
      ].join('\n'),
    [activeType.label, name, institution, email, phone, subject, message],
  );

  const missing = !name.trim() || !email.trim() || message.trim().length < 5;

  const submit = async () => {
    if (missing) {
      toast.error('Ad soyad, e-posta ve mesaj alanları zorunludur.');
      return;
    }
    setSending(true);
    setFailed(false);
    try {
      const result = await sendContactMessage({
        requestType,
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        institution: institution.trim(),
        subject,
        message: message.trim(),
      });
      setSentInfo({ ackSent: result.ackSent });
      toast.success('Talebiniz gönderildi.');
      setMessage('');
    } catch (e) {
      setFailed(true);
      toast.error(e instanceof Error ? e.message : 'Mesaj gönderilemedi.');
    } finally {
      setSending(false);
    }
  };

  const copyMessage = async () => {
    const text = `Alıcı: ${CONTACT_INFO.email}\nKonu: [EduSetupPlus] ${activeType.label}\n\n${plainText}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Mesaj panoya kopyalandı.');
    } catch {
      toast.error('Kopyalanamadı, metni elle seçip kopyalayabilirsiniz.');
    }
  };

  const mailDraftHref = `mailto:${CONTACT_INFO.email}?subject=${encodeURIComponent(
    `[EduSetupPlus] ${activeType.label}`,
  )}&body=${encodeURIComponent(plainText)}`;

  return (
    <SiteLayout>
      <section className="rounded-[28px] border bg-card p-6 shadow-sm sm:p-9">
        <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
          İletişim
        </span>
        <h1 className="mt-3 text-3xl font-extrabold leading-tight sm:text-4xl">
          Deneme talep edin veya bize not gönderin
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground sm:text-base">
          Aşağıdaki formu doldurup gönderdiğinizde talebiniz doğrudan e-posta adresimize
          ulaşır ve size otomatik bir bilgilendirme e-postası gönderilir. Dilerseniz WhatsApp
          üzerinden de hemen yazabilirsiniz.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <a
            href={`tel:${CONTACT_INFO.phoneRaw}`}
            className="flex items-start gap-3 rounded-2xl border p-4 transition-colors hover:md:bg-accent"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Phone className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Telefon
              </span>
              <span className="block text-sm font-extrabold">{CONTACT_INFO.phoneDisplay}</span>
            </span>
          </a>
          <a
            href={`mailto:${CONTACT_INFO.email}`}
            className="flex items-start gap-3 rounded-2xl border p-4 transition-colors hover:md:bg-accent"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Mail className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">
                E-posta
              </span>
              <span className="block break-all text-sm font-extrabold">{CONTACT_INFO.email}</span>
            </span>
          </a>
          <div className="flex items-start gap-3 rounded-2xl border p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <MapPin className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Adres
              </span>
              <span className="block text-sm font-extrabold">{CONTACT_INFO.address}</span>
            </span>
          </div>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-2xl border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-extrabold">Ne yapmak istiyorsunuz?</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {REQUEST_TYPES.map((item) => {
              const active = item.value === requestType;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setRequestType(item.value)}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    active
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                      : 'hover:md:bg-accent'
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-sm font-extrabold">
                    {active && <CheckCircle2 className="h-4 w-4 text-primary" />}
                    {item.label}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                    {item.hint}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="contact-name">Ad soyad *</Label>
              <Input
                id="contact-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Örn. Ayşe Yılmaz"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-institution">Kurum adı</Label>
              <Input
                id="contact-institution"
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
                placeholder="Örn. Yıldız Koleji"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-email">E-posta *</Label>
              <Input
                id="contact-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ornek@kurum.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-phone">Telefon</Label>
              <Input
                id="contact-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="05xx xxx xx xx"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="contact-subject">Konu</Label>
              <select
                id="contact-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {SUBJECTS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="contact-message">Mesajınız *</Label>
              <Textarea
                id="contact-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={6}
                placeholder="Kurumunuzun büyüklüğü, kullandığınız deneme yayını ve öncelikli ihtiyacınızı kısaca yazabilirsiniz."
              />
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={submit} disabled={missing || sending}>
              {sending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-1.5 h-4 w-4" />
              )}
              {requestType === 'demo' ? 'Deneme talebini gönder' : 'Mesajı gönder'}
            </Button>
            <Button asChild variant="outline">
              <a href={whatsappLink(plainText)} target="_blank" rel="noreferrer">
                <MessageCircle className="mr-1.5 h-4 w-4" />
                WhatsApp ile yaz
              </a>
            </Button>
            <Button variant="outline" onClick={copyMessage} disabled={missing}>
              <Copy className="mr-1.5 h-4 w-4" />
              Mesajı kopyala
            </Button>
          </div>

          {autoReady === false && !sentInfo && (
            <p className="mt-4 rounded-xl border border-amber-300/60 bg-amber-50 p-3 text-sm leading-6 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              Otomatik e-posta gönderimi şu anda yapılandırılmamış görünüyor. Talebinizi WhatsApp
              ile veya <strong>{CONTACT_INFO.email}</strong> adresine e-posta olarak
              iletebilirsiniz.
            </p>
          )}

          {sentInfo && (
            <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm leading-6">
              <p className="flex items-center gap-1.5 font-bold">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                Talebiniz {CONTACT_INFO.email} adresine ulaştı.
              </p>
              <p className="mt-1 text-muted-foreground">
                {sentInfo.ackSent
                  ? 'Bilgilendirme e-postası adresinize gönderildi. En kısa sürede dönüş yapacağız.'
                  : 'En kısa sürede dönüş yapacağız.'}
              </p>
            </div>
          )}

          {failed && (
            <p className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm leading-6">
              Gönderim tamamlanamadı. “WhatsApp ile yaz” düğmesini kullanabilir veya{' '}
              <a href={mailDraftHref} className="font-bold text-primary underline-offset-4 hover:underline">
                e-posta taslağı açıp
              </a>{' '}
              mesajınızı iletebilirsiniz.
            </p>
          )}

          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            Formda öğrenci adı, notu veya kimlik bilgisi paylaşmayın. Öğrenci verileri yalnızca
            kurum panelinde, yetkili kullanıcılar tarafından görülmelidir.
          </p>
        </section>

        <aside className="space-y-4">
          <section className="rounded-2xl border bg-card p-5 shadow-sm">
            <h2 className="text-base font-extrabold">Hızlı kanallar</h2>
            <a
              href={whatsappLink(
                'Merhaba, EduSetupPlus portalı için deneme talep etmek istiyorum.',
              )}
              target="_blank"
              rel="noreferrer"
              className="mt-3 flex items-start gap-3 rounded-xl border p-3 transition-colors hover:md:bg-accent"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
                <MessageCircle className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold">WhatsApp</span>
                <span className="block text-xs text-muted-foreground">
                  {CONTACT_INFO.phoneDisplay} — mesaj yazın
                </span>
              </span>
            </a>
            <a
              href={`tel:${CONTACT_INFO.phoneRaw}`}
              className="mt-3 flex items-start gap-3 rounded-xl border p-3 transition-colors hover:md:bg-accent"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Phone className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold">Telefon</span>
                <span className="block text-xs text-muted-foreground">
                  {CONTACT_INFO.phoneDisplay}
                </span>
              </span>
            </a>
            <a
              href={`mailto:${CONTACT_INFO.email}`}
              className="mt-3 flex items-start gap-3 rounded-xl border p-3 transition-colors hover:md:bg-accent"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Mail className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold">E-posta</span>
                <span className="block break-all text-xs text-muted-foreground">
                  {CONTACT_INFO.email}
                </span>
              </span>
            </a>
            <div className="mt-3 flex items-start gap-3 rounded-xl border p-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <MapPin className="h-4 w-4" />
              </span>
              <span>
                <span className="block text-sm font-bold">Adres</span>
                <span className="block text-xs text-muted-foreground">{CONTACT_INFO.address}</span>
              </span>
            </div>
          </section>

          <section className="rounded-2xl border bg-card p-5 shadow-sm">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShieldCheck className="h-4 w-4" />
            </span>
            <h2 className="mt-3 text-base font-extrabold">Gizlilik</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Kurumlar birbirinin verisini görmez, veli yalnızca kendi öğrencisine erişir ve
              şifreler geri okunamaz biçimde saklanır.
            </p>
            <Link
              to="/blog/ogrenci-verisi-gizlilik-ve-guvenlik/"
              className="mt-3 inline-flex text-sm font-bold text-primary underline-offset-4 hover:underline"
            >
              Gizlilik ilkelerimiz
            </Link>
          </section>

          <section className="rounded-2xl border bg-card p-5 shadow-sm">
            <h2 className="text-base font-extrabold">Önce şunlara bakmak isterseniz</h2>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <Link to="/nasil-calisir" className="font-semibold text-primary underline-offset-4 hover:underline">
                  Nasıl çalışır — altı adımda kurulum
                </Link>
              </li>
              <li>
                <Link to="/hakkimizda" className="font-semibold text-primary underline-offset-4 hover:underline">
                  Hakkımızda — modüller ve kapsam
                </Link>
              </li>
              <li>
                <Link to="/blog/" className="font-semibold text-primary underline-offset-4 hover:underline">
                  Blog — 20 uygulamalı rehber
                </Link>
              </li>
            </ul>
          </section>
        </aside>
      </div>
    </SiteLayout>
  );
}