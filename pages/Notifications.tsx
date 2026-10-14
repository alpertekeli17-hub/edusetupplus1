/**
 * Bildirim merkezi sayfası (`/bildirimler`).
 *
 * Yaklaşan yüz yüze dersler, online dersler, ödev teslim tarihleri ve rehberlik
 * takipleri tek listede toplanır. Liste rolün yetkisine göre süzülür:
 * öğretmen kendi derslerini, veli/öğrenci kendi kayıtlarını, yönetici ve rehber
 * öğretmen kurumun tamamını görür.
 */
import { useMemo, useState } from 'react';
import { Bell, BellRing, CheckCheck, Loader2, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import SiteLayout, { useSession } from '@/components/SiteLayout';
import PageGuide from '@/components/PageGuide';
import { NOTIFICATIONS_GUIDE } from '@/lib/pageGuides';
import { useViewerNotifications } from '@/hooks/use-notifications';
import { formatDateKey } from '@/lib/date';
import {
  NOTIFICATION_KINDS,
  NOTIFICATION_KIND_LABELS,
  NOTIFICATION_KIND_TONES,
  URGENCY_LABELS,
  URGENCY_TONES,
  type AppNotification,
  type NotificationKind,
} from '@/lib/notifications';

function NotificationRow({
  item,
  read,
  onRead,
}: {
  item: AppNotification;
  read: boolean;
  onRead: () => void;
}) {
  return (
    <div
      className={`flex flex-wrap items-start gap-3 rounded-2xl border px-4 py-3 transition-colors duration-150 ${
        read ? 'bg-card' : 'border-primary/40 bg-primary/5'
      }`}
    >
      <span
        className={`mt-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold ${
          NOTIFICATION_KIND_TONES[item.kind]
        }`}
      >
        {NOTIFICATION_KIND_LABELS[item.kind]}
      </span>
      <div className="min-w-[200px] flex-1">
        <p className="text-sm font-extrabold">{item.title}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{item.detail}</p>
        <p className="mt-1 text-[11px] font-bold tabular-nums text-muted-foreground">
          {formatDateKey(item.dateKey)}
          {item.time ? ` · ${item.time}` : ''} · {item.dayLabel}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${URGENCY_TONES[item.urgency]}`}
        >
          {URGENCY_LABELS[item.urgency]}
        </span>
        <Button asChild size="sm" variant="outline" className="h-8">
          <Link to={item.link} onClick={onRead}>
            Aç
          </Link>
        </Button>
        {!read && (
          <Button size="sm" variant="ghost" className="h-8" onClick={onRead}>
            Okundu
          </Button>
        )}
      </div>
    </div>
  );
}

function NotificationsBody() {
  const { can, member, account } = useSession();
  const schoolId = member ? Number(member.school_id) : undefined;

  const {
    items,
    unreadCount,
    loading,
    readIds,
    markRead,
    markAllRead,
    refresh,
    viewAll,
    teacherScoped,
  } = useViewerNotifications({
    schoolId,
    email: account?.email,
    fullName: account?.full_name,
    fallbackStudentName: member?.student_name,
    canManageUsers: can('manage_users'),
    canViewAllAttendance: can('view_all_attendance'),
    canTakeAttendance: can('take_attendance'),
    canViewGuidance: can('view_guidance'),
    canManageGuidance: can('manage_guidance'),
    canViewAccounting: can('view_accounting') || can('manage_accounting'),
    /*
      Yalnızca bildirim merkezi sayfası açar; zil bileşeni bu bayrağı hiç
      göndermez, böylece iki sayaç ayrı kalır.
    */
    canViewMessages: true,
    enabled: Boolean(member),
  });

  const [filter, setFilter] = useState<'tumu' | NotificationKind>('tumu');
  const [onlyUnread, setOnlyUnread] = useState(false);

  const visible = useMemo(
    () =>
      items
        .filter((item) => (filter === 'tumu' ? true : item.kind === filter))
        .filter((item) => (onlyUnread ? !readIds.has(item.id) : true)),
    [items, filter, onlyUnread, readIds],
  );

  const counts = useMemo(() => {
    const map = new Map<NotificationKind, number>();
    items.forEach((item) => map.set(item.kind, (map.get(item.kind) ?? 0) + 1));
    return map;
  }, [items]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card px-4 py-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {unreadCount ? <BellRing className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
        </span>
        <div className="mr-auto">
          <p className="text-base font-extrabold">Bildirim merkezi</p>
          <p className="text-[11px] text-muted-foreground">
            {viewAll
              ? 'Kurumdaki yaklaşan dersler, ödev teslimleri ve rehberlik takipleri.'
              : teacherScoped
                ? 'Kendi derslerinize ait yaklaşan ders ve takip hatırlatmaları.'
                : 'Size ait yaklaşan dersler, ödevler ve rehberlik takipleri.'}
          </p>
        </div>
        <Button variant="outline" size="sm" className="h-9" onClick={refresh}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Yenile
        </Button>
        <Button size="sm" className="h-9" onClick={markAllRead} disabled={!unreadCount}>
          <CheckCheck className="mr-1.5 h-3.5 w-3.5" />
          Tümünü okundu işaretle
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card px-4 py-3">
        <button
          type="button"
          onClick={() => setFilter('tumu')}
          className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors duration-150 ${
            filter === 'tumu' ? 'bg-primary text-primary-foreground' : 'bg-muted'
          }`}
        >
          Tümü ({items.length})
        </button>
        {NOTIFICATION_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => setFilter(kind)}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors duration-150 ${
              filter === kind ? 'bg-primary text-primary-foreground' : 'bg-muted'
            }`}
          >
            {NOTIFICATION_KIND_LABELS[kind]} ({counts.get(kind) ?? 0})
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-xs font-bold">
          <input
            type="checkbox"
            checked={onlyUnread}
            onChange={(e) => setOnlyUnread(e.target.checked)}
            className="h-4 w-4"
          />
          Yalnızca okunmamış ({unreadCount})
        </label>
      </div>

      {loading ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !visible.length ? (
        <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
          Şu an gösterilecek bildirim yok. Yaklaşan dersler, ödev teslim tarihleri ve rehberlik
          takipleri burada otomatik listelenir.
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((item) => (
            <NotificationRow
              key={item.id}
              item={item}
              read={readIds.has(item.id)}
              onRead={() => markRead(item.id)}
            />
          ))}
        </div>
      )}

      <PageGuide storageKey="bildirimler" {...NOTIFICATIONS_GUIDE} />
    </div>
  );
}

export default function NotificationsPage() {
  return (
    <SiteLayout requireAuth>
      <NotificationsBody />
    </SiteLayout>
  );
}