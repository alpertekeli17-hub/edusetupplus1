/**
 * Platform yönetimi (süper admin) sayfası: www.adres/admin
 *
 * Süper admin buradan:
 * - Yeni okul/kurs ekler, kayıt isteklerini onaylar veya askıya alır.
 * - Lisans planı, kullanıcı sınırı ve bitiş tarihini belirler.
 * - Her kuruma yönetici atar ve o yöneticinin giriş şifresini kendisi belirler.
 * - Diğer süper adminleri tanımlar.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Copy,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import SiteLayout, { useSession } from '@/components/SiteLayout';
import AccountPasswordPanel from '@/components/AccountPasswordPanel';
import MemberManager from '@/components/PermissionManager';
import StorageUsagePanel from '@/components/StorageUsagePanel';
import TermArchivePanel from '@/components/TermArchivePanel';
import IyzicoKeysPanel from '@/components/IyzicoKeysPanel';
import TopicCatalogPanel from '@/components/TopicCatalogPanel';
import {
  purgeStaleSessions,
  setUserPassword,
  type SessionPurgeStats,
} from '@/lib/portalAuth';
import {
  PERMISSION_LABELS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  parsePermissionOverrides,
  resolvePermissions,
} from '@/lib/site';
import {
  MEMBERSHIP_STATUS_LABELS,
  SCHOOL_PLANS,
  SCHOOL_PLAN_LABELS,
  SCHOOL_PLAN_SPECS,
  formatPlanPrice,
  SCHOOL_STATUS_LABELS,
  SEED_SUPER_ADMIN_EMAILS,
  addDaysISO,
  createPlatformAdmin,
  clampSeatLimit,
  createSchool,
  deletePlatformAdmin,
  planSpecOf,
  fetchMemberships,
  fetchPlatformAdmins,
  fetchSchools,
  normalizeEmail,
  todayISO,
  updateSchool,
  type Membership,
  type PlatformAdmin,
  type Role,
  type School,
  type SchoolPlan,
  type SchoolStatus,
} from '@/lib/tenant';

/**
 * Kolay okunur, güçlü bir giriş şifresi üretir.
 *
 * Şifreyi yönetici belirler; boş alan bırakıldığında üretilen değer ekranda
 * gösterilip kullanıcıya iletildiği için karıştırılması kolay karakterler
 * (0/O, 1/I) alfabeye hiç alınmaz.
 */
function generateStrongPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const pool = upper + lower + digits;
  const pick = (set: string) => set[Math.floor(Math.random() * set.length)];
  let out = pick(upper) + pick(lower) + pick(digits);
  for (let i = 0; i < 7; i += 1) out += pick(pool);
  return out;
}

function StatusPill({ status }: { status: SchoolStatus }) {
  const tone =
    status === 'aktif'
      ? 'bg-emerald-100 text-emerald-800'
      : status === 'beklemede'
        ? 'bg-amber-100 text-amber-800'
        : 'bg-red-100 text-red-800';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${tone}`}>
      {SCHOOL_STATUS_LABELS[status]}
    </span>
  );
}

/**
 * Oturum kaydı bakımı: süresi geçmiş ve iptal edilmiş portal oturumlarını siler.
 *
 * Sunucu bu temizliği girişlerle birlikte kendiliğinden (en fazla saatte bir)
 * yapar; buradaki düğme süper adminin bakımı hemen tetikleyip sonucu görmesi
 * içindir. Aktif oturumlar etkilenmez.
 */
function SessionMaintenancePanel() {
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<SessionPurgeStats | null>(null);

  async function runPurge() {
    setBusy(true);
    try {
      const result = await purgeStaleSessions();
      setStats(result);
      toast.success(
        result.deleted > 0
          ? `${result.deleted} eski oturum kaydı silindi.`
          : 'Silinecek eski oturum kaydı bulunmadı.',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Temizlik yapılamadı.');
    } finally {
      setBusy(false);
    }
  }

  const rows: { label: string; value: number }[] = stats
    ? [
        { label: 'Silinen kayıt', value: stats.deleted },
        { label: 'Süresi geçmiş', value: stats.expired },
        { label: 'İptal edilmiş', value: stats.revoked },
        { label: 'Eski biçimli', value: stats.legacy },
        { label: 'Kalan kayıt', value: stats.remaining },
      ]
    : [];

  return (
    <section className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h2 className="text-lg font-extrabold">Oturum kaydı bakımı</h2>
      </div>
      <p className="rounded-xl border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
        Süresi geçmiş ve iptal edilmiş giriş oturumları sunucuda otomatik olarak temizlenir.
        Bakımı hemen çalıştırmak isterseniz aşağıdaki düğmeyi kullanın. Kullanımda olan aktif
        oturumlar silinmez, kimse sistemden atılmaz.
      </p>
      <Button onClick={runPurge} disabled={busy}>
        {busy ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        ) : (
          <Trash2 className="mr-1.5 h-4 w-4" />
        )}
        Eski oturumları temizle
      </Button>
      {stats && (
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {rows.map((row) => (
            <div key={row.label} className="rounded-xl border bg-muted/20 px-3 py-2">
              <p className="text-[11px] font-semibold text-muted-foreground">{row.label}</p>
              <p className="text-base font-extrabold">{row.value.toLocaleString('tr-TR')}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

type SectionKey = 'kurumlar' | 'kullanicilar' | 'yetki';

/** Oklu, açılır/kapanır bölüm başlığı. */
function SectionToggle({
  title,
  icon,
  open,
  onToggle,
  note,
}: {
  title: string;
  icon: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  note?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex items-center gap-2 rounded-lg py-1 text-left hover:text-primary"
    >
      <ChevronDown
        className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? '' : '-rotate-90'}`}
      />
      {icon}
      <h2 className="text-lg font-extrabold">{title}</h2>
      {note && <span className="text-xs font-semibold text-muted-foreground">{note}</span>}
    </button>
  );
}

function PlatformAdminBody() {
  const { user } = useSession();
  const [schools, setSchools] = useState<School[]>([]);
  const [members, setMembers] = useState<Membership[]>([]);
  const [admins, setAdmins] = useState<PlatformAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** Bölümlerin açık/kapalı durumu (başlıktaki okla değişir). */
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    kurumlar: true,
    kullanicilar: true,
    yetki: true,
  });
  const toggleSection = (key: SectionKey) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  /* Kurum kullanıcıları filtreleri */
  const [userQuery, setUserQuery] = useState('');
  const [userSchool, setUserSchool] = useState('');
  const [userRole, setUserRole] = useState('');
  const [userStatus, setUserStatus] = useState('');
  /*
    Yalın görünüm: sayfa üç sekmeye ayrılır. Üstteki kurum seçici (`userSchool`)
    tek karar noktasıdır; kurum listesi, kullanıcı listesi ve yetki düzenleme
    aynı seçimi kullanır, böylece kurumlar birbirine karışmadan ayrı görülür.
  */
  const [view, setView] = useState<'kurumlar' | 'kullanicilar' | 'ayarlar'>('kurumlar');
  const [schoolQuery, setSchoolQuery] = useState('');
  const [schoolStatusFilter, setSchoolStatusFilter] = useState('');
  const filteredSchools = useMemo(() => {
    const q = schoolQuery.trim().toLocaleLowerCase('tr');
    return schools.filter((s) => {
      if (userSchool && String(s.id) !== userSchool) return false;
      if (schoolStatusFilter && s.status !== schoolStatusFilter) return false;
      if (q && !`${s.name ?? ''} ${s.city ?? ''}`.toLocaleLowerCase('tr').includes(q)) return false;
      return true;
    });
  }, [schools, userSchool, schoolStatusFilter, schoolQuery]);
  const filteredMembers = useMemo(() => {
    const q = userQuery.trim().toLocaleLowerCase('tr');
    return members.filter((m) => {
      if (userSchool && String(m.school_id) !== userSchool) return false;
      if (userRole && m.role !== userRole) return false;
      if (userStatus && m.status !== userStatus) return false;
      if (q && !`${m.full_name ?? ''} ${m.email ?? ''}`.toLocaleLowerCase('tr').includes(q)) {
        return false;
      }
      return true;
    });
  }, [members, userQuery, userSchool, userRole, userStatus]);
  /*
    Yönetici şifresini belirlediğinde bilgiler yalnızca o an gösterilir: sunucu
    şifreyi geri okunamaz biçimde sakladığı için ekrandan kaldırıldıktan sonra
    yeniden görüntülenemez. Kalıcı gösterim vaadi verilmemesi bilinçli.
  */
  const [lastInvite, setLastInvite] = useState<{
    schoolId: number;
    email: string;
    password: string;
    schoolName?: string;
    created: boolean;
  } | null>(null);

  // Yeni kurum formu
  const [name, setName] = useState('');
  const [type, setType] = useState('okul');
  const [city, setCity] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [plan, setPlan] = useState<SchoolPlan>('standart');
  const [seats, setSeats] = useState(String(SCHOOL_PLAN_SPECS.standart.defaultSeats));

  // Kurum satırlarında düzenlenen kullanıcı sınırı taslakları (kurum id → değer)
  const [seatDrafts, setSeatDrafts] = useState<Record<number, string>>({});

  // Kurum listesi kalabalıklaşmasın diye satırda yalnızca kurum adı ve durumu
  // görünür; plan, kontenjan ve satın alma detayı ok ile açılan satırda gösterilir.
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  /** Bir kurumun detay satırını açar veya kapatır. */
  const toggleExpanded = (schoolId: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(schoolId)) next.delete(schoolId);
      else next.add(schoolId);
      return next;
    });
  };

  // Yetki düzenleme bölümü: hangi kurum ve hangi kullanıcı açık
  const [permSchoolId, setPermSchoolId] = useState<number | null>(null);
  const [permMemberId, setPermMemberId] = useState<number | null>(null);

  // Süper admin formu
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newAdminName, setNewAdminName] = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const [schoolList, memberList, adminList] = await Promise.all([
          fetchSchools(),
          fetchMemberships(),
          fetchPlatformAdmins(),
        ]);
        setSchools(schoolList);
        setMembers(memberList);
        setAdmins(adminList);
      } catch (e) {
        const err = e as { data?: { detail?: string }; message?: string };
        setError(err?.data?.detail || err?.message || 'Platform verileri yüklenemedi.');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const memberCount = useMemo(() => {
    const map = new Map<number, number>();
    members.forEach((m) => {
      const key = Number(m.school_id);
      map.set(key, (map.get(key) ?? 0) + 1);
    });
    return map;
  }, [members]);

  /** Yetki düzenleme bölümünde açık olan kurum. */
  const permSchool = useMemo(
    () => schools.find((s) => Number(s.id) === Number(permSchoolId)) ?? null,
    [schools, permSchoolId],
  );

  /** Seçili kurumun kullanıcıları (yetki paneline verilir). */
  const permMembers = useMemo(
    () => members.filter((m) => Number(m.school_id) === Number(permSchoolId)),
    [members, permSchoolId],
  );

  /** Bir kullanıcının yetki düzenleme formunu açar. */
  const openPermissions = (member: Membership) => {
    setPermSchoolId(Number(member.school_id));
    setPermMemberId(Number(member.id));
    // Bölüm sayfanın altında olduğu için odağı oraya taşıyoruz.
    window.setTimeout(() => {
      document.getElementById('yetki-duzenleme')?.scrollIntoView({ behavior: 'smooth' });
    }, 60);
  };

  /**
   * Yetki panelinden gelen güncel kurum listesini genel listeye işler.
   * Seçili kuruma ait eski satırlar çıkarılır, gelen satırlar eklenir.
   */
  const applyPermMembers = (next: Membership[]) => {
    setMembers((prev) => [
      ...prev.filter((m) => Number(m.school_id) !== Number(permSchoolId)),
      ...next,
    ]);
    if (permMemberId && !next.some((m) => Number(m.id) === Number(permMemberId))) {
      setPermMemberId(null);
    }
  };

  const stats = useMemo(() => {
    const total = schools.length;
    const active = schools.filter((s) => s.status === 'aktif').length;
    const waiting = schools.filter((s) => s.status === 'beklemede').length;
    return { total, active, waiting, users: members.length };
  }, [schools, members]);

  /**
   * Kurum yöneticisi hesabını açar ve giriş şifresini doğrudan belirler.
   *
   * Erişim kodu / e-posta gönderimi akışı bilinçli olarak kaldırıldı: şifreyi
   * yönetici belirler, paylaşımı kullanıcıya kendisi yapar. Hesap `must_change`
   * ile açıldığı için bu geçici şifre ilk girişte değiştirilir ve yöneticinin
   * bildiği değer kalıcı olmaz.
   */
  const inviteSchoolAdmin = async (
    school: School,
    email: string,
    fullName: string,
    password?: string,
    role: Role = 'admin',
  ) => {
    const clean = normalizeEmail(email);
    if (!clean.includes('@')) {
      toast.error('Geçerli bir yönetici e-postası girin.');
      return;
    }
    const secret = (password ?? '').trim() || generateStrongPassword();
    const result = await setUserPassword({
      email: clean,
      newPassword: secret,
      fullName: fullName.trim(),
      mustChange: true,
      role,
      schoolId: Number(school.id),
    });
    /*
      Sunucu üyeliği kendisi yazdığı için dönen hesap bilgisinden satır üretilir;
      aynı kurumun eski satırı varsa çıkarılır ki listede iki kayıt görünmesin.
    */
    const row: Membership = {
      id: Number(result.account.membership_id),
      school_id: Number(school.id),
      email: clean,
      full_name: fullName.trim(),
      role,
      permission_keys: '',
      status: 'aktif',
      invited_by: user?.email ?? 'platform',
      activated_at: todayISO(),
    };
    setMembers((prev) => [
      row,
      ...prev.filter(
        (m) => Number(m.id) !== row.id && normalizeEmail(m.email) !== clean,
      ),
    ]);
    setLastInvite({
      schoolId: Number(school.id),
      email: clean,
      password: secret,
      schoolName: school.name,
      created: result.created,
    });
    toast.success(
      result.created
        ? 'Kullanıcı hesabı açıldı. Giriş şifresini kullanıcıya iletin.'
        : 'Mevcut hesabın şifresi yenilendi.',
    );
  };

  /** Son üretilen giriş bilgilerini panoya kopyalar. */
  const copyInvite = async () => {
    if (!lastInvite) return;
    const text = [
      `${lastInvite.schoolName ?? 'Kurum'} · giriş bilgileri`,
      `Adres: ${window.location.origin}`,
      `E-posta: ${lastInvite.email}`,
      `Geçici şifre: ${lastInvite.password}`,
      'İlk girişte kendi şifrenizi belirlemeniz istenecek.',
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Giriş bilgileri kopyalandı.');
    } catch {
      toast.error('Kopyalama engellendi; bilgileri elle not alın.');
    }
  };

  /** Aynı kullanıcı için yeni bir geçici şifre üretir. */
  const regenerateInvitePassword = async () => {
    if (!lastInvite) return;
    const school = schools.find((s) => Number(s.id) === Number(lastInvite.schoolId));
    if (!school) {
      toast.error('Kurum bulunamadı.');
      return;
    }
    setBusy(true);
    try {
      await inviteSchoolAdmin(school, lastInvite.email, lastInvite.email);
    } catch (e) {
      const err = e as { data?: { detail?: string }; message?: string };
      toast.error(err?.data?.detail || err?.message || 'Şifre yenilenemedi.');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Listeden tek bir kullanıcının giriş şifresini yeniler.
   *
   * Kullanıcının KENDİ rolü gönderilir; sabit `admin` gönderilseydi şifre
   * yenileme işlemi öğretmen veya veli hesabını sessizce yöneticiye çevirirdi.
   */
  const renewMemberPassword = async (member: Membership) => {
    const school = schools.find((s) => Number(s.id) === Number(member.school_id));
    if (!school) {
      toast.error('Kullanıcının kurumu bulunamadı.');
      return;
    }
    if (!window.confirm(`${member.email} için yeni bir geçici şifre üretilsin mi?`)) return;
    setBusy(true);
    try {
      await inviteSchoolAdmin(
        school,
        member.email,
        member.full_name ?? '',
        undefined,
        member.role,
      );
    } catch (e) {
      const err = e as { data?: { detail?: string }; message?: string };
      toast.error(err?.data?.detail || err?.message || 'Şifre yenilenemedi.');
    } finally {
      setBusy(false);
    }
  };

  const addSchool = async () => {
    if (!name.trim()) {
      toast.error('Kurum adı zorunludur.');
      return;
    }
    setBusy(true);
    try {
      const seatLimit = clampSeatLimit(plan, Number(seats));
      const school = await createSchool({
        name: name.trim(),
        school_type: type,
        city: city.trim(),
        contact_email: normalizeEmail(adminEmail),
        admin_email: normalizeEmail(adminEmail),
        plan,
        status: 'aktif',
        seat_limit: seatLimit,
        expires_at: addDaysISO(planSpecOf(plan).validDays),
        activated_at: todayISO(),
        note: `Platform yöneticisi tarafından eklendi (${user?.email ?? ''})`,
      });
      setSchools((prev) => [school, ...prev]);
      if (normalizeEmail(adminEmail)) {
        await inviteSchoolAdmin(school, adminEmail, adminName, adminPassword);
      }
      setName('');
      setCity('');
      setAdminEmail('');
      setAdminName('');
      setAdminPassword('');
      toast.success('Kurum eklendi ve aktifleştirildi.');
    } catch (e) {
      const err = e as { data?: { detail?: string }; message?: string };
      toast.error(err?.data?.detail || err?.message || 'Kurum eklenemedi.');
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (school: School, status: SchoolStatus) => {
    setBusy(true);
    try {
      const updated = await updateSchool(school.id, {
        status,
        activated_at: status === 'aktif' ? school.activated_at || todayISO() : school.activated_at,
        expires_at: status === 'aktif' && !school.expires_at ? addDaysISO(365) : school.expires_at,
      });
      setSchools((prev) => prev.map((s) => (Number(s.id) === Number(school.id) ? updated : s)));
      toast.success(`${school.name} → ${SCHOOL_STATUS_LABELS[status]}`);
    } catch (e) {
      const err = e as { data?: { detail?: string }; message?: string };
      toast.error(err?.data?.detail || err?.message || 'Durum güncellenemedi.');
    } finally {
      setBusy(false);
    }
  };

  const changePlan = async (school: School, nextPlan: SchoolPlan) => {
    setBusy(true);
    try {
      const spec = planSpecOf(nextPlan);
      // Plan değişince kullanıcı sınırı yeni planın üst sınırına sığdırılır.
      const currentSeats = Number(school.seat_limit) || spec.defaultSeats;
      const nextSeats = clampSeatLimit(nextPlan, currentSeats);
      const updated = await updateSchool(school.id, {
        plan: nextPlan,
        seat_limit: nextSeats,
        expires_at: addDaysISO(spec.validDays),
      });
      setSchools((prev) => prev.map((s) => (Number(s.id) === Number(school.id) ? updated : s)));
      setSeatDrafts((prev) => {
        const next = { ...prev };
        delete next[Number(school.id)];
        return next;
      });
      toast.success(
        nextSeats === currentSeats
          ? `Plan: ${SCHOOL_PLAN_LABELS[nextPlan]}`
          : `Plan: ${SCHOOL_PLAN_LABELS[nextPlan]} · kullanıcı sınırı ${nextSeats} olarak ayarlandı`,
      );
    } catch (e) {
      const err = e as { data?: { detail?: string }; message?: string };
      toast.error(err?.data?.detail || err?.message || 'Plan güncellenemedi.');
    } finally {
      setBusy(false);
    }
  };

  /** Süper admin kurumun kullanıcı (koltuk) sınırını günceller. */
  const saveSeatLimit = async (school: School) => {
    const raw = seatDrafts[Number(school.id)];
    const parsed = Number(raw);
    if (!raw || !Number.isFinite(parsed) || parsed < 1) {
      toast.error('Geçerli bir kullanıcı sınırı girin (en az 1).');
      return;
    }
    const spec = planSpecOf(school.plan);
    const used = memberCount.get(Number(school.id)) ?? 0;
    if (parsed < used) {
      toast.error(`Kurumda zaten ${used} kullanıcı var. Sınır bunun altına indirilemez.`);
      return;
    }
    const nextSeats = clampSeatLimit(school.plan, parsed);
    if (nextSeats !== Math.round(parsed)) {
      toast.error(
        `${spec.label} planında en fazla ${spec.maxSeats} kullanıcı tanımlanabilir. Daha fazlası için planı yükseltin.`,
      );
      return;
    }
    if (nextSeats === Number(school.seat_limit)) {
      setSeatDrafts((prev) => {
        const next = { ...prev };
        delete next[Number(school.id)];
        return next;
      });
      return;
    }
    setBusy(true);
    try {
      const updated = await updateSchool(school.id, { seat_limit: nextSeats });
      setSchools((prev) => prev.map((s) => (Number(s.id) === Number(school.id) ? updated : s)));
      setSeatDrafts((prev) => {
        const next = { ...prev };
        delete next[Number(school.id)];
        return next;
      });
      toast.success(`${school.name} kullanıcı sınırı: ${nextSeats}`);
    } catch (e) {
      const err = e as { data?: { detail?: string }; message?: string };
      toast.error(err?.data?.detail || err?.message || 'Kullanıcı sınırı güncellenemedi.');
    } finally {
      setBusy(false);
    }
  };

  const inviteExistingSchoolAdmin = async (school: School) => {
    const email = window.prompt(`${school.name} için yönetici e-postası:`, school.admin_email ?? '');
    if (!email) return;
    const fullName = window.prompt('Yöneticinin ad soyadı:', '') ?? '';
    const password = window.prompt(
      'Giriş şifresi (boş bırakırsanız güçlü bir şifre üretilir):',
      '',
    );
    if (password === null) return;
    setBusy(true);
    try {
      await inviteSchoolAdmin(school, email, fullName, password);
      const updated = await updateSchool(school.id, { admin_email: normalizeEmail(email) });
      setSchools((prev) => prev.map((s) => (Number(s.id) === Number(school.id) ? updated : s)));
    } catch (e) {
      const err = e as { data?: { detail?: string }; message?: string };
      toast.error(err?.data?.detail || err?.message || 'Yönetici hesabı açılamadı.');
    } finally {
      setBusy(false);
    }
  };

  const addAdmin = async () => {
    const email = normalizeEmail(newAdminEmail);
    if (!email.includes('@')) {
      toast.error('Geçerli bir e-posta girin.');
      return;
    }
    if (admins.some((a) => normalizeEmail(a.email) === email)) {
      toast.error('Bu e-posta zaten süper admin.');
      return;
    }
    setBusy(true);
    try {
      const created = await createPlatformAdmin({
        email,
        full_name: newAdminName.trim(),
        added_by: user?.email ?? '',
      });
      setAdmins((prev) => [created, ...prev]);
      setNewAdminEmail('');
      setNewAdminName('');
      toast.success('Süper admin eklendi.');
    } catch (e) {
      const err = e as { data?: { detail?: string }; message?: string };
      toast.error(err?.data?.detail || err?.message || 'Süper admin eklenemedi.');
    } finally {
      setBusy(false);
    }
  };

  const removeAdmin = async (admin: PlatformAdmin) => {
    if (!window.confirm(`${admin.email} süper admin yetkisini kaldırmak istiyor musunuz?`)) return;
    setBusy(true);
    try {
      await deletePlatformAdmin(admin.id);
      setAdmins((prev) => prev.filter((a) => Number(a.id) !== Number(admin.id)));
      toast.success('Süper admin kaldırıldı.');
    } catch (e) {
      const err = e as { data?: { detail?: string }; message?: string };
      toast.error(err?.data?.detail || err?.message || 'Kaldırılamadı.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Building2 className="h-5 w-5" />
        </span>
        <div className="mr-auto">
          <h1 className="text-xl font-extrabold">Platform yönetimi</h1>
          <p className="text-xs text-muted-foreground">
            Okul/kurs üyelikleri, lisans durumları, kurum yöneticileri ve süper adminler.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm font-semibold text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Kayıtlı kurum', value: stats.total },
          { label: 'Aktif kurum', value: stats.active },
          { label: 'Onay bekleyen', value: stats.waiting },
          { label: 'Toplam kullanıcı', value: stats.users },
        ].map((card) => (
          <div key={card.label} className="rounded-2xl border bg-card p-4">
            <p className="text-xs font-semibold text-muted-foreground">{card.label}</p>
            <p className="mt-1 text-2xl font-extrabold tabular-nums">{card.value}</p>
          </div>
        ))}
      </div>

      {/* Sekmeler + tek kurum seçici */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card p-2">
        {(
          [
            { key: 'kurumlar', label: 'Kurumlar' },
            { key: 'kullanicilar', label: 'Kullanıcılar ve yetkiler' },
            { key: 'ayarlar', label: 'Platform ayarları' },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setView(t.key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-bold transition-colors ${
              view === t.key ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
            }`}
          >
            {t.label}
          </button>
        ))}
        {view !== 'ayarlar' && (
          <div className="ml-auto flex items-center gap-2">
            <Label htmlFor="focus-school" className="text-xs text-muted-foreground">
              Kurum
            </Label>
            <select
              id="focus-school"
              value={userSchool}
              onChange={(e) => {
                setUserSchool(e.target.value);
                setPermSchoolId(e.target.value ? Number(e.target.value) : null);
                setPermMemberId(null);
              }}
              className="h-9 rounded-lg border bg-background px-2 text-sm"
            >
              <option value="">Tüm kurumlar</option>
              {schools.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {lastInvite && (
        <section className="space-y-3 rounded-2xl border-2 border-primary/40 bg-primary/5 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <KeyRound className="h-5 w-5" />
            </span>
            <div className="mr-auto">
              <h2 className="text-base font-extrabold">
                {lastInvite.created ? 'Hesap açıldı' : 'Şifre yenilendi'}
              </h2>
              <p className="text-xs text-muted-foreground">
                {lastInvite.schoolName || 'Kurum'} · bu bilgiler yalnızca şimdi görünür, sayfadan
                ayrıldıktan sonra tekrar gösterilemez.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => void copyInvite()}>
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              Kopyala
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void regenerateInvitePassword()}
              disabled={busy}
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Yeni şifre üret
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setLastInvite(null)}>
              Kapat
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border bg-card px-3 py-2">
              <p className="text-[11px] font-semibold text-muted-foreground">Giriş e-postası</p>
              <p className="font-mono text-sm">{lastInvite.email}</p>
            </div>
            <div className="rounded-xl border bg-card px-3 py-2">
              <p className="text-[11px] font-semibold text-muted-foreground">Geçici giriş şifresi</p>
              <p className="font-mono text-sm tracking-wider">{lastInvite.password}</p>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Kullanıcı bu şifreyle giriş yapar; ilk girişte kendi şifresini belirlemesi zorunludur.
            Şifre yalnızca yönetici tarafından belirlenir, kullanıcıya e-posta gönderilmez.
          </p>
        </section>
      )}

      {view === 'kurumlar' && (
      <>
      <section className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Plus className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-lg font-extrabold">Kurum ekle</h2>
            <p className="text-xs text-muted-foreground">
              Kurumu ekleyin ve yöneticisinin giriş şifresini belirleyin. Şifreyi yöneticiye
              ilettikten sonra kendi kullanıcılarını oluşturacak.
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="s-name">Kurum adı</Label>
            <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-type">Tür</Label>
            <select
              id="s-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="okul">Okul</option>
              <option value="kurs">Kurs / Etüt merkezi</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-city">Şehir</Label>
            <Input id="s-city" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-admin">Yönetici e-postası</Label>
            <Input
              id="s-admin"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              placeholder="mudur@okul.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-adminname">Yönetici ad soyad</Label>
            <Input
              id="s-adminname"
              value={adminName}
              onChange={(e) => setAdminName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-adminpass">Yönetici giriş şifresi</Label>
            <div className="flex gap-2">
              <Input
                id="s-adminpass"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                placeholder="Boş bırakılırsa güçlü şifre üretilir"
                className="font-mono"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => setAdminPassword(generateStrongPassword())}
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Üret
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Şifreyi siz belirlersiniz; kullanıcı ilk girişte kendi şifresini oluşturur.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="s-plan">Plan</Label>
              <select
                id="s-plan"
                value={plan}
                onChange={(e) => {
                  const nextPlan = e.target.value as SchoolPlan;
                  setPlan(nextPlan);
                  // Plan seçilince önerilen kullanıcı sınırı otomatik gelir.
                  setSeats(String(planSpecOf(nextPlan).defaultSeats));
                }}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                {SCHOOL_PLANS.map((p) => (
                  <option key={p} value={p}>
                    {SCHOOL_PLAN_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-seats">Kullanıcı sınırı</Label>
              <Input
                id="s-seats"
                type="number"
                min={1}
                max={planSpecOf(plan).maxSeats}
                value={seats}
                onChange={(e) => setSeats(e.target.value)}
                className="tabular-nums"
              />
            </div>
          </div>
        </div>

        {/* Dört plan dört kolonda; her kartta öğrenci sınırı, bedel ve kullanıcı üst sınırı. */}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {SCHOOL_PLANS.map((p) => {
            const spec = SCHOOL_PLAN_SPECS[p];
            const active = p === plan;
            return (
              <div
                key={p}
                className={`rounded-xl border px-3 py-2.5 text-xs ${
                  active ? 'border-primary bg-primary/5' : 'bg-muted/20'
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-extrabold">{spec.label}</p>
                  <span className="font-bold tabular-nums text-muted-foreground">
                    {formatPlanPrice(p)}
                  </span>
                </div>
                <p className="mt-1 font-semibold tabular-nums">
                  {spec.studentLimit.toLocaleString('tr-TR')} öğrenci sınırı
                </p>
                <ul className="mt-1 space-y-0.5 text-muted-foreground">
                  {spec.highlights.map((h) => (
                    <li key={h}>· {h}</li>
                  ))}
                  <li>· Kullanıcı üst sınırı: {spec.maxSeats}</li>
                </ul>
              </div>
            );
          })}
        </div>

        <Button onClick={addSchool} disabled={busy}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Kurumu ekle ve aktifleştir
        </Button>
      </section>

      <section className="space-y-3">
        <SectionToggle
          title="Kurumlar"
          icon={<Users className="h-4 w-4 text-primary" />}
          open={openSections.kurumlar}
          onToggle={() => toggleSection('kurumlar')}
          note={`${filteredSchools.length}/${schools.length} kurum`}
        />
        {openSections.kurumlar && (
        <>
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card p-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={schoolQuery}
              onChange={(e) => setSchoolQuery(e.target.value)}
              placeholder="Kurum adı veya şehir ara"
              className="h-9 pl-8 text-sm"
            />
          </div>
          <select
            aria-label="Kurum durumu filtresi"
            value={schoolStatusFilter}
            onChange={(e) => setSchoolStatusFilter(e.target.value)}
            className="h-9 rounded-lg border bg-background px-2 text-sm"
          >
            <option value="">Tüm durumlar</option>
            {Object.entries(SCHOOL_STATUS_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          {(schoolQuery || schoolStatusFilter || userSchool) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSchoolQuery('');
                setSchoolStatusFilter('');
                setUserSchool('');
                setPermSchoolId(null);
              }}
            >
              Filtreyi temizle
            </Button>
          )}
        </div>
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-bold">Kurum</th>
                <th className="px-3 py-2 text-left font-bold">Durum</th>
                <th className="px-3 py-2 text-right font-bold">Detay</th>
              </tr>
            </thead>
            <tbody>
              {filteredSchools.map((s) => {
                const open = expandedIds.has(Number(s.id));
                return (
                  <Fragment key={s.id}>
                    <tr className="border-t">
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => toggleExpanded(Number(s.id))}
                          aria-expanded={open}
                          className="flex items-center gap-2 text-left font-semibold hover:text-primary"
                        >
                          {open ? (
                            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                          )}
                          {s.name}
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <StatusPill status={s.status} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 px-2 text-xs"
                          onClick={() => toggleExpanded(Number(s.id))}
                        >
                          {open ? 'Detayı kapat' : 'Detay'}
                        </Button>
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-t bg-muted/20">
                        <td colSpan={3} className="px-3 py-3">
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-1 text-xs">
                              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                                Kurum bilgisi
                              </p>
                              <p>
                                {(s.school_type === 'kurs' ? 'Kurs' : 'Okul') +
                                  (s.city ? ` · ${s.city}` : '')}
                              </p>
                              <p>Yönetici: {s.admin_email || '—'}</p>
                              {s.expires_at ? <p>Lisans bitişi: {s.expires_at}</p> : null}
                              <p className="text-muted-foreground">
                                Satın alma / kayıt notu: {s.note || '—'}
                              </p>
                            </div>
                            <div className="space-y-2 text-xs">
                              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                                Paket ve kontenjan
                              </p>
                              <select
                                value={s.plan ?? 'standart'}
                                onChange={(e) => changePlan(s, e.target.value as SchoolPlan)}
                                className="h-8 rounded-md border bg-background px-2 text-xs font-semibold"
                              >
                                {SCHOOL_PLANS.map((p) => (
                                  <option key={p} value={p}>
                                    {SCHOOL_PLAN_LABELS[p]}
                                  </option>
                                ))}
                              </select>
                              <div className="flex items-center gap-1.5">
                                <span className="tabular-nums text-sm font-semibold">
                                  {memberCount.get(Number(s.id)) ?? 0}
                                </span>
                                <span className="text-muted-foreground">/</span>
                                <Input
                                  type="number"
                                  min={1}
                                  max={planSpecOf(s.plan).maxSeats}
                                  value={
                                    seatDrafts[Number(s.id)] ??
                                    String(s.seat_limit ?? planSpecOf(s.plan).defaultSeats)
                                  }
                                  onChange={(e) =>
                                    setSeatDrafts((prev) => ({
                                      ...prev,
                                      [Number(s.id)]: e.target.value,
                                    }))
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') void saveSeatLimit(s);
                                  }}
                                  disabled={busy}
                                  className="h-8 w-20 tabular-nums px-2 text-xs"
                                  aria-label={`${s.name} kullanıcı sınırı`}
                                />
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 px-2 text-xs"
                                  onClick={() => void saveSeatLimit(s)}
                                  disabled={
                                    busy ||
                                    seatDrafts[Number(s.id)] === undefined ||
                                    seatDrafts[Number(s.id)] ===
                                      String(s.seat_limit ?? planSpecOf(s.plan).defaultSeats)
                                  }
                                >
                                  Kaydet
                                </Button>
                              </div>
                              <p className="text-[11px] text-muted-foreground">
                                {planSpecOf(s.plan).label} planı üst sınırı:{' '}
                                {planSpecOf(s.plan).maxSeats}
                              </p>
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {s.status !== 'aktif' && (
                              <Button
                                size="sm"
                                onClick={() => setStatus(s, 'aktif')}
                                disabled={busy}
                              >
                                Etkinleştir
                              </Button>
                            )}
                            {s.status === 'aktif' && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setStatus(s, 'askida')}
                                disabled={busy}
                              >
                                Askıya al
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => inviteExistingSchoolAdmin(s)}
                              disabled={busy}
                            >
                              <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                              Yönetici ata ve şifre belirle
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {!filteredSchools.length && (
                <tr>
                  <td colSpan={3} className="px-3 py-10 text-center text-sm text-muted-foreground">
                    {schools.length
                      ? 'Filtreye uyan kurum yok.'
                      : 'Henüz kayıtlı kurum yok. Yukarıdaki formdan ilk kurumu ekleyin.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </>
        )}
      </section>
      </>
      )}

      {view === 'kullanicilar' && (
      <>
      <section className="space-y-3">
        <SectionToggle
          title="Kurum kullanıcıları"
          icon={<Users className="h-4 w-4 text-primary" />}
          open={openSections.kullanicilar}
          onToggle={() => toggleSection('kullanicilar')}
          note={`${filteredMembers.length}/${members.length} kullanıcı`}
        />
        {openSections.kullanicilar && (
        <>
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card p-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
              placeholder="Ad veya e-posta ara"
              className="h-9 pl-8 text-sm"
            />
          </div>
          <select
            aria-label="Kurum filtresi"
            value={userSchool}
            onChange={(e) => setUserSchool(e.target.value)}
            className="h-9 rounded-lg border bg-background px-2 text-sm"
          >
            <option value="">Tüm kurumlar</option>
            {schools.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Rol filtresi"
            value={userRole}
            onChange={(e) => setUserRole(e.target.value)}
            className="h-9 rounded-lg border bg-background px-2 text-sm"
          >
            <option value="">Tüm roller</option>
            {Object.entries(ROLE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <select
            aria-label="Durum filtresi"
            value={userStatus}
            onChange={(e) => setUserStatus(e.target.value)}
            className="h-9 rounded-lg border bg-background px-2 text-sm"
          >
            <option value="">Tüm durumlar</option>
            {Object.entries(MEMBERSHIP_STATUS_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          {(userQuery || userSchool || userRole || userStatus) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setUserQuery('');
                setUserSchool('');
                setUserRole('');
                setUserStatus('');
              }}
            >
              Filtreyi temizle
            </Button>
          )}
        </div>
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-bold">Kullanıcı</th>
                <th className="px-3 py-2 text-left font-bold">Kurum</th>
                <th className="px-3 py-2 text-left font-bold">Rol</th>
                <th className="px-3 py-2 text-left font-bold">Durum</th>
                <th className="px-3 py-2 text-left font-bold">Şifre işlemi</th>
                <th className="px-3 py-2 text-left font-bold">Yetkiler</th>
                <th className="px-3 py-2 text-left font-bold">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {filteredMembers.slice(0, 200).map((m) => {
                const school = schools.find((s) => Number(s.id) === Number(m.school_id));
                return (
                  <tr key={m.id} className="border-t">
                    <td className="px-3 py-2">
                      <p className="font-semibold">{m.full_name || m.email}</p>
                      <p className="text-[11px] text-muted-foreground">{m.email}</p>
                    </td>
                    <td className="px-3 py-2 text-xs">{school?.name || `#${m.school_id}`}</td>
                    <td className="px-3 py-2 text-xs font-semibold">{ROLE_LABELS[m.role]}</td>
                    <td className="px-3 py-2 text-xs">{MEMBERSHIP_STATUS_LABELS[m.status]}</td>
                    <td className="px-3 py-2 text-xs">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => void renewMemberPassword(m)}
                        disabled={busy}
                      >
                        <RefreshCw className="mr-1 h-3 w-3" />
                        Şifre yenile
                      </Button>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {(() => {
                        /*
                          Etkin yetki = rol varsayılanı + eklenenler − kaldırılanlar.
                          Rolle gelen bir yetki kullanıcıya özel olarak kapatılmış
                          olabileceği için sayım doğrudan çözümlenmiş kümeden alınır.
                        */
                        const rolePerms = ROLE_PERMISSIONS[m.role] ?? [];
                        const effective = resolvePermissions(m.role, m.permission_keys);
                        const overrides = parsePermissionOverrides(m.permission_keys);
                        const extra = overrides.granted.filter((p) => !rolePerms.includes(p));
                        const removed = overrides.denied.filter((p) => rolePerms.includes(p));
                        return (
                          <div className="space-y-0.5">
                            <p className="font-semibold tabular-nums">{effective.size} yetki</p>
                            {extra.length > 0 && (
                              <p className="text-[11px] text-emerald-700">
                                + {extra.map((p) => PERMISSION_LABELS[p]).join(', ')}
                              </p>
                            )}
                            {removed.length > 0 && (
                              <p className="text-[11px] text-red-700">
                                − {removed.map((p) => PERMISSION_LABELS[p]).join(', ')}
                              </p>
                            )}
                            {!extra.length && !removed.length && (
                              <p className="text-[11px] text-muted-foreground">Rol varsayılanı</p>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openPermissions(m)}
                        disabled={busy}
                      >
                        <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                        Yetkileri düzenle
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {!filteredMembers.length && (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-sm text-muted-foreground">
                    {members.length
                      ? 'Filtreye uyan kullanıcı yok.'
                      : 'Henüz kurum kullanıcısı yok.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filteredMembers.length > 200 && (
          <p className="text-xs text-muted-foreground">
            İlk 200 kullanıcı gösteriliyor; daraltmak için filtreleri kullanın.
          </p>
        )}
        </>
        )}
      </section>

      <section id="yetki-duzenleme" className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <SectionToggle
            title="Yetki düzenleme"
            icon={<ShieldCheck className="h-4 w-4 text-primary" />}
            open={openSections.yetki}
            onToggle={() => toggleSection('yetki')}
          />
          <div className="ml-auto flex items-center gap-2">
            <Label htmlFor="perm-school" className="text-xs text-muted-foreground">
              Kurum
            </Label>
            <select
              id="perm-school"
              value={permSchoolId ?? ''}
              onChange={(e) => {
                setPermSchoolId(e.target.value ? Number(e.target.value) : null);
                setPermMemberId(null);
              }}
              className="h-9 rounded-lg border bg-background px-2 text-sm"
            >
              <option value="">Kurum seçin</option>
              {schools.map((s) => (
                <option key={s.id} value={Number(s.id)}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {!openSections.yetki ? null : permSchool ? (
          <MemberManager
            schoolId={Number(permSchool.id)}
            members={permMembers}
            onChanged={applyPermMembers}
            invitedBy={user?.email}
            seatLimit={Number(permSchool.seat_limit ?? 0) || undefined}
            focusMemberId={permMemberId}
          />
        ) : (
          <p className="rounded-2xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
            Yetkisini güncellemek istediğiniz kurumu seçin ya da yukarıdaki kullanıcı listesinden
            “Yetkileri düzenle” düğmesine basın.
          </p>
        )}
      </section>
      </>
      )}

      {view === 'ayarlar' && (
      <>
      <section className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h2 className="text-lg font-extrabold">Süper adminler</h2>
        </div>
        <div className="rounded-xl border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
          Kurucu süper admin: <span className="font-semibold">{SEED_SUPER_ADMIN_EMAILS.join(', ')}</span>{' '}
          (kaldırılamaz)
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="a-email">E-posta</Label>
            <Input
              id="a-email"
              value={newAdminEmail}
              onChange={(e) => setNewAdminEmail(e.target.value)}
              placeholder="admin@platform.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="a-name">Ad soyad</Label>
            <Input
              id="a-name"
              value={newAdminName}
              onChange={(e) => setNewAdminName(e.target.value)}
            />
          </div>
          <Button onClick={addAdmin} disabled={busy}>
            Ekle
          </Button>
        </div>
        <div className="divide-y rounded-xl border">
          {admins.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="text-sm font-semibold">{a.full_name || a.email}</span>
              <span className="text-xs text-muted-foreground">{a.email}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => removeAdmin(a)}
                disabled={busy}
                className="ml-auto text-destructive"
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Kaldır
              </Button>
            </div>
          ))}
          {!admins.length && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              Ek süper admin tanımlanmadı.
            </p>
          )}
        </div>
      </section>
      {/* Sınav bölümündeki sınıf/ders/konu seçeneklerinin kaynağı; düzenlenebilir. */}
      <TopicCatalogPanel />
      {/* iyzico API ve güvenlik anahtarı girişi; değerler sunucuda şifreli saklanır. */}
      <IyzicoKeysPanel />
      {/* Kurum bazlı depolama ölçümü: yalnızca görünürlük, kota uygulanmaz. */}
      <StorageUsagePanel />
      {/* Geçmiş dönemlerin ağır satırlarını nesne deposuna taşır, kazancı gösterir. */}
      <TermArchivePanel />
      {/* Süresi geçmiş / iptal edilmiş oturum kayıtlarının bakımı. */}
      <SessionMaintenancePanel />
      </>
      )}

      {/* Tüm kurumlardaki giriş hesapları kullanıcılarla birlikte durur. */}
      {view === 'kullanicilar' && <AccountPasswordPanel focusSchoolId={userSchool ? Number(userSchool) : null} />}
    </div>
  );
}

export default function PlatformAdminPage() {
  return (
    <SiteLayout requireSuperAdmin wide>
      <PlatformAdminBody />
    </SiteLayout>
  );
}