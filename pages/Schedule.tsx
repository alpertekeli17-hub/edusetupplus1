/**
 * Ders programı hazırlama sayfası.
 *
 * Referans yazılımın tüm işleyişi (ders / öğretmen / sınıf saat seçimleri,
 * gün ve periyot bazlı zaman güncellemeleri, otomatik program üretimi, elle
 * düzenleme, profil yönetimi, PDF / Excel / XML aktarımı) birebir korunur.
 * Portal katmanı yalnızca oturum, yetki, kalıcı kayıt (okul bazlı) ve
 * "veli/öğrenci gibi salt okunur haftalık görünüm" seçeneğini ekler.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Cloud, Eye, Loader2, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import SiteLayout, { useSession } from '@/components/SiteLayout';
import PageGuide from '@/components/PageGuide';
import StudentScheduleView from '@/components/StudentScheduleView';
import { SCHEDULE_GUIDE } from '@/lib/pageGuides';
import { resolveScheduleAccess } from '@/lib/scheduleView';
import { pullScheduler, pushScheduler } from '@/lib/cloud';
import '@/scheduler/lib/i18n';
import { readSchedulerBundle, schedulerSignature } from '@/scheduler/lib/bundle';
import SchedulerApp from '@/scheduler/pages/SchedulerIndex';

/** Otomatik kalıcı kayıt aralığı (ms). */
const AUTOSAVE_INTERVAL = 15000;

/** Öğretmen görünümü için görüntüleme modu. */
type ViewMode = 'edit' | 'read';

function ScheduleBody() {
  const { can, school, account, member, profile } = useSession();

  /*
    Rol ve yetki birlikte tek noktadan çözülür (`resolveScheduleAccess`).

    Onaylanan karar iki parçalıdır: öğretmenin VARSAYILANI kendi dersleriyle
    salt okunurdur (rol varsayılanında `manage_schedule` yoktur), yönetici
    kullanıcı bazında "Ders programı düzenleme" yetkisini verirse okul geneli
    düzenleme ekranı açılır.

    İki kural sayfa içinde ayrı ayrı yazıldığında çelişiyordu: `can(...) &&
    !teacherLedView` biçimindeki bir ifade öğretmene yetki verildiğinde bile
    düzenlemeyi kapatıyor, yani ikinci kuralı imkânsız kılıyordu. Kapsam
    (`readonlyScope`) ise role bağlı kalır; yetkiye bağlanırsa düzenleme
    yetkisi olmayan öğretmen veli/öğrenci moduna düşer ve kendi programı
    yerine boş bir "sınıf bilgisi bulunamadı" ekranı görürdü.
  */
  const access = resolveScheduleAccess({
    role: member?.role,
    canManage: can('manage_schedule'),
  });
  const { teacherLedView, editable, readonlyScope } = access;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>(access.viewMode);
  const signatureRef = useRef('');

  // Kalıcı depodaki program varsa, referans arayüzü açılmadan önce
  // tarayıcı deposuna yazılır; böylece bileşenler doğru veriyle başlar.
  useEffect(() => {
    let alive = true;
    (async () => {
      const remote = await pullScheduler();
      if (!alive) return;
      if (remote?.savedAt) setSavedAt(remote.savedAt);
      signatureRef.current = schedulerSignature();
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const persist = useCallback(
    async (silent: boolean) => {
      if (!editable) return;
      setSaving(true);
      try {
        const ok = await pushScheduler(readSchedulerBundle());
        signatureRef.current = schedulerSignature();
        if (ok) {
          setSavedAt(new Date().toISOString());
          if (!silent) toast.success('Ders programı kalıcı olarak kaydedildi.');
        } else if (!silent) {
          toast.error('Kalıcı kayıt yapılamadı, tarayıcı kopyası korunuyor.');
        }
      } finally {
        setSaving(false);
      }
    },
    [editable],
  );

  // Referans arayüzü her değişikliği kendi deposuna yazdığı için, imza
  // değiştiğinde veriyi arka planda kalıcı depoya taşımak yeterlidir.
  useEffect(() => {
    if (loading || !editable || view === 'read') return;
    const timer = window.setInterval(() => {
      const current = schedulerSignature();
      if (current === signatureRef.current) return;
      signatureRef.current = current;
      void persist(true);
    }, AUTOSAVE_INTERVAL);
    return () => window.clearInterval(timer);
  }, [loading, editable, view, persist]);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {editable && (
        <div className="no-print flex flex-wrap items-center gap-2 rounded-2xl border bg-card px-4 py-3">
          <div className="mr-auto">
            <p className="text-sm font-extrabold">Ders programı</p>
            <p className="text-[11px] text-muted-foreground">
              {view === 'read'
                ? 'Salt okunur haftalık görünüm: veli ve öğrenci ekranıyla aynı tablo.'
                : 'Değişiklikler otomatik olarak okulunuzun kalıcı kaydına aktarılır.'}
            </p>
          </div>

          <div className="flex items-center gap-1 rounded-full border bg-background p-1">
            <Button
              variant={view === 'edit' ? 'default' : 'ghost'}
              size="sm"
              className="h-7 rounded-full px-3 text-xs"
              onClick={() => setView('edit')}
            >
              <Wrench className="mr-1.5 h-3.5 w-3.5" />
              Düzenleme
            </Button>
            <Button
              variant={view === 'read' ? 'default' : 'ghost'}
              size="sm"
              className="h-7 rounded-full px-3 text-xs"
              onClick={() => setView('read')}
            >
              <Eye className="mr-1.5 h-3.5 w-3.5" />
              Salt okunur
            </Button>
          </div>

          {view === 'edit' && savedAt && (
            <span className="text-[11px] text-muted-foreground">
              Son kayıt: {new Date(savedAt).toLocaleString('tr-TR')}
            </span>
          )}
          {view === 'edit' && (
            <Button variant="outline" size="sm" onClick={() => void persist(false)} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Cloud className="mr-1.5 h-3.5 w-3.5" />
              )}
              Şimdi kaydet
            </Button>
          )}
        </div>
      )}

      {/*
        Veli ve öğrenci hesabı ders programı modülünü hiç görmez: tanımlar,
        zaman ayarları, otomatik üretim, profil ve yedekleme araçlarının
        tamamı kapalıdır. Bu kullanıcılar yalnızca okulun yayınladığı
        programdan kendi sınıflarına atanmış ders saatlerini görür.

        Düzenleme yetkisi olan öğretmen de aynı salt okunur tabloyu kendi
        kimliğiyle süzülmüş hâlde açabilir; kendi programını veli/öğrencinin
        gördüğü düzenle görür (hangi gün, hangi saat, hangi sınıf).
      */}
      {editable && view === 'edit' ? (
        <div className="-mx-4 overflow-hidden rounded-2xl border sm:-mx-6">
          <SchedulerApp />
        </div>
      ) : (
        <StudentScheduleView
          mode={readonlyScope}
          schoolId={school?.id ? Number(school.id) : undefined}
          email={account?.email}
          fallbackName={readonlyScope === 'teacher' ? account?.full_name : profile?.student_name}
          fallbackClass={profile?.class_name}
        />
      )}

      {editable && view === 'edit' && <PageGuide storageKey="ders-programi" {...SCHEDULE_GUIDE} />}
      {editable && view === 'read' && (
        <p className="no-print text-[11px] text-muted-foreground">
          Salt okunur görünümdeyken değişiklik yapılamaz. Ders saati eklemek veya düzenlemek için
          "Düzenleme" sekmesine dönün.
          {member?.role === 'ogretmen' ? ' Bu tablo, öğretmen kaydınızdaki e-posta/ad eşleşmesiyle süzülür.' : ''}
        </p>
      )}

      {/*
        Öğretmenin ders programı artık varsayılan olarak düzenleme ekranına
        girmiyor: yalnızca kendi ders saatlerini görmesi gerekiyor. Eşleşmenin
        nasıl kurulduğu ve ne yapması gerektiği açıkça yazılır, çünkü kaydı
        bulunamayan öğretmen için tablo boş kalır ve "dersim yok" izlenimi
        doğabilir.
      */}
      {!editable && (
        <p className="no-print text-[11px] text-muted-foreground">
          {teacherLedView
            ? 'Bu görünüm salt okunurdur ve yalnızca size atanmış dersleri ve ders saatlerini gösterir: başka öğretmenlerin dersleri ve okul geneli düzenleme araçları bu ekranda yer almaz. Adınıza/e-postanıza ait kayıt görünmüyorsa okul yönetiminden ders programı tanımlarına kaydınızın eklenmesini isteyin.'
            : 'Bu görünüm salt okunurdur. Ders programını düzenlemek için okul yöneticinizden "Ders programı düzenleme" yetkisini isteyin.'}
        </p>
      )}
    </div>
  );
}

export default function SchedulePage() {
  return (
    <SiteLayout requireAuth>
      <ScheduleBody />
    </SiteLayout>
  );
}
