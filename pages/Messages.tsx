/**
 * Mesajlar ve duyurular ekranı (`/mesajlar`).
 *
 * Neden tek sayfa: kurum içi yazışma ile duyuru aynı işi görür — bir kişiye ya
 * da bir gruba bilgi ulaştırmak. İkisini ayrı menülere bölmek, öğretmeni
 * "öğrencinin velisi bana yazdı mı" sorusu için iki ekran arasında gezdirirdi.
 *
 * Yetki notu: bu ekran **karar vermez**. Kimin kime yazabileceği, hangi
 * konuşmanın açılabileceği ve hangi duyurunun görüneceği sunucuda belirlenir
 * (`/api/v1/messaging/*`); arayüz yalnızca dönen listeyi gösterir. Yetkiyi
 * burada tekrar yazmak iki kuralın zamanla ayrışmasına ve "görünüyor ama
 * gönderilemiyor" durumunun doğmasına yol açardı.
 *
 * Kurum kimliği isteklerle gönderilmez; oturumdan çözülür. Bu yüzden başka bir
 * kurumun konuşması, kimliği elle değiştirilse bile açılamaz.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  BellRing,
  CheckCheck,
  Loader2,
  Mail,
  MailPlus,
  Megaphone,
  Pencil,
  Pin,
  Search,
  Send,
  Trash2,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import SiteLayout, { useSession } from '@/components/SiteLayout';
import PageGuide from '@/components/PageGuide';
import { MESSAGES_GUIDE } from '@/lib/pageGuides';
import { errorMessage, formatDateShort, ROLE_LABELS, type Role } from '@/lib/site';
import {
  MessagingError,
  createAnnouncement,
  createThreadsBulk,
  fetchMessagingAudience,
  fetchMessagingContacts,
  fetchMessagingOverview,
  fetchThreadDetail,
  markAnnouncementRead,
  markThreadRead,
  sendThreadMessage,
  setAnnouncementArchived,
  setThreadArchived,
  updateAnnouncement,
  updateThreadMessage,
  deleteAnnouncement,
  deleteThread,
  deleteThreadMessage,
  type MessagingAnnouncement,
  type MessagingAudience,
  type MessagingContact,
  type MessagingMessage,
  type MessagingOverview,
  type MessagingThread,
} from '@/lib/messages';

/* --------------------------------- Yardımcılar ------------------------------ */

const AUDIENCE_TYPES = [
  { value: 'kurum', label: 'Tüm kurum' },
  { value: 'rol', label: 'Belirli roller' },
  { value: 'sinif', label: 'Belirli sınıflar' },
  { value: 'kisi', label: 'Belirli kişiler' },
] as const;

const IMPORTANCE_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'onemli', label: 'Önemli' },
  { value: 'acil', label: 'Acil' },
] as const;

const IMPORTANCE_TONES: Record<string, string> = {
  normal: 'bg-muted text-foreground',
  onemli: 'bg-amber-100 text-amber-900',
  acil: 'bg-red-100 text-red-800',
};

const IMPORTANCE_LABELS: Record<string, string> = {
  normal: 'Normal',
  onemli: 'Önemli',
  acil: 'Acil',
};

/** Rol kodunu okunur etikete çevirir; bilinmeyen kod olduğu gibi gösterilir. */
function roleLabel(value: string): string {
  return ROLE_LABELS[value as Role] ?? value;
}

/** "2026-09-20T14:05:00" gibi damgayı okunur kısa metne çevirir. */
function stampOf(value?: string): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const datePart = text.slice(0, 10);
  const timePart = text.length >= 16 ? text.slice(11, 16) : '';
  const day = formatDateShort(datePart);
  return timePart ? `${day} · ${timePart}` : day;
}

function ThreadRow({
  thread,
  active,
  onOpen,
}: {
  thread: MessagingThread;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full rounded-2xl border px-3 py-2.5 text-left transition-colors duration-150 ${
        active ? 'border-primary/40 bg-primary/5' : 'bg-card hover:bg-muted/60'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-extrabold">
          {thread.peer_name || thread.peer_email}
        </p>
        {thread.unread > 0 && (
          <span className="shrink-0 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-extrabold text-white">
            {thread.unread > 99 ? '99+' : thread.unread}
          </span>
        )}
      </div>
      {(thread.subject || thread.student_name) && (
        <p className="mt-0.5 truncate text-[11px] font-bold text-muted-foreground">
          {[thread.subject, thread.student_name].filter(Boolean).join(' · ')}
        </p>
      )}
      <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
        {thread.last_message_preview || 'Henüz mesaj yok.'}
      </p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold tabular-nums text-muted-foreground">
          {stampOf(thread.last_message_at)}
        </span>
        {thread.status === 'arsiv' && (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold">Arşiv</span>
        )}
      </div>
    </button>
  );
}

function MessageBubble({
  message,
  onEdit,
  onDelete,
  canModerate = false,
}: {
  message: MessagingMessage;
  onEdit: (message: MessagingMessage) => void;
  onDelete: (message: MessagingMessage) => void;
  /** Yönetici başkasının mesajını da düzenleyip silebilir. */
  canModerate?: boolean;
}) {
  return (
    <div className={`flex ${message.mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2 ${
          message.mine ? 'bg-primary text-primary-foreground' : 'border bg-card'
        }`}
      >
        {!message.mine && (
          <p className="text-[11px] font-extrabold">{message.sender_name || message.sender_email}</p>
        )}
        <p className="whitespace-pre-wrap break-words text-sm">{message.body}</p>
        <div className="mt-1 flex items-center justify-end gap-2">
          <span
            className={`text-[10px] tabular-nums ${
              message.mine ? 'text-primary-foreground/80' : 'text-muted-foreground'
            }`}
          >
            {stampOf(message.sent_at)}
          </span>
          {/*
            Düzenleme ve silme yalnızca GÖNDERENE açıktır. Karşı taraf
            düzenleyebilseydi, kullanıcı hiç yazmadığı bir cümlenin altında
            kendi adıyla görünürdü; aynı kural sunucuda da uygulanır.
          */}
          {(message.mine || canModerate) && (
            <>
              <button
                type="button"
                onClick={() => onEdit(message)}
                className={`text-[10px] font-bold underline underline-offset-2 ${
                  message.mine ? 'text-primary-foreground/90 hover:text-primary-foreground' : 'text-primary'
                }`}
              >
                Düzenle
              </button>
              <button
                type="button"
                onClick={() => onDelete(message)}
                className={`text-[10px] font-bold underline underline-offset-2 ${
                  message.mine ? 'text-primary-foreground/90 hover:text-primary-foreground' : 'text-destructive'
                }`}
              >
                Sil
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Yeni konuşma ------------------------------- */

function ComposeDialog({
  open,
  onOpenChange,
  onCreated,
  canMessageSchool,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onCreated: (thread: MessagingThread) => void;
  canMessageSchool: boolean;
}) {
  const [contacts, setContacts] = useState<MessagingContact[]>([]);
  const [unreachable, setUnreachable] = useState(0);
  const [loading, setLoading] = useState(false);
  const [roleFilter, setRoleFilter] = useState('hepsi');
  const [classFilter, setClassFilter] = useState('hepsi');
  const [contactQuery, setContactQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [allSchool, setAllSchool] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState('');
  const [progress, setProgress] = useState('');

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    fetchMessagingContacts()
      .then((data) => {
        if (!alive) return;
        /*
          Sıralama: önce veli/öğrenci, sonra personel; kendi danışmanlığındaki
          öğrenciler en üstte. Öğretmen artık kurumun tamamını görüyor ve uzun
          listede kendi sınıfını aramak zorunda kalmamalı.
        */
        const sorted = [...data.contacts].sort((a, b) => {
          if (a.mine !== b.mine) return a.mine ? -1 : 1;
          const staff = (role: string) => (role === 'veli' || role === 'ogrenci' ? 0 : 1);
          if (staff(a.role) !== staff(b.role)) return staff(a.role) - staff(b.role);
          return a.name.localeCompare(b.name, 'tr');
        });
        setContacts(sorted);
        setUnreachable(data.unreachable_students);
        // Seçim her açılışta sıfırlanır: kapanan kurumda eski seçim kalsaydı
        // "Gönder" var olmayan adreslere gitmeye çalışırdı.
        setSelected([]);
        setAllSchool(false);
        setReport('');
        setProgress('');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  /*
    Kişi kutusunun süzgeçleri.

    "Öğrenciler gelmiyor" geri bildiriminin iki bileşeni vardı: liste rol
    süzgeci olmadan tek yığın hâlinde geliyordu ve bir öğrenci hangi rolden
    bakıldığı ayırt edilemiyordu. Süzgeç rol kodundan (sunucudan gelen gerçek
    kişilerden) türetilir; sabit liste yazılsaydı kurumda hiç bulunmayan rol
    boş bir seçenek olarak ekranda kalırdı.
  */
  const roleOptions = useMemo(() => {
    const counts = new Map<string, number>();
    contacts.forEach((item) => counts.set(item.role, (counts.get(item.role) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [contacts]);

  const visibleContacts = useMemo(() => {
    const needle = contactQuery.trim().toLocaleLowerCase('tr');
    return contacts.filter((contact) => {
      if (roleFilter !== 'hepsi' && contact.role !== roleFilter) return false;
      if (classFilter !== 'hepsi' && String(contact.class_name || '') !== classFilter) return false;
      if (!needle) return true;
      return [contact.name, contact.email, contact.student_name, contact.class_name]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('tr').includes(needle));
    });
  }, [contacts, roleFilter, classFilter, contactQuery]);

  /** Sınıf süzgeci: yalnızca kayıtlı sınıflar, kişi sayısıyla. */
  const classOptions = useMemo(() => {
    const counts = new Map<string, number>();
    contacts.forEach((item) => {
      const name = String(item.class_name || '').trim();
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'tr'));
  }, [contacts]);

  /*
    Gönderilecek adresler.

    İki kural birlikte uygulanır:

    1) "Tüm veli ve öğrencilere gönder" kutusu ADINI tutar: hedef yalnızca
       veli ve öğrenci rolleridir. Önceden listedeki HERKES (yönetici, rehber,
       öğretmen dâhil) hedefleniyordu; kutu "veli ve öğrenci" dediği hâlde
       personele de mesaj gidiyordu.

    2) Gönderim dışı kişiler (henüz etkinleşmemiş hesaplar) hedeften çıkarılır.
       Çıkarılmazsa sunucu her birini "atlandı" sayar ve hiç geçerli alıcı
       kalmadığında istek 403 ile tamamen reddedilir — kullanıcı bunu
       "yetkim yok" gibi okur, oysa sorun alıcıların durumudur.

    Hedef küme ekrandaki süzgeçten değil sunucudan gelen kişi listesinden
    alınır; süzgeçli liste yalnızca kullanıcının o an baktığı alt kümedir.
    Sunucu her adresi ayrıca yetki listesine karşı doğrular.
  */
  const schoolWideContacts = useMemo(
    () => contacts.filter((c) => c.reachable !== false && (c.role === 'veli' || c.role === 'ogrenci')),
    [contacts],
  );

  const targets = useMemo(() => {
    if (allSchool) return schoolWideContacts.map((contact) => contact.email);
    return contacts
      .filter((contact) => selected.includes(contact.email) && contact.reachable !== false)
      .map((contact) => contact.email);
  }, [allSchool, schoolWideContacts, contacts, selected]);

  /** Seçilmiş ama gönderilemeyecek kişiler (kullanıcıya nedeniyle bildirilir). */
  const blockedSelection = useMemo(
    () => contacts.filter((c) => selected.includes(c.email) && c.reachable === false),
    [contacts, selected],
  );

  const selectedContacts = useMemo(
    () => contacts.filter((contact) => selected.includes(contact.email)),
    [contacts, selected],
  );

  const toggle = (email: string) =>
    setSelected((prev) =>
      prev.includes(email) ? prev.filter((item) => item !== email) : [...prev, email],
    );

  const selectVisible = () =>
    setSelected((prev) => [...new Set([...prev, ...visibleContacts.map((c) => c.email)])]);

  /** Listede gösterilecek daralma/eksiklik notu (varsa tek cümle). */
  const scopeNote = useMemo(() => {
    const note = contacts.find((item) => item.reason)?.reason;
    return note ? String(note) : '';
  }, [contacts]);

  const submit = async () => {
    if (!targets.length) return;
    setBusy(true);
    setReport('');
    setProgress(`Gönderiliyor… 0 / ${targets.length}`);
    try {
      /*
        İlerleme neden gösterilir: büyük kurumda gönderim sunucuda parti parti
        yürüyor ve saniyeler sürebiliyor. Sayaç olmazsa kullanıcı düğmeye
        bastıktan sonra donmuş bir pencere görür ve pencereyi kapatıp işlemi
        yarıda bırakır.
      */
      const result = await createThreadsBulk({
        recipientEmails: targets,
        body,
        subject,
        audienceType: allSchool ? 'kurum' : 'kisi',
        onProgress: (sent, total) => setProgress(`Gönderiliyor… ${sent} / ${total}`),
      });

      // Yarım kalan gönderim sessizce yutulmaz: kalan adresler ekranda kalır ve
      // kullanıcı "Gönder" ile devam eder (aynı mesaj, yalnızca kalan kişiler).
      if (!result.done || result.skipped.length) {
        const parts: string[] = [`${result.sent} kişiye gönderildi.`];
        if (!result.done) parts.push(`Gönderilemeyen ${result.remaining.length} kişi kaldı.`);
        if (result.skipped.length) {
          parts.push(
            `Atlanan ${result.skipped.length} kişi: ${result.skipped
              .map((item) => item.email)
              .join(', ')}`,
          );
        }
        setReport(parts.join(' '));
        setSelected(result.remaining);
        setProgress('');
        return;
      }

      onCreated(result.threads[0]);
      setBody('');
      setSubject('');
      setSelected([]);
      setAllSchool(false);
      setProgress('');
      onOpenChange(false);
    } catch (error) {
      // Yazma yolu sessiz kalmamalı: kullanıcı "gönderdim" sanıp beklerdi.
      window.alert(errorMessage(error, 'Konuşma açılamadı.'));
      setProgress('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        NEDEN: pencere içeriği (kişi listesi + süzgeçler + uyarılar) uzun
        olduğu için varsayılan yükseklikte ekranı tamamen kaplıyor ve alttaki
        "Gönder" düğmesi görünür alanın dışına düşüyordu. Pencere yüksekliği
        sınırlandı, başlık ve alt düğme şeridi sabit tutulup yalnızca orta
        gövde kaydırılıyor.
      */}
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Yeni konuşma</DialogTitle>
          <DialogDescription>
            Listedeki kişiler yazışma yetkiniz olan kişilerdir; kurum dışına mesaj gönderilemez.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex min-h-[120px] flex-1 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !contacts.length ? (
          <p className="rounded-xl border bg-muted/40 p-3 text-sm text-muted-foreground">
            Şu an yazışma açabileceğiniz kişi bulunmuyor. Veli ve öğrenci hesapları yalnızca kendi
            danışman öğretmeni, rehber öğretmeni ve yöneticisiyle yazışabilir.
          </p>
        ) : (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            <div className="space-y-1.5">
              <Label>Alıcılar ({targets.length} seçili)</Label>

              {canMessageSchool && (
                <label className="flex items-start gap-2 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-current"
                    checked={allSchool}
                    onChange={(e) => setAllSchool(e.target.checked)}
                  />
                  <span className="space-y-0.5 text-[11px]">
                    <span className="flex items-center gap-1.5 font-extrabold">
                      <Users className="h-3.5 w-3.5" />
                      Tüm veli ve öğrencilere gönder ({schoolWideContacts.length} kişi)
                    </span>
                    <span className="block font-semibold text-muted-foreground">
                      Kurumdaki tüm veli ve öğrencilere ayrı konuşma açılır; alıcılar birbirini
                      görmez. Bu seçenek yönetici, rehber öğretmen ve öğretmen hesaplarında çıkar.
                    </span>
                  </span>
                </label>
              )}

              <div className="flex flex-wrap gap-1.5">
                {[['hepsi', 'Tümü', contacts.length] as const, ...roleOptions.map(([role, count]) => [role, roleLabel(role), count] as const)].map(
                  ([value, label, count]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setRoleFilter(value)}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors duration-150 ${
                        roleFilter === value
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'bg-card hover:bg-muted'
                      }`}
                    >
                      {label}
                      <span className="ml-1 tabular-nums font-extrabold">{count}</span>
                    </button>
                  ),
                )}
              </div>

              {classOptions.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setClassFilter('hepsi')}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors duration-150 ${
                      classFilter === 'hepsi'
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'bg-card hover:bg-muted'
                    }`}
                  >
                    Tüm sınıflar
                  </button>
                  {classOptions.map(([name, count]) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setClassFilter(name)}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors duration-150 ${
                        classFilter === name
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'bg-card hover:bg-muted'
                      }`}
                    >
                      {name}
                      <span className="ml-1 tabular-nums font-extrabold">{count}</span>
                    </button>
                  ))}
                </div>
              )}

              <Input
                value={contactQuery}
                onChange={(e) => setContactQuery(e.target.value)}
                placeholder="Ad, e-posta, öğrenci veya sınıf ara"
                className="h-9 text-xs"
              />

              <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border bg-card p-1.5">
                {visibleContacts.map((contact) => {
                  const active = allSchool || selected.includes(contact.email);
                  return (
                    <button
                      key={contact.email}
                      type="button"
                      onClick={() => toggle(contact.email)}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors duration-150 ${
                        active ? 'bg-primary/10 font-bold' : 'hover:bg-muted'
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {[
                          contact.name || contact.email,
                          roleLabel(contact.role),
                          contact.student_name,
                          contact.class_name,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      {active && <CheckCheck className="h-3.5 w-3.5 shrink-0 text-primary" />}
                    </button>
                  );
                })}
                {!visibleContacts.length && (
                  <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                    Bu süzgeçle eşleşen kişi yok. Süzgeçleri "Tümü"ne alıp aramayı temizleyin.
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={allSchool || !visibleContacts.length}
                  onClick={selectVisible}
                >
                  Görünenleri seç ({visibleContacts.length})
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={!selected.length}
                  onClick={() => setSelected([])}
                >
                  Seçimi temizle
                </Button>
              </div>

              {!allSchool && selectedContacts.length > 0 && (
                <p className="text-[11px] font-semibold text-muted-foreground">
                  Seçilenler: {selectedContacts.slice(0, 6).map((c) => c.name || c.email).join(', ')}
                  {selectedContacts.length > 6 ? ` ve ${selectedContacts.length - 6} kişi daha` : ''}
                </p>
              )}

              {report && (
                <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-900">
                  {report}
                </p>
              )}

              {/*
                Seçili ama gönderilemeyecek kişiler sessizce atılmaz: kullanıcı
                listede seçtiği hâlde alıcı sayısının neden düştüğünü görmeli,
                aksi hâlde "seçtim ama gitmedi" durumu açıklamasız kalırdı.
              */}
              {blockedSelection.length > 0 && (
                <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-900">
                  Seçilen {blockedSelection.length} kişiye şu anda gönderilemez:{' '}
                  {blockedSelection.slice(0, 4).map((c) => c.name || c.email).join(', ')}
                  {blockedSelection.length > 4 ? ' ve diğerleri' : ''}.{' '}
                  {blockedSelection[0]?.reason || 'Hesapları henüz etkinleştirilmedi.'}
                </p>
              )}

              {canMessageSchool && !schoolWideContacts.length && (
                <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-900">
                  Kurumda mesaj gönderilebilecek veli veya öğrenci hesabı bulunmuyor. Öğrenci
                  kayıtlarına veli/öğrenci e-postası ekleyin veya hesaplarını açın.
                </p>
              )}

              {scopeNote && (
                <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-900">
                  {scopeNote}
                </p>
              )}

              {unreachable > 0 && (
                <p className="rounded-xl border bg-muted/40 px-3 py-2 text-[11px] font-semibold text-muted-foreground">
                  {unreachable} öğrencinin kayıt defterinde veli veya öğrenci e-postası yok; bu
                  ailelerle mesajlaşılamaz. Kayıt defterinden adres eklenince listede görünürler.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="mesaj-konu">Konu (isteğe bağlı)</Label>
              <Input
                id="mesaj-konu"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Örn. Deneme sonucu hakkında"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="mesaj-govde">İlk mesaj</Label>
              <Textarea
                id="mesaj-govde"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                placeholder="Mesajınızı yazın…"
              />
            </div>
          </div>
        )}

        {/* NEDEN: düğme şeridi kaydırma alanının dışında ve her zaman görünür kalmalı. */}
        <DialogFooter className="shrink-0 border-t pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button disabled={busy || !targets.length || !body.trim()} onClick={() => void submit()}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
            {targets.length > 1 ? `${targets.length} kişiye gönder` : 'Gönder'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------- Duyuru formu ------------------------------ */

function AnnouncementDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [importance, setImportance] = useState('normal');
  const [audienceType, setAudienceType] = useState('kurum');
  const [roleCodes, setRoleCodes] = useState<string[]>([]);
  const [classNames, setClassNames] = useState<string[]>([]);
  const [emails, setEmails] = useState<string[]>([]);
  const [pinned, setPinned] = useState(false);
  const [requiresRead, setRequiresRead] = useState(true);
  const [busy, setBusy] = useState(false);

  /* Alıcı dizini: rol/sınıf/kişi seçenekleri kurumun GERÇEK verisinden gelir. */
  const [audience, setAudience] = useState<MessagingAudience | null>(null);
  const [audienceLoading, setAudienceLoading] = useState(false);
  const [personQuery, setPersonQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setAudienceLoading(true);
    fetchMessagingAudience()
      .then((data) => {
        if (alive) setAudience(data);
      })
      .finally(() => {
        if (alive) setAudienceLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  const selectedValues =
    audienceType === 'rol'
      ? roleCodes
      : audienceType === 'sinif'
        ? classNames
        : audienceType === 'kisi'
          ? emails
          : [];

  const toggle = (list: string[], value: string, setter: (next: string[]) => void) => {
    setter(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  };

  const visiblePeople = useMemo(() => {
    const list = audience?.people ?? [];
    const needle = personQuery.trim().toLocaleLowerCase('tr');
    if (!needle) return list;
    return list.filter((person) =>
      [person.name, person.email, person.student_name, person.class_name]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('tr').includes(needle)),
    );
  }, [audience, personQuery]);

  /**
   * Yayınlanacak okunur etiket.
   *
   * Rol kodları `ogretmen` gibi teknik değerler olduğu için etiket listesi
   * kullanıcıya görünen ada çevrilir; sınıf ve kişi değerleri zaten okunurdur.
   */
  const audienceLabels = selectedValues
    .map((value) => {
      if (audienceType === 'rol') return roleLabel(value);
      if (audienceType === 'kisi') {
        const person = (audience?.people ?? []).find((item) => item.email === value);
        return person?.name || value;
      }
      return value;
    })
    .join(', ');

  const submit = async () => {
    setBusy(true);
    try {
      await createAnnouncement({
        title,
        body,
        importance,
        audienceType,
        audienceValues: selectedValues.join(','),
        audienceLabels,
        pinned,
        requiresRead,
      });
      setTitle('');
      setBody('');
      setRoleCodes([]);
      setClassNames([]);
      setEmails([]);
      onCreated();
      onOpenChange(false);
    } catch (error) {
      // Yayın sessizce başarısız olursa kullanıcı duyuruyu gönderdiğini sanır.
      window.alert(errorMessage(error, 'Duyuru yayınlanamadı.'));
    } finally {
      setBusy(false);
    }
  };

  const header =
    audienceType === 'kurum'
      ? 'Tüm kurum üyelerine gönderilir.'
      : audienceType === 'rol'
        ? 'Yalnızca seçilen role sahip aktif hesaplara gönderilir.'
        : audienceType === 'sinif'
          ? 'Sınıf seçildiğinde hem o şubedeki öğrencilere hem velilerine ulaşır.'
          : 'Yalnızca listeden seçtiğiniz kişilere gönderilir.';

  const canPublish =
    !busy &&
    title.trim().length > 0 &&
    body.trim().length > 0 &&
    (audienceType === 'kurum' ? true : selectedValues.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        NEDEN: konuşma penceresiyle aynı sorun: tüm pencere kaydığında alttaki
        yayınlama düğmesi görünür alanın dışında kalıyordu. Başlık ve düğme
        şeridi sabit, yalnızca orta gövde kaydırılır.
      */}
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Yeni duyuru</DialogTitle>
          <DialogDescription>
            Duyuru yalnızca seçilen hedef kitleye görünür; okundu işaretlemesi kalıcıdır.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <Label htmlFor="duyuru-baslik">Başlık</Label>
            <Input
              id="duyuru-baslik"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Örn. Veli toplantısı tarihi"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="duyuru-govde">Metin</Label>
            <Textarea
              id="duyuru-govde"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              placeholder="Duyuru metnini yazın…"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="duyuru-onem">Önem</Label>
              <select
                id="duyuru-onem"
                value={importance}
                onChange={(e) => setImportance(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {IMPORTANCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="duyuru-kitle">Hedef kitle</Label>
              <select
                id="duyuru-kitle"
                value={audienceType}
                onChange={(e) => setAudienceType(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {AUDIENCE_TYPES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p className="rounded-xl border bg-muted/40 px-3 py-2 text-[11px] font-semibold text-muted-foreground">
            {header}
          </p>

          {audienceType !== 'kurum' &&
            (audienceLoading ? (
              <div className="flex min-h-[80px] items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : !audience ? (
              <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                Alıcı listesi yüklenemedi. Duyuruyu yayınlamadan önce pencereyi kapatıp tekrar
                açın.
              </p>
            ) : audienceType === 'rol' ? (
              <div className="space-y-2">
                <Label>Roller</Label>
                <div className="flex flex-wrap gap-2">
                  {audience.roles.map((role) => {
                    const active = roleCodes.includes(role.code);
                    const empty = role.count <= 0;
                    return (
                      <button
                        key={role.code}
                        type="button"
                        disabled={empty}
                        onClick={() => toggle(roleCodes, role.code, setRoleCodes)}
                        className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors duration-150 ${
                          empty
                            ? 'cursor-not-allowed border-dashed text-muted-foreground opacity-60'
                            : active
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'bg-card hover:bg-muted'
                        }`}
                      >
                        {roleLabel(role.code)}
                        <span className="ml-1.5 tabular-nums font-extrabold">{role.count}</span>
                      </button>
                    );
                  })}
                </div>
                {audience.roles.every((role) => role.count <= 0) && (
                  <p className="text-[11px] font-semibold text-amber-800">
                    Bu kurumda aktif hesap yok; role göre duyuru gönderilemez.
                  </p>
                )}
              </div>
            ) : audienceType === 'sinif' ? (
              <div className="space-y-2">
                <Label>Sınıflar</Label>
                {!audience.classes.length ? (
                  <p className="text-[11px] font-semibold text-amber-800">
                    Kayıtlı sınıf bulunamadı; sınıf hedefiyle duyuru gönderilemez.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {audience.classes.map((item) => {
                      const active = classNames.includes(item.name);
                      return (
                        <button
                          key={item.name}
                          type="button"
                          onClick={() => toggle(classNames, item.name, setClassNames)}
                          className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors duration-150 ${
                            active
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'bg-card hover:bg-muted'
                          }`}
                        >
                          {item.name}
                          <span className="ml-1.5 tabular-nums font-extrabold">{item.count}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label>Kişiler ({emails.length} seçili)</Label>
                  <Input
                    value={personQuery}
                    onChange={(e) => setPersonQuery(e.target.value)}
                    placeholder="Ad, e-posta veya sınıf ara"
                    className="h-8 max-w-[220px] text-xs"
                  />
                </div>
                {!audience.people.length ? (
                  <p className="text-[11px] font-semibold text-amber-800">
                    Kurumda duyuru gönderilebilecek kişi bulunamadı.
                  </p>
                ) : (
                  <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border p-2">
                    {visiblePeople.map((person) => {
                      const active = emails.includes(person.email);
                      return (
                        <button
                          key={person.email}
                          type="button"
                          onClick={() => toggle(emails, person.email, setEmails)}
                          className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors duration-150 ${
                            active ? 'bg-primary/10 font-extrabold' : 'hover:bg-muted'
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-bold">
                              {person.name || person.email}
                            </span>
                            <span className="block truncate text-[10px] text-muted-foreground">
                              {[roleLabel(person.role), person.student_name, person.class_name]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          </span>
                          {active && <CheckCheck className="h-3.5 w-3.5 shrink-0 text-primary" />}
                        </button>
                      );
                    })}
                    {!visiblePeople.length && (
                      <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                        Aramayla eşleşen kişi yok.
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}

          {audience && audience.unreachable_students > 0 && (
            <div className="space-y-1 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2">
              <p className="text-[11px] font-bold text-amber-900">
                {audience.unreachable_students} öğrencinin kayıt defterinde veli veya öğrenci
                e-postası yok; bu ailelere duyuru ulaşmaz. Aşağıdaki kayıtlara adres eklediğinizde
                duyuru onlara da gider.
              </p>
              <p className="text-[11px] font-semibold text-amber-900">
                {audience.unreachable
                  .slice(0, 8)
                  .map((item) => [item.name, item.class_name].filter(Boolean).join(' · '))
                  .join(', ')}
                {audience.unreachable.length > 8
                  ? ` ve ${audience.unreachable.length - 8} öğrenci daha`
                  : ''}
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-4 text-sm font-semibold">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={pinned}
                onChange={(e) => setPinned(e.target.checked)}
                className="h-4 w-4"
              />
              Listede üste sabitle
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={requiresRead}
                onChange={(e) => setRequiresRead(e.target.checked)}
                className="h-4 w-4"
              />
              Okundu bilgisi istensin
            </label>
          </div>
        </div>

        {/* NEDEN: yayınlama düğmesi kaydırma alanının dışında, her zaman görünür. */}
        <DialogFooter className="shrink-0 border-t pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button disabled={!canPublish} onClick={() => void submit()}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Megaphone className="mr-1.5 h-4 w-4" />}
            Yayınla
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------- Gövde ----------------------------------- */

function MessagesBody() {
  const { member, account } = useSession();

  const [overview, setOverview] = useState<MessagingOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState<'konusmalar' | 'duyurular'>('konusmalar');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [query, setQuery] = useState('');

  const [activeId, setActiveId] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ thread: MessagingThread; messages: MessagingMessage[] } | null>(
    null,
  );
  const [detailLoading, setDetailLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const [composeOpen, setComposeOpen] = useState(false);
  const [announceOpen, setAnnounceOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetchMessagingOverview(includeArchived);
    setOverview(data);
    setLoadError(data ? '' : 'Mesajlar yüklenemedi. Oturumunuz sona ermiş olabilir.');
    setLoading(false);
  }, [includeArchived]);

  useEffect(() => {
    void load();
  }, [load]);

  /* Seçili konuşma listeden düşerse ilk konuşmaya dönülür. */
  useEffect(() => {
    if (!overview) return;
    setActiveId((prev) => {
      if (prev && overview.threads.some((t) => t.id === prev)) return prev;
      return overview.threads[0]?.id ?? null;
    });
  }, [overview]);

  const visibleThreads = useMemo(() => {
    const list = overview?.threads ?? [];
    const needle = query.trim().toLocaleLowerCase('tr');
    if (!needle) return list;
    return list.filter((thread) =>
      [thread.peer_name, thread.peer_email, thread.subject, thread.student_name]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('tr').includes(needle)),
    );
  }, [overview, query]);

  const visibleAnnouncements = useMemo(() => {
    const list = overview?.announcements ?? [];
    return [...list].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.read !== b.read) return a.read ? 1 : -1;
      return String(b.publish_at || b.created_at).localeCompare(String(a.publish_at || a.created_at));
    });
  }, [overview]);

  /** Konuşmayı açar, mesajları okur ve okundu işaretler. */
  const openThread = useCallback(
    async (threadId: number) => {
      setActiveId(threadId);
      setDetailLoading(true);
      const data = await fetchThreadDetail(threadId);
      setDetail(data);
      setDetailLoading(false);
      if (!data) return;

      /*
        Okundu işaretlemesi ardından liste tazelenir; aksi hâlde okunmamış
        rozeti okuyucu ekranda kalır ve kullanıcı mesajı okumadığını sanır.
      */
      await markThreadRead(threadId);
      void load();
    },
    [load],
  );

  useEffect(() => {
    if (activeId == null) {
      setDetail(null);
      return;
    }
    void (async () => {
      setDetailLoading(true);
      const data = await fetchThreadDetail(activeId);
      setDetail(data);
      setDetailLoading(false);
      if (data) {
        await markThreadRead(activeId);
        void load();
      }
    })();
    // `load` kimliği değiştiğinde yeniden açmak sonsuz döngü üretirdi; seçim değişimi esastır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const send = async () => {
    if (activeId == null || !draft.trim()) return;
    setSending(true);
    try {
      await sendThreadMessage(activeId, draft);
      setDraft('');
      const data = await fetchThreadDetail(activeId);
      setDetail(data);
      void load();
    } catch (error) {
      window.alert(errorMessage(error, 'Mesaj gönderilemedi.'));
    } finally {
      setSending(false);
    }
  };

  const toggleArchive = async (thread: MessagingThread) => {
    try {
      await setThreadArchived(thread.id, thread.status !== 'arsiv');
      void load();
    } catch (error) {
      window.alert(errorMessage(error, 'Konuşma güncellenemedi.'));
    }
  };

  /** Kendi mesajını düzenler; boş metin gönderimi engellenir. */
  const editMessage = async (message: MessagingMessage) => {
    const next = window.prompt('Mesajı düzenleyin:', message.body);
    if (next === null) return;
    if (!next.trim()) {
      window.alert('Mesaj metni boş olamaz. Silmek için "Sil" düğmesini kullanın.');
      return;
    }
    try {
      await updateThreadMessage(message.id, next);
      if (activeId != null) setDetail(await fetchThreadDetail(activeId));
      void load();
    } catch (error) {
      window.alert(errorMessage(error, 'Mesaj düzenlenemedi.'));
    }
  };

  /** Kendi mesajını siler (geri alınamaz, bu yüzden onay istenir). */
  const removeMessage = async (message: MessagingMessage) => {
    if (!window.confirm('Bu mesaj kalıcı olarak silinecek. Devam edilsin mi?')) return;
    try {
      await deleteThreadMessage(message.id);
      if (activeId != null) setDetail(await fetchThreadDetail(activeId));
      void load();
    } catch (error) {
      window.alert(errorMessage(error, 'Mesaj silinemedi.'));
    }
  };

  /** Konuşmanın tamamını siler; seçim temizlenir ki silinen kayıt açık kalmasın. */
  const removeThread = async (thread: MessagingThread) => {
    if (
      !window.confirm(
        'Bu konuşma ve içindeki tüm mesajlar kalıcı olarak silinecek. Devam edilsin mi?',
      )
    )
      return;
    try {
      await deleteThread(thread.id);
      setActiveId(null);
      setDetail(null);
      void load();
    } catch (error) {
      window.alert(errorMessage(error, 'Konuşma silinemedi.'));
    }
  };

  const readAnnouncement = async (item: MessagingAnnouncement) => {
    if (item.read) return;
    await markAnnouncementRead(item.id);
    setOverview((prev) =>
      prev
        ? {
            ...prev,
            announcements: prev.announcements.map((a) => (a.id === item.id ? { ...a, read: true } : a)),
            counts: {
              ...prev.counts,
              announcementUnread: Math.max(0, prev.counts.announcementUnread - 1),
              total: Math.max(0, prev.counts.total - 1),
            },
          }
        : prev,
    );
  };

  const readAllAnnouncements = async () => {
    const unread = (overview?.announcements ?? []).filter((a) => !a.read);
    await Promise.all(unread.map((a) => markAnnouncementRead(a.id)));
    void load();
  };

  const toggleAnnouncementArchive = async (item: MessagingAnnouncement, archived: boolean) => {
    try {
      await setAnnouncementArchived(item.id, archived);
      void load();
    } catch (error) {
      window.alert(errorMessage(error, 'Duyuru güncellenemedi.'));
    }
  };

  /** Duyuru metnini düzenler; hedef kitle korunur, içerik düzeltilir. */
  const editAnnouncement = async (item: MessagingAnnouncement) => {
    const title = window.prompt('Duyuru başlığı:', item.title);
    if (title === null) return;
    const body = window.prompt('Duyuru metni:', item.body);
    if (body === null) return;
    if (!title.trim() || !body.trim()) {
      window.alert('Duyuru başlığı ve metni boş olamaz.');
      return;
    }
    try {
      await updateAnnouncement({
        id: item.id,
        title,
        body,
        importance: item.importance,
        audienceType: item.audience_type,
        audienceValues: item.audience_values,
        audienceLabels: item.audience_labels,
        expiresAt: item.expires_at,
        pinned: item.pinned,
        requiresRead: item.requires_read,
      });
      void load();
    } catch (error) {
      window.alert(errorMessage(error, 'Duyuru düzenlenemedi.'));
    }
  };

  /** Duyuruyu kalıcı siler (okunma kayıtlarıyla birlikte). */
  const removeAnnouncement = async (item: MessagingAnnouncement) => {
    if (!window.confirm('Bu duyuru kalıcı olarak silinecek. Devam edilsin mi?')) return;
    try {
      await deleteAnnouncement(item.id);
      void load();
    } catch (error) {
      window.alert(errorMessage(error, 'Duyuru silinemedi.'));
    }
  };

  const viewer = overview?.viewer;
  const counts = overview?.counts;
  const unreadAnnouncements = (overview?.announcements ?? []).filter((a) => !a.read).length;

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Mesajlar</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {viewer
              ? `${roleLabel(viewer.role)} · kurum içi yazışma ve duyurular`
              : 'Kurum içi yazışma ve duyurular'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-red-100 px-2.5 py-1 text-[11px] font-bold text-red-800">
            {counts?.threadUnread ?? 0} okunmamış mesaj
          </span>
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-900">
            {unreadAnnouncements} okunmamış duyuru
          </span>
          <Button size="sm" variant="outline" onClick={() => setComposeOpen(true)}>
            <MailPlus className="mr-1.5 h-4 w-4" />
            Yeni konuşma
          </Button>
          {viewer?.can_announce && (
            <Button size="sm" onClick={() => setAnnounceOpen(true)}>
              <Megaphone className="mr-1.5 h-4 w-4" />
              Yeni duyuru
            </Button>
          )}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card px-4 py-2.5">
        <button
          type="button"
          onClick={() => setTab('konusmalar')}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors duration-150 ${
            tab === 'konusmalar' ? 'bg-primary text-primary-foreground' : 'bg-muted'
          }`}
        >
          <Mail className="h-3.5 w-3.5" />
          Konuşmalar ({overview?.threads.length ?? 0})
        </button>
        <button
          type="button"
          onClick={() => setTab('duyurular')}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors duration-150 ${
            tab === 'duyurular' ? 'bg-primary text-primary-foreground' : 'bg-muted'
          }`}
        >
          <BellRing className="h-3.5 w-3.5" />
          Duyurular ({overview?.announcements.length ?? 0})
        </button>

        {tab === 'konusmalar' && (
          <label className="ml-auto flex items-center gap-2 text-xs font-bold">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
              className="h-4 w-4"
            />
            Arşivlenenleri göster
          </label>
        )}
        {tab === 'duyurular' && unreadAnnouncements > 0 && (
          <Button size="sm" variant="outline" className="ml-auto h-8" onClick={() => void readAllAnnouncements()}>
            <CheckCheck className="mr-1.5 h-3.5 w-3.5" />
            Tümünü okundu işaretle
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : loadError ? (
        <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
          <p>{loadError}</p>
          <Button variant="outline" className="mt-3" onClick={() => void load()}>
            Tekrar dene
          </Button>
        </div>
      ) : tab === 'konusmalar' ? (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <aside className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Kişi veya konu ara"
                className="pl-9"
              />
            </div>

            {/*
              NEDEN: liste yüksekliği sağdaki konuşma paneliyle aynı ölçüye
              bağlandı; aksi hâlde iki kolon farklı uzayıp sayfa gereksiz
              şekilde aşağı kayıyor ve gönder alanı ekran dışında kalıyordu.
            */}
            <div className="h-[calc(100vh-22rem)] min-h-[360px] space-y-2 overflow-y-auto pr-1">
              {!visibleThreads.length ? (
                <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
                  Konuşma bulunamadı. "Yeni konuşma" ile ilk mesajınızı gönderebilirsiniz.
                </p>
              ) : (
                visibleThreads.map((thread) => (
                  <ThreadRow
                    key={thread.id}
                    thread={thread}
                    active={thread.id === activeId}
                    onOpen={() => void openThread(thread.id)}
                  />
                ))
              )}
            </div>
          </aside>

          {/*
            NEDEN: panel `min-h` ile sınırsız uzuyordu; mesaj sayısı arttıkça
            kutu ekranı tamamen kaplıyor ve "Gönder" düğmesi görünür alanın
            altına düşüyordu. Sabit yükseklik + iç kaydırma ile başlık ve
            gönderim alanı her zaman ekranda kalır.
          */}
          <section className="flex h-[calc(100vh-22rem)] min-h-[360px] flex-col overflow-hidden rounded-2xl border bg-card">
            {detailLoading ? (
              <div className="flex flex-1 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : !detail ? (
              <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
                Soldan bir konuşma seçin.
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-extrabold">
                      {detail.thread.peer_name || detail.thread.peer_email}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {[detail.thread.subject, detail.thread.student_name, roleLabel(viewer?.role ?? '')]
                        .filter((v) => v && v !== '—')
                        .join(' · ')}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={() => void toggleArchive(detail.thread)}
                  >
                    {detail.thread.status === 'arsiv' ? (
                      <>
                        <ArchiveRestore className="mr-1.5 h-3.5 w-3.5" />
                        Arşivden çıkar
                      </>
                    ) : (
                      <>
                        <Archive className="mr-1.5 h-3.5 w-3.5" />
                        Arşivle
                      </>
                    )}
                  </Button>
                  {/*
                    Konuşmayı silme arşivlemeden ayrı tutulur: arşiv geri
                    alınabilir, silme kalıcıdır. Sunucu bu işlemi yalnızca
                    konuşmayı başlatan kişiye veya yöneticiye açar.
                  */}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-red-600"
                    onClick={() => void removeThread(detail.thread)}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Konuşmayı sil
                  </Button>
                </div>

                {/* NEDEN: `min-h-0` olmadan flex çocuğu küçülmez ve kaydırma çalışmaz. */}
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
                  {!detail.messages.length ? (
                    <p className="text-sm text-muted-foreground">Bu konuşmada henüz mesaj yok.</p>
                  ) : (
                    detail.messages.map((message) => (
                      <MessageBubble
                        key={message.id}
                        message={message}
                        canModerate={Boolean(viewer?.can_moderate)}
                        onEdit={(item) => void editMessage(item)}
                        onDelete={(item) => void removeMessage(item)}
                      />
                    ))
                  )}
                </div>

                {/* NEDEN: gönderim alanı hiçbir koşulda kaydırmayla itilmemeli. */}
                <div className="shrink-0 border-t bg-card px-4 py-3">
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={2}
                    placeholder="Mesajınızı yazın…"
                  />
                  <div className="mt-2 flex justify-end">
                    <Button disabled={sending || !draft.trim()} onClick={() => void send()}>
                      {sending ? (
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="mr-1.5 h-4 w-4" />
                      )}
                      Gönder
                    </Button>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      ) : (
        <div className="space-y-2">
          {!visibleAnnouncements.length ? (
            <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
              Size yönelik duyuru yok. Yeni duyurular yayınlandığında burada listelenir.
            </div>
          ) : (
            visibleAnnouncements.map((item) => (
              <div
                key={item.id}
                className={`rounded-2xl border px-4 py-3 ${item.read ? 'bg-card' : 'border-primary/40 bg-primary/5'}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                      IMPORTANCE_TONES[item.importance] ?? IMPORTANCE_TONES.normal
                    }`}
                  >
                    {IMPORTANCE_LABELS[item.importance] ?? item.importance}
                  </span>
                  {item.pinned && (
                    <span className="flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-800">
                      <Pin className="h-3 w-3" />
                      Sabit
                    </span>
                  )}
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold">
                    {audienceLabelOf(item)}
                  </span>
                  {!item.read && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-800">
                      Okunmadı
                    </span>
                  )}
                  <span className="ml-auto text-[11px] font-bold tabular-nums text-muted-foreground">
                    {stampOf(item.publish_at || item.created_at)}
                  </span>
                </div>

                <p className="mt-2 text-sm font-extrabold">{item.title}</p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">{item.body}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Yayınlayan: {item.author_name || item.author_email}
                </p>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {!item.read && (
                    <Button size="sm" variant="outline" className="h-8" onClick={() => void readAnnouncement(item)}>
                      Okundu işaretle
                    </Button>
                  )}
                  {/*
                    Düzenleme, yayından kaldırma ve silme yalnızca duyurunun
                    yazarına veya duyuru yetkisi olan hesaba gösterilir; aynı
                    kural sunucuda da uygulanır, bu yüzden düğmeyi gizlemek tek
                    savunma değildir.
                  */}
                  {(item.mine || viewer?.can_moderate) && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        onClick={() => void editAnnouncement(item)}
                      >
                        <Pencil className="mr-1.5 h-3.5 w-3.5" />
                        Düzenle
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        onClick={() => void toggleAnnouncementArchive(item, true)}
                      >
                        <Archive className="mr-1.5 h-3.5 w-3.5" />
                        Yayından kaldır
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-red-600"
                        onClick={() => void removeAnnouncement(item)}
                      >
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                        Sil
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      <ComposeDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
        /*
          Kutu, DUYURU yetkisine değil mesaj kapsamına bağlanır: öğretmen duyuru
          yayınlayamaz ama kurumdaki veli ve öğrencilere mesaj gönderebilmelidir.
          İki bayrak karıştırılırsa öğretmende "tüm kuruma gönder" hiç görünmez.
        */
        canMessageSchool={Boolean(viewer?.can_message_school)}
        onCreated={(thread) => {
          setTab('konusmalar');
          void load().then(() => setActiveId(thread.id));
        }}
      />

      <AnnouncementDialog open={announceOpen} onOpenChange={setAnnounceOpen} onCreated={() => void load()} />

      <PageGuide storageKey="mesajlar" {...MESSAGES_GUIDE} />
    </div>
  );
}

/** Hedef kitle etiketi: sunucunun okunur etiketi varsa o, yoksa tür adı. */
function audienceLabelOf(item: MessagingAnnouncement): string {
  const labels = String(item.audience_labels ?? '').trim();
  if (labels) return labels;
  const type = String(item.audience_type ?? '').trim();
  const found = AUDIENCE_TYPES.find((a) => a.value === type);
  return found?.label ?? (type || 'Tüm kurum');
}

export default function MessagesPage() {
  return (
    <SiteLayout requireAuth>
      <MessagesBody />
    </SiteLayout>
  );
}

export { MessagingError };
