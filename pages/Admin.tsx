/**
 * Kurum yönetimi paneli: okul yöneticisi kendi kullanıcılarını açar, yetkilerini
 * belirler, giriş şifrelerini yönetir ve mali özeti görür.
 */
import { useEffect, useMemo, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import SiteLayout, { useSession } from '@/components/SiteLayout';
import PageGuide from '@/components/PageGuide';
import { ADMIN_GUIDE } from '@/lib/pageGuides';
import MemberManager from '@/components/PermissionManager';
import ParentAccountPanel from '@/components/ParentAccountPanel';
import AccountPasswordPanel from '@/components/AccountPasswordPanel';
import { ROLES, ROLE_LABELS, accountingSummary, fetchAccounting, formatTry } from '@/lib/site';
import {
  SCHOOL_PLAN_LABELS,
  fetchMemberships,
  type Membership,
  type SchoolPlan,
} from '@/lib/tenant';

function AdminBody() {
  const { member: me, school, user, reload } = useSession();
  const [members, setMembers] = useState<Membership[]>([]);
  const [finance, setFinance] = useState({
    collected: 0,
    pending: 0,
    overdue: 0,
    expense: 0,
    net: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const schoolId = Number(me?.school_id ?? 0);

  useEffect(() => {
    const load = async () => {
      if (!schoolId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const [memberList, entries] = await Promise.all([
          fetchMemberships(schoolId),
          fetchAccounting(),
        ]);
        setMembers(memberList);
        setFinance(accountingSummary(entries));
      } catch (e) {
        const err = e as { data?: { detail?: string }; message?: string };
        setError(err?.data?.detail || err?.message || 'Yönetim verileri yüklenemedi.');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [schoolId]);

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    members.forEach((m) => {
      map[m.role] = (map[m.role] ?? 0) + 1;
    });
    return map;
  }, [members]);

  const handleChanged = async (next: Membership[]) => {
    setMembers(next);
    const mine = next.find((m) => Number(m.id) === Number(me?.id));
    if (mine && mine.permission_keys !== me?.permission_keys) await reload();
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
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div className="mr-auto">
          <h1 className="text-xl font-extrabold">{school?.name || 'Kurum'} yönetimi</h1>
          <p className="text-xs text-muted-foreground">
            Kullanıcı hesapları, roller, ince yetkiler, giriş şifreleri ve mali özet.
          </p>
        </div>
        {school?.plan && (
          <span className="rounded-full border px-2.5 py-1 text-[11px] font-bold">
            {SCHOOL_PLAN_LABELS[school.plan as SchoolPlan] ?? school.plan} planı
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm font-semibold text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ROLES.map((r) => (
          <div key={r} className="rounded-2xl border bg-card p-4">
            <p className="text-xs font-semibold text-muted-foreground">{ROLE_LABELS[r]}</p>
            <p className="mt-1 text-2xl font-extrabold tabular-nums">{counts[r] ?? 0}</p>
          </div>
        ))}
      </div>

      <MemberManager
        schoolId={schoolId}
        members={members}
        onChanged={handleChanged}
        invitedBy={user?.email}
        seatLimit={school?.seat_limit}
      />

      {/*
        Veli hesapları elle tek tek açılmaz: kayıt defterinde zaten her
        öğrencinin veli e-postası var, bu yüzden hesaplar oradan üretilir.
        Panel kendi verisini sunucudan okur; hesaplar açıldıktan sonra kullanıcı
        listesi tazelenir ki yeni veliler tabloda görünsün.
      */}
      <ParentAccountPanel
        schoolId={schoolId}
        onProvisioned={async () => {
          try {
            setMembers(await fetchMemberships(schoolId));
          } catch {
            /* liste tazelenemezse panel kendi özetini göstermeye devam eder */
          }
        }}
      />

      <section className="space-y-3">
        <h2 className="text-lg font-extrabold">Mali özet</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border bg-card p-4">
            <p className="text-xs font-semibold text-muted-foreground">Tahsil edilen</p>
            <p className="mt-1 text-lg font-extrabold tabular-nums text-emerald-700">
              {formatTry(finance.collected)}
            </p>
          </div>
          <div className="rounded-2xl border bg-card p-4">
            <p className="text-xs font-semibold text-muted-foreground">Bekleyen</p>
            <p className="mt-1 text-lg font-extrabold tabular-nums text-amber-700">
              {formatTry(finance.pending)}
            </p>
          </div>
          <div className="rounded-2xl border bg-card p-4">
            <p className="text-xs font-semibold text-muted-foreground">Geciken</p>
            <p className="mt-1 text-lg font-extrabold tabular-nums text-red-700">
              {formatTry(finance.overdue)}
            </p>
          </div>
          <div className="rounded-2xl border bg-card p-4">
            <p className="text-xs font-semibold text-muted-foreground">Net durum</p>
            <p className="mt-1 text-lg font-extrabold tabular-nums text-primary">
              {formatTry(finance.net)}
            </p>
          </div>
        </div>
      </section>

      <PageGuide storageKey="yonetim" {...ADMIN_GUIDE} />
    </div>
  );
}

/** Kurum yöneticisinin kendi kurumundaki giriş şifrelerini yönettiği bölüm. */
function SchoolPasswordSection() {
  const { school } = useSession();
  return <AccountPasswordPanel schoolId={school ? Number(school.id) : undefined} />;
}

export default function AdminPage() {
  return (
    <SiteLayout anyPermission={['manage_users']} wide>
      <div className="space-y-6">
        <AdminBody />
        <SchoolPasswordSection />
      </div>
    </SiteLayout>
  );
}