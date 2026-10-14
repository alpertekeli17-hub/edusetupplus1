import { Suspense, lazy, useEffect } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { SessionProvider } from '@/components/SiteLayout';
import { prefetchModules } from '@/lib/prefetch';
import HomePage from './pages/Home';
// MODULE_IMPORTS_START
// MODULE_IMPORTS_END

// Ağır sayfalar yalnızca ziyaret edildiğinde indirilsin; böylece açılış paketi
// küçük kalır. Yükleyiciler ayrı tutulur ki tarayıcı boştayken aynı parçalar
// önceden indirilebilsin ve sayfa geçişlerinde bekleme oluşmasın.
const loadAnalysis = () => import('./pages/Analysis');
const loadYearView = () => import('./pages/YearView');
const loadSchedule = () => import('./pages/Schedule');
const loadAttendance = () => import('./pages/Attendance');
const loadExamSetup = () => import('./pages/ExamSetup');
const loadOnlineLessons = () => import('./pages/OnlineLessons');
// Mesajlaşma ve duyurular: kurum içi yazışma tek ekranda toplandığı için
// sayfa ayrı bir parça olarak tembel yükleniyor.
const loadMessages = () => import('./pages/Messages');
const loadNotifications = () => import('./pages/Notifications');
const loadGuidance = () => import('./pages/Guidance');
const loadAccounting = () => import('./pages/Accounting');
const loadStudents = () => import('./pages/Students');
const loadTerms = () => import('./pages/Terms');
const loadBackup = () => import('./pages/Backup');
const loadAdmin = () => import('./pages/Admin');
const loadPlatformAdmin = () => import('./pages/PlatformAdmin');

const AnalysisPage = lazy(loadAnalysis);
const YearViewPage = lazy(loadYearView);
const SchedulePage = lazy(loadSchedule);
const AttendancePage = lazy(loadAttendance);
const ExamSetupPage = lazy(loadExamSetup);
const OnlineLessonsPage = lazy(loadOnlineLessons);
const NotificationsPage = lazy(loadNotifications);
const GuidancePage = lazy(loadGuidance);
const AccountingPage = lazy(loadAccounting);
const StudentsPage = lazy(loadStudents);
const TermsPage = lazy(loadTerms);
const BackupPage = lazy(loadBackup);
const MessagesPage = lazy(loadMessages);
const AdminPage = lazy(loadAdmin);
const PlatformAdminPage = lazy(loadPlatformAdmin);

// Mağaza: ürün kataloğu, fiyatlar ve sepet (iyzico e-ticaret gereksinimi).
const StorePage = lazy(() => import('./pages/Store'));

// iyzico ödeme dönüş sayfası: durum sunucudan doğrulanır.
const PaymentResultPage = lazy(() => import('./pages/PaymentResult'));

const AuthCallback = lazy(() => import('./pages/AuthCallback'));
const AuthError = lazy(() => import('./pages/AuthError'));

// Kurumsal tanıtım sayfaları ve blog bölümü.
const AboutPage = lazy(() => import('./pages/About'));
const HowItWorksPage = lazy(() => import('./pages/HowItWorks'));
const ContactPage = lazy(() => import('./pages/Contact'));
/*
  Yasal sayfalar tek dosyada tutuluyor: üç metin de aynı satıcı bilgisi ve
  ortak bileşenleri paylaştığı için ayrı dosyalara bölmek bilgi tekrarına yol
  açardı. Rotalar ayrı olduğu için iyzico başvurusunda her metin kendi
  adresinden erişilebilir.
*/
const DeliveryReturnsPage = lazy(() =>
  import('./pages/Legal').then((m) => ({ default: m.DeliveryReturnsPage })),
);
const PrivacyPage = lazy(() =>
  import('./pages/Legal').then((m) => ({ default: m.PrivacyPage })),
);
const DistanceSalesPage = lazy(() =>
  import('./pages/Legal').then((m) => ({ default: m.DistanceSalesPage })),
);
const BlogRoutes = lazy(() => import('./blog-routes'));

const queryClient = new QueryClient();

/** Panelde en sık kullanılan sayfalar, boş zamanda önceden indirilir. */
const idlePrefetchLoaders = [
  loadStudents,
  loadExamSetup,
  loadAnalysis,
  loadAttendance,
  loadSchedule,
  loadMessages,
];

const RouteFallback = () => (
  <div className="flex min-h-screen items-center justify-center bg-background">
    <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      Sayfa yükleniyor...
    </div>
  </div>
);

const AppRoutes = () => (
  <Suspense fallback={<RouteFallback />}>
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/analiz" element={<AnalysisPage />} />
      <Route path="/yillik" element={<YearViewPage />} />
      <Route path="/ders-programi" element={<SchedulePage />} />
      <Route path="/yoklama" element={<AttendancePage />} />
      <Route path="/sinavlar" element={<ExamSetupPage />} />
      <Route path="/online-ders" element={<OnlineLessonsPage />} />
      <Route path="/bildirimler" element={<NotificationsPage />} />
      <Route path="/mesajlar" element={<MessagesPage />} />
      <Route path="/rehberlik" element={<GuidancePage />} />
      <Route path="/ogrenciler" element={<StudentsPage />} />
      <Route path="/muhasebe" element={<AccountingPage />} />
      <Route path="/donemler" element={<TermsPage />} />
      <Route path="/yedekleme" element={<BackupPage />} />
      <Route path="/yonetim" element={<AdminPage />} />
      <Route path="/admin" element={<PlatformAdminPage />} />
      <Route path="/magaza" element={<StorePage />} />
      <Route path="/odeme-sonucu" element={<PaymentResultPage />} />

      <Route path="/hakkimizda" element={<AboutPage />} />
      <Route path="/teslimat-ve-iade" element={<DeliveryReturnsPage />} />
      <Route path="/gizlilik" element={<PrivacyPage />} />
      <Route path="/mesafeli-satis" element={<DistanceSalesPage />} />
      <Route path="/nasil-calisir" element={<HowItWorksPage />} />
      <Route path="/iletisim" element={<ContactPage />} />
      <Route path="/blog/*" element={<BlogRoutes />} />

      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/auth/error" element={<AuthError />} />
      {/* MODULE_ROUTES_START */}
      {/* MODULE_ROUTES_END */}
    </Routes>
  </Suspense>
);

const App = () => {
  useEffect(() => {
    prefetchModules(idlePrefetchLoaders);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {/* MODULE_PROVIDERS_START */}
      {/* MODULE_PROVIDERS_END */}
      <TooltipProvider>
        <Toaster />
        <BrowserRouter>
          <SessionProvider>
            <AppRoutes />
          </SessionProvider>
        </BrowserRouter>
      </TooltipProvider>
      {/* MODULE_PROVIDERS_CLOSE */}
    </QueryClientProvider>
  );
};

export default App;
export { AppRoutes };