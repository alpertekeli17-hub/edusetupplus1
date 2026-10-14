/**
 * Danışmanlık erişim kanıtı: kim kimi görür, kime yazılır, kim asla girmez.
 *
 * Neden bu betik gerekli
 * ----------------------
 * Danışmanlık görüşmeleri öğrencinin ve ailesinin özel bilgisidir. İki kural
 * birlikte yürür ve ikisi de **ekranda sessizce** bozulabilir:
 *
 *  (a) **Kim kimi görür.** Görüş yalnızca kaydı yazan öğretmen, o öğrencinin
 *      danışman öğretmeni, rehber öğretmen ve yönetici tarafından okunur.
 *      Kural sayfa içine gömülseydi, yeni bir liste/görünüm eklendiğinde
 *      atlanır ve başka bir öğretmen (ya da veli) başkasının görüşünü görürdü.
 *      Ekranda bu kusur "liste biraz uzun" gibi görünür, gözle ayırt edilmez.
 *  (b) **Kime yazılır.** Öğretmen yalnızca *kendi danışmanlığındaki* öğrenciye
 *      görüş yazabilir. Bu kapı olmadan bir öğretmen listede gördüğü herhangi
 *      bir öğrenciye görüş ekleyip başkasının danışmanlığına müdahale eder.
 *
 * Bu yüzden ölçüm ekranda değil **karar katmanında** yapılır: `lib/counseling.ts`
 * (saf kurallar), `lib/site.ts` (yetki çözümlemesi) ve `lib/termScope.ts`
 * (dönem kapsamı) fonksiyonları gerçek girdilerle çağrılır; ekranda çalışan
 * kodun aynısı ölçülür.
 *
 * Her olumlu iddianın karşıtı da aynı koşuda ölçülür: yabancı öğretmenin
 * görüşü görünmemeli, kendi danışmanlığı olmayan öğretmen yazamamalı ve veli
 * ile öğrenci — yetki panelinden işaretlense dahi — bölüme girememeli. Yalnızca
 * olumlu iddialar ölçülseydi kural tümden kaldırıldığında da liste yeşil
 * kalırdı.
 *
 * Çalıştırma:
 *   pnpm exec vite build --config vite.bench.counseling.config.ts
 *   node .bench-counseling/bench.mjs
 */
/*
  DİKKAT: shim importu EN ÜSTTE olmalıdır. Kayıt/oturum katmanı `localStorage`
  ve `window` bekler; ESM içe aktarmaları sırayla değerlendirildiği için shim
  ilk sırada olmazsa Node "window is not defined" ile düşer.
*/
import './node-shim';

import {
  COUNSELING_MEETING_TYPES,
  buildAssignmentTargets,
  buildClassCounselingReports,
  buildCounselingOverview,
  buildStudentCounselingRows,
  buildTeacherCounselingReports,
  buildTeacherLoads,
  canAssignCounseling,
  canEditNote,
  canEnterCounseling,
  canReadAssignment,
  canReadNote,
  canWriteNote,
  counselingClassCsv,
  counselingFollowUpCsv,
  counselingNotMetCsv,
  counselingStudentCsv,
  counselingTeacherCsv,
  counselingTeacherOptions,
  myStudentKeys,
  pendingFollowUps,
  notesForStudent,
  seesAllCounseling,
  studentKeyOfRecord,
  studentsOfClass,
  visibleAssignments,
  visibleNotes,
  type CounselingAssignment,
  type CounselingNote,
  type CounselingViewer,
} from '@/lib/counseling';
import { csvCell, stampedCsvName, toCsv } from '@/lib/csv';
import { isPermissionBlockedForRole, resolvePermissions } from '@/lib/site';
import { scopeToTerm } from '@/lib/termScope';
import type { Membership } from '@/lib/tenant';
import type { StudentRecord } from '@/lib/students';
import type { Role } from '@/lib/site';

/* -------------------------------------------------------------------------- */
/* Küçük doğrulama çerçevesi                                                   */
/* -------------------------------------------------------------------------- */

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail: string): void {
  if (condition) {
    passed += 1;
    console.log(`  OK   ${label}`);
  } else {
    failures.push(`${label} — ${detail}`);
    console.log(`  FAIL ${label} — ${detail}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

/* -------------------------------------------------------------------------- */
/* Ortak kurulum                                                               */
/* -------------------------------------------------------------------------- */

const TERM = '2026-2027';
const PREV_TERM = '2025-2026';

/* Ekranda çalışılan dönem, karar katmanıyla aynı anahtardan yazılır. */
localStorage.setItem('lgs.activeTerm', TERM);
localStorage.setItem('lgs.baselineTerm', PREV_TERM);

/** Oturumlar gerçek e-posta/ad ile kurulur; yetki kararı site katmanından gelir. */
function viewer(params: {
  email: string;
  role: Role;
  permissions?: string;
  name?: string;
}): CounselingViewer {
  const permissions = resolvePermissions(params.role, params.permissions);
  return {
    email: params.email,
    role: params.role,
    canViewAll: permissions.has('view_all_counseling'),
    canAssign: permissions.has('manage_counseling'),
  };
}

const REHBER = viewer({ email: 'rehber@okul.k12.tr', role: 'rehber', name: 'Rehber Öğretmen' });
const YONETICI = viewer({ email: 'mudur@okul.k12.tr', role: 'admin', name: 'Okul Müdürü' });
const OGRETMEN_A = viewer({ email: 'ayse@okul.k12.tr', role: 'ogretmen', name: 'Ayşe Öğretmen' });
const OGRETMEN_B = viewer({ email: 'burak@okul.k12.tr', role: 'ogretmen', name: 'Burak Öğretmen' });
const VELI = viewer({ email: 'veli@ornek.com', role: 'veli', name: 'Veli Kişi' });
const OGRENCI = viewer({ email: 'ogrenci@ornek.com', role: 'ogrenci', name: 'Öğrenci Kişi' });

const ELIF = 'elif yılmaz';
const MERT = 'mert demir';

const assignments: CounselingAssignment[] = [
  {
    id: 1,
    term_code: TERM,
    teacher_email: 'ayse@okul.k12.tr',
    teacher_name: 'Ayşe Öğretmen',
    student_key: ELIF,
    student_name: 'Elif Yılmaz',
    class_name: '8-A',
  },
  {
    /* Yabancı öğretmenin danışmanlığı: sızma iddialarının karşıt tarafı. */
    id: 2,
    term_code: TERM,
    teacher_email: 'burak@okul.k12.tr',
    teacher_name: 'Burak Öğretmen',
    student_key: MERT,
    student_name: 'Mert Demir',
    class_name: '8-A',
  },
];

const notes: CounselingNote[] = [
  {
    id: 11,
    term_code: TERM,
    teacher_email: 'ayse@okul.k12.tr',
    teacher_name: 'Ayşe Öğretmen',
    student_key: ELIF,
    student_name: 'Elif Yılmaz',
    note_date: '2026-09-15',
    meeting_type: 'ogrenci',
    summary: 'Sınav kaygısı görüşmesi',
  },
  {
    /* Burak'ın kendi danışmanlığındaki öğrenciyle yaptığı görüşme. */
    id: 12,
    term_code: TERM,
    teacher_email: 'burak@okul.k12.tr',
    teacher_name: 'Burak Öğretmen',
    student_key: MERT,
    student_name: 'Mert Demir',
    note_date: '2026-09-16',
    meeting_type: 'veli',
    summary: 'Veli görüşmesi',
  },
  {
    /*
      Kritik iddia: Ayşe, Mert'in danışmanı DEĞİL ama Mert hakkında rehber
      öğretmenle yaptığı bir grup görüşmesini kaydetmiş. Bu kaydı yazan kişi
      olduğu için görmeli; Burak'ın gördüğü ise kendi danışmanlığından gelir.
    */
    id: 13,
    term_code: TERM,
    teacher_email: 'burak@okul.k12.tr',
    teacher_name: 'Burak Öğretmen',
    student_key: ELIF,
    student_name: 'Elif Yılmaz',
    note_date: '2026-09-17',
    meeting_type: 'grup',
    summary: 'Burak, Elif hakkında grup görüşmesi yazdı (danışmanı değil)',
  },
];

/* -------------------------------------------------------------------------- */
/* 1) Bölüme giriş — rol kapısı                                                */
/* -------------------------------------------------------------------------- */

section('1) Bölüme giriş — veli ve öğrenci hiçbir koşulda giremez');

check(
  'öğretmen, rehber ve yönetici danışmanlık bölümüne girebiliyor',
  canEnterCounseling(OGRETMEN_A) && canEnterCounseling(REHBER) && canEnterCounseling(YONETICI),
  `öğretmen=${canEnterCounseling(OGRETMEN_A)} rehber=${canEnterCounseling(REHBER)} yönetici=${canEnterCounseling(YONETICI)}`,
);

check(
  'veli ve öğrenci bölüme giremiyor (rol kapısı)',
  !canEnterCounseling(VELI) && !canEnterCounseling(OGRENCI),
  `veli=${canEnterCounseling(VELI)} öğrenci=${canEnterCounseling(OGRENCI)}`,
);

check(
  'rota yoksa (rol çözülememişse) hiçbir kayıt okunmuyor',
  (() => {
    const anon: CounselingViewer = { email: 'biri@okul.k12.tr', canViewAll: false, canAssign: false };
    return (
      !canEnterCounseling(anon) &&
      visibleAssignments(anon, assignments).length === 0 &&
      visibleNotes(anon, notes, assignments).length === 0
    );
  })(),
  'rolsuz oturum kararı',
);

check(
  'yönetici veliye "tüm danışmanlığı gör" yetkisi verse dahi etkisiz',
  resolvePermissions('veli', 'view_all_counseling,manage_counseling').has('view_all_counseling') ===
    false &&
    isPermissionBlockedForRole('veli', 'view_all_counseling') &&
    isPermissionBlockedForRole('veli', 'manage_counseling'),
  'rol yasak listesi',
);

check(
  'öğrenciye danışmanlık yetkisi verilse de engelleniyor',
  !resolvePermissions('ogrenci', 'view_all_counseling,manage_counseling').has(
    'manage_counseling',
  ) &&
    !resolvePermissions('ogrenci', 'view_all_counseling').has('view_all_counseling'),
  'öğrenci rol yasak listesi',
);

/* -------------------------------------------------------------------------- */
/* 2) Görüş okuma — kim kimi görür                                             */
/* -------------------------------------------------------------------------- */

section('2) Görüş okuma — kendi danışmanlığı, kendi kaydı, kurum geneli');

check(
  'rehber öğretmen kurumdaki tüm görüşleri görüyor',
  visibleNotes(REHBER, notes, assignments).length === notes.length,
  `görünen ${visibleNotes(REHBER, notes, assignments).length}/${notes.length}`,
);

check(
  'yönetici kurumdaki tüm görüşleri görüyor',
  visibleNotes(YONETICI, notes, assignments).length === notes.length,
  `görünen ${visibleNotes(YONETICI, notes, assignments).length}/${notes.length}`,
);

check(
  'öğretmen kendi yazdığı görüşü görüyor',
  visibleNotes(OGRETMEN_A, notes, assignments).some((n) => n.id === 11),
  'id=11 kaydı',
);

check(
  'öğretmen kendi danışmanlığındaki öğrencinin görüşünü görüyor',
  visibleNotes(OGRETMEN_A, notes, assignments).some((n) => n.id === 13),
  'id=13 (Elif, Ayşe’nin danışmanlığında)',
);

check(
  'YABANCI öğretmenin danışmanlığındaki öğrencinin görüşü görünmüyor',
  !visibleNotes(OGRETMEN_A, notes, assignments).some((n) => n.id === 12),
  'id=12 sızdı',
);

check(
  'her öğretmen yalnızca 2 görüş görüyor (kendi yazdığı + kendi danışmanlığında yazılmış)',
  visibleNotes(OGRETMEN_A, notes, assignments).length === 2 &&
    visibleNotes(OGRETMEN_B, notes, assignments).length === 2,
  `Ayşe=${visibleNotes(OGRETMEN_A, notes, assignments).length} Burak=${visibleNotes(OGRETMEN_B, notes, assignments).length}`,
);

check(
  'veli ve öğrenci hiçbir görüş görmüyor (yetki işaretli olsa dahi)',
  visibleNotes(VELI, notes, assignments).length === 0 &&
    visibleNotes(OGRENCI, notes, assignments).length === 0,
  `veli=${visibleNotes(VELI, notes, assignments).length} öğrenci=${visibleNotes(OGRENCI, notes, assignments).length}`,
);

check(
  'öğretmen yalnızca kendi atamalarını görüyor',
  visibleAssignments(OGRETMEN_A, assignments).every((a) => a.teacher_email === 'ayse@okul.k12.tr') &&
    visibleAssignments(OGRETMEN_A, assignments).length === 1,
  `görünen ${visibleAssignments(OGRETMEN_A, assignments).length}`,
);

check(
  'rehber öğretmen tüm atamaları görüyor',
  visibleAssignments(REHBER, assignments).length === assignments.length,
  `görünen ${visibleAssignments(REHBER, assignments).length}`,
);

check(
  'görünürlük kararı e-posta büyük/küçük harf farkına takılmıyor',
  (() => {
    const upper = viewer({ email: 'AYSE@Okul.K12.TR', role: 'ogretmen' });
    return canReadNote(upper, notes[0], assignments) && canReadAssignment(upper, assignments[0]);
  })(),
  'e-posta normalizasyonu',
);

/* -------------------------------------------------------------------------- */
/* 3) Görüş yazma kapısı                                                       */
/* -------------------------------------------------------------------------- */

section('3) Görüş yazma — yalnızca kendi danışmanlığındaki öğrenciye');

check(
  'öğretmen kendi danışmanlığındaki öğrenciye yazabiliyor',
  canWriteNote(OGRETMEN_A, ELIF, assignments),
  'Elif → Ayşe',
);

check(
  'öğretmen kendi danışmanlığında OLMAYAN öğrenciye yazamıyor',
  !canWriteNote(OGRETMEN_A, MERT, assignments) &&
    !canWriteNote(OGRETMEN_B, ELIF, assignments),
  'yabancı öğrenci yazma kapısı',
);

check(
  'rehber öğretmen ve yönetici atanmamış öğrenciye de yazabiliyor',
  canWriteNote(REHBER, 'atanmamis ogrenci', assignments) &&
    canWriteNote(YONETICI, 'atanmamis ogrenci', assignments),
  'kurum geneli yazma',
);

check(
  'veli ve öğrenci hiçbir öğrenciye görüş yazamıyor',
  !canWriteNote(VELI, ELIF, assignments) && !canWriteNote(OGRENCI, ELIF, assignments),
  'veli/öğrenci yazma kapısı',
);

check(
  'atama listesi boşken öğretmen hiç yazamıyor (kapı yalnız yetkiye bakmıyor)',
  !canWriteNote(OGRETMEN_A, ELIF, []) && canWriteNote(REHBER, ELIF, []),
  'boş atama listesi',
);

check(
  'yazma kapısı ekranda süzülmüş liste ile değil tam listeyle çalışıyor',
  canWriteNote(OGRETMEN_A, ELIF, assignments) &&
    visibleAssignments(OGRETMEN_A, assignments).length < assignments.length,
  'süzülmüş liste yetkiyi daraltmamalı',
);

check(
  'görüşü yalnızca yazan kişi veya rehber/yönetici düzenleyebiliyor',
  canEditNote(OGRETMEN_A, notes[0]) &&
    !canEditNote(OGRETMEN_A, notes[1]) &&
    canEditNote(REHBER, notes[1]) &&
    canEditNote(YONETICI, notes[1]),
  'düzenleme/silme yetkisi',
);

check(
  'veli ve öğrenci hiçbir görüşü düzenleyemiyor',
  !canEditNote(VELI, notes[0]) && !canEditNote(OGRENCI, notes[0]),
  'veli/öğrenci düzenleme',
);

/* -------------------------------------------------------------------------- */
/* 4) Atama yetkisi ve toplu atama üretimi                                     */
/* -------------------------------------------------------------------------- */

section('4) Atama yetkisi ve toplu atama üretimi');

check(
  'rehber ve yönetici öğretmene atama yapabiliyor, öğretmen yapamıyor',
  canAssignCounseling(REHBER) &&
    canAssignCounseling(YONETICI) &&
    !canAssignCounseling(OGRETMEN_A),
  `rehber=${canAssignCounseling(REHBER)} yönetici=${canAssignCounseling(YONETICI)} öğretmen=${canAssignCounseling(OGRETMEN_A)}`,
);

check(
  'veli ve öğrenci atama yapamıyor',
  !canAssignCounseling(VELI) && !canAssignCounseling(OGRENCI),
  'veli/öğrenci atama',
);

check(
  'yönetici tek kullanıcıya "tüm danışmanlığı gör" yetkisi verince o öğretmen de tümünü görüyor',
  (() => {
    const yetkili = viewer({
      email: 'ayse@okul.k12.tr',
      role: 'ogretmen',
      permissions: 'view_all_counseling',
    });
    return seesAllCounseling(yetkili) && visibleNotes(yetkili, notes, assignments).length === notes.length;
  })(),
  'ek yetki sözleşmesi',
);

check(
  'yetki geri alındığında (-) öğretmen yine yalnızca kendi kapsamını görüyor',
  (() => {
    const kisitli = viewer({
      email: 'ayse@okul.k12.tr',
      role: 'ogretmen',
      permissions: '-view_all_counseling',
    });
    return !seesAllCounseling(kisitli) && visibleNotes(kisitli, notes, assignments).length === 2;
  })(),
  'yetki kaldırma sözleşmesi',
);

/* Toplu atama: sınıfın tamamı tek çağrıda. */
const students: StudentRecord[] = [
  { id: 101, full_name: 'Elif Yılmaz', class_name: '8-A' },
  { id: 102, full_name: 'Mert Demir', class_name: '8-A' },
  { id: 103, full_name: 'Zeynep Kaya', class_name: '8-A' },
  { id: 104, full_name: 'Ahmet Öz', class_name: '8-B' },
];

check(
  'öğrenci anahtarı Türkçe duyarsız ve tek boşluklu üretiliyor',
  studentKeyOfRecord({ id: 1, full_name: '  ŞEYMA   ÖZ ', class_name: '8-A' }) ===
    studentKeyOfRecord({ id: 2, full_name: 'Şeyma Öz', class_name: '8-A' }),
  studentKeyOfRecord({ id: 1, full_name: '  ŞEYMA   ÖZ ', class_name: '8-A' }),
);

check(
  'sınıf seçildiğinde yalnızca o sınıfın öğrencileri geliyor',
  studentsOfClass(students, '8-A').length === 3 && studentsOfClass(students, '8-B').length === 1,
  `8-A=${studentsOfClass(students, '8-A').length} 8-B=${studentsOfClass(students, '8-B').length}`,
);

const classTargets = buildAssignmentTargets({
  teacher: { email: 'Ayse@Okul.K12.TR', name: 'Ayşe Öğretmen' },
  students: studentsOfClass(students, '8-A'),
  existing: assignments,
  className: '8-A',
});

check(
  'sınıfa atamada zaten danışmanlığında olan öğrenci atlanıyor',
  classTargets.toAdd.length === 2 && classTargets.skipped === 1,
  `eklenen=${classTargets.toAdd.length} atlanan=${classTargets.skipped}`,
);

check(
  'yeni atamalar öğretmen e-postası normalleştirilmiş ve dönem damgalı yazılıyor',
  classTargets.toAdd.every(
    (row) => row.teacher_email === 'ayse@okul.k12.tr' && Boolean(row.teacher_name),
  ),
  JSON.stringify(classTargets.toAdd.map((r) => r.teacher_email)),
);

check(
  'kopya atama üretilmiyor: aynı öğretmen–öğrenci çifti iki kez yazılmıyor',
  new Set(classTargets.toAdd.map((r) => r.student_key)).size === classTargets.toAdd.length,
  classTargets.toAdd.map((r) => r.student_key).join(','),
);

check(
  'ikinci kez aynı atama denendiğinde hiç yeni kayıt üretilmiyor',
  (() => {
    const second = buildAssignmentTargets({
      teacher: { email: 'ayse@okul.k12.tr', name: 'Ayşe Öğretmen' },
      students: studentsOfClass(students, '8-A'),
      existing: assignments,
      className: '8-A',
    });
    return second.toAdd.length === 2;
  })(),
  'tekrar atama',
);

check(
  'atanabilir personel listesi yalnızca öğretmen/rehber/yönetici ve aktif üyelerden oluşuyor',
  (() => {
    const memberships: Membership[] = [
      { id: 1, school_id: 1, email: 'ayse@okul.k12.tr', role: 'ogretmen', status: 'aktif' },
      { id: 2, school_id: 1, email: 'rehber@okul.k12.tr', role: 'rehber', status: 'aktif' },
      { id: 3, school_id: 1, email: 'mudur@okul.k12.tr', role: 'admin', status: 'aktif' },
      { id: 4, school_id: 1, email: 'veli@ornek.com', role: 'veli', status: 'aktif' },
      { id: 5, school_id: 1, email: 'pasif@okul.k12.tr', role: 'ogretmen', status: 'askida' },
    ];
    const options = counselingTeacherOptions(memberships);
    return (
      options.length === 3 &&
      !options.some((m) => m.role === 'veli') &&
      !options.some((m) => m.email === 'pasif@okul.k12.tr')
    );
  })(),
  'personel listesi',
);

/* -------------------------------------------------------------------------- */
/* 5) Türetilmiş raporlar                                                      */
/* -------------------------------------------------------------------------- */

section('5) Öğretmen yükü, öğrenci listesi ve kurum özeti');

const loads = buildTeacherLoads(assignments, notes);
const loadA = loads.find((l) => l.teacher_email === 'ayse@okul.k12.tr');
const loadB = loads.find((l) => l.teacher_email === 'burak@okul.k12.tr');

/*
  Ölçüm bir kusur yakaladı ve iddia düzeltildi: 13 numaralı görüşü Burak yazmış
  ama görüşün konusu Elif, Burak'ın danışmanlığında DEĞİL (rehber öğretmenle
  yapılan grup görüşmesi). Yük hesabı bu görüşü Burak'a yazsaydı, öğretmenin
  danışmanlık yükü olmadığı hâlde artmış görünür ve "kimin kaç öğrencisi var"
  tablosu yanlış okunurdu. Doğru davranış: yük yalnızca atama listesinden sayılır.
*/
check(
  'öğretmen yükü öğrenci ve görüş sayılarını yalnızca kendi atamalarından sayıyor',
  loadA?.studentCount === 1 &&
    loadA?.noteCount === 1 &&
    loadB?.studentCount === 1 &&
    loadB?.noteCount === 1,
  `Ayşe=${loadA?.studentCount}/${loadA?.noteCount} Burak=${loadB?.studentCount}/${loadB?.noteCount}`,
);

check(
  'kendi danışmanlığında olmayan öğrenciye yazılan görüş hiçbir öğretmenin yükünü şişirmiyor',
  (() => {
    const toplam = loads.reduce((sum, l) => sum + l.noteCount, 0);
    return toplam === 2 && toplam < notes.length;
  })(),
  `yüklerde sayılan ${loads.reduce((sum, l) => sum + l.noteCount, 0)} / toplam görüş ${notes.length}`,
);

check(
  'hiç görüşme girilmemiş danışmanlık öğrencisi işaretleniyor',
  (() => {
    const bos = buildTeacherLoads(
      [{ ...assignments[0], id: 9, student_key: 'yeni ogrenci', student_name: 'Yeni Öğrenci' }],
      notes,
    );
    return bos[0]?.untouched.length === 1 && bos[0]?.untouched[0]?.studentKey === 'yeni ogrenci';
  })(),
  'dokunulmamış öğrenci',
);

check(
  'yük hesabı son görüşme tarihini yalnızca kendi danışmanlığındaki görüşlerden alıyor',
  loadA?.lastNoteDate === '2026-09-15' && loadB?.lastNoteDate === '2026-09-16',
  `Ayşe=${loadA?.lastNoteDate} Burak=${loadB?.lastNoteDate}`,
);

const myKeys = myStudentKeys(OGRETMEN_A, assignments);
check(
  'öğretmenin öğrenci anahtarları yalnızca kendi atamalarından geliyor',
  myKeys.length === 1 && myKeys[0] === ELIF,
  myKeys.join(','),
);

check(
  'öğrenci görüşleri tarihe göre yeniden eskiye sıralanıyor',
  (() => {
    const list = notesForStudent(
      [
        { ...notes[0], id: 21, note_date: '2026-09-01', student_key: ELIF },
        { ...notes[0], id: 22, note_date: '2026-09-20', student_key: ELIF },
      ],
      ELIF,
    );
    return list[0]?.id === 22 && list[1]?.id === 21;
  })(),
  'görüş sıralaması',
);

const overview = buildCounselingOverview(assignments, notes, loads);
check(
  'kurum özeti öğretmen, öğrenci ve görüş sayılarını tek noktada topluyor',
  overview.teacherCount === 2 && overview.studentCount === 2 && overview.noteCount === 3,
  `öğretmen=${overview.teacherCount} öğrenci=${overview.studentCount} görüş=${overview.noteCount}`,
);

check(
  'görüşme türü kırılımı tüm türleri kapsıyor ve sayıyor',
  overview.byMeetingType.length === COUNSELING_MEETING_TYPES.length &&
    overview.byMeetingType.find((t) => t.type === 'ogrenci')?.count === 1 &&
    overview.byMeetingType.find((t) => t.type === 'veli')?.count === 1 &&
    overview.byMeetingType.find((t) => t.type === 'grup')?.count === 1,
  JSON.stringify(overview.byMeetingType),
);

check(
  'tanım dışı görüşme türü "diğer" altında toplanıyor (liste çökmüyor)',
  (() => {
    const bozuk = buildCounselingOverview(
      assignments,
      [{ ...notes[0], id: 31, meeting_type: 'bilinmeyen tur' }],
      loads,
    );
    return bozuk.byMeetingType.find((t) => t.type === 'diger')?.count === 1;
  })(),
  'bilinmeyen tür',
);

check(
  'kurum özetindeki son görüşme tarihi en yeni görüşmeden geliyor',
  overview.lastNoteDate === '2026-09-17',
  String(overview.lastNoteDate),
);

/* -------------------------------------------------------------------------- */
/* 6) Dönem kapsamı                                                            */
/* -------------------------------------------------------------------------- */

section('6) Dönem kapsamı — geçen yılın danışmanlığı bu yıl görünmüyor');

const mixed = [
  { ...assignments[0], id: 41, term_code: TERM },
  { ...assignments[0], id: 42, term_code: PREV_TERM },
  { ...assignments[0], id: 43, term_code: '' },
];

check(
  'aktif dönem süzgeci hem geçen yılın damgalı satırını hem de damgasız eski satırı dışarıda bırakıyor',
  scopeToTerm(mixed).map((row) => row.id).join(',') === '41',
  scopeToTerm(mixed)
    .map((row) => row.id)
    .join(','),
);

check(
  'damgasız satır başlangıç dönemine sayılıyor: geçen yıl seçilince geri geliyor',
  scopeToTerm(mixed, PREV_TERM)
    .map((row) => row.id)
    .join(',') === '42,43',
  scopeToTerm(mixed, PREV_TERM)
    .map((row) => row.id)
    .join(','),
);

check(
  'kurumda hiç dönem tanımlı değilken hiçbir satır gizlenmiyor',
  (() => {
    /* Aktif dönem yokken kapsam uygulanmaz: bilgi eksikken veri gizlenmez. */
    localStorage.removeItem('lgs.activeTerm');
    const sonuc = scopeToTerm(mixed).length;
    localStorage.setItem('lgs.activeTerm', TERM);
    return sonuc === mixed.length;
  })(),
  'dönemsiz kurulum',
);

/* -------------------------------------------------------------------------- */
/* 7) Rapor katmanı — sınıf, danışman öğretmen ve öğrenci kırılımları          */
/* -------------------------------------------------------------------------- */

section('7) Rapor katmanı — sessiz yanlış sayı üretmeyen kırılımlar');

/*
  Rapor bir SAYI tablosudur: yanlış sayı inandırıcı görünür, ekranda "fazladan
  satır" ya da "eksik öğrenci" olarak göze batmaz. Bu yüzden her olumlu iddianın
  karşıtı da aynı koşuda sınanıyor.
*/

/* ------------------------------ Sınıf raporu ------------------------------- */

const classReports = buildClassCounselingReports(assignments, notes);

check(
  'görüşmede sınıf boşken danışmanlık atamasındaki sınıf kullanılıyor (hayalet "Sınıf atanmamış" satırı oluşmuyor)',
  classReports.length === 1 && classReports[0]?.className === '8-A' && classReports[0]?.noteCount === 3,
  classReports.map((r) => `${r.className}=${r.noteCount}`).join(' | '),
);

check(
  'ne sınıfı ne ataması olan öğrencinin görüşü kaybolmuyor: "Sınıf atanmamış" altında sayılıyor',
  (() => {
    const orphan = buildClassCounselingReports(assignments, [
      { ...notes[0], id: 91, student_key: 'kayit disi', student_name: 'Kayıt Dışı', class_name: undefined },
    ]);
    const bucket = orphan.find((r) => r.className === 'Sınıf atanmamış');
    return bucket?.noteCount === 1 && bucket?.studentCount === 1;
  })(),
  'kayıt dışı görüşme',
);

check(
  'sınıf raporunda "görüşülen" öğrenci BAŞINA sayılıyor, görüşme satırı başına değil',
  (() => {
    const cok = buildClassCounselingReports(assignments, [
      ...notes,
      { ...notes[0], id: 92, note_date: '2026-09-18' },
      { ...notes[0], id: 93, note_date: '2026-09-19' },
    ]);
    const bucket = cok.find((r) => r.className === '8-A');
    return bucket?.noteCount === 5 && bucket?.metStudentCount === 2;
  })(),
  'öğrenci başına sayım',
);

check(
  'görüşülmeyen öğrenci sayısı ve isim dökümü tutarlı (danışman bilgisiyle birlikte)',
  (() => {
    const zeynep: CounselingAssignment = {
      ...assignments[0],
      id: 51,
      student_key: 'zeynep kaya',
      student_name: 'Zeynep Kaya',
    };
    const bucket = buildClassCounselingReports([...assignments, zeynep], notes).find(
      (r) => r.className === '8-A',
    );
    return (
      bucket?.studentCount === 3 &&
      bucket?.notMetCount === 1 &&
      bucket?.notMetStudents[0]?.studentName === 'Zeynep Kaya' &&
      bucket?.notMetStudents[0]?.counselor === 'Ayşe Öğretmen'
    );
  })(),
  'görüşülmeyen liste',
);

/* ---------------------------- Takip bekleyenler ---------------------------- */

check(
  'takip bekleyen: takip tarihi verilmiş ve sonrasında görüşülmemiş kayıt açık sayılıyor',
  (() => {
    const acik = pendingFollowUps([
      { ...notes[0], id: 61, student_key: 'a', note_date: '2026-09-10', follow_up_date: '2026-09-20' },
    ]);
    return acik.length === 1 && acik[0]?.followUpDate === '2026-09-20';
  })(),
  'açık takip',
);

check(
  'takip tarihinden SONRA görüşülmüş eski kayıt "bekliyor" sayılmıyor (kapanmış takip iş listesine düşmüyor)',
  (() => {
    const kapali = pendingFollowUps([
      { ...notes[0], id: 62, student_key: 'b', note_date: '2026-09-01', follow_up_date: '2026-09-05' },
      { ...notes[0], id: 63, student_key: 'b', note_date: '2026-09-10' },
    ]);
    return kapali.length === 0;
  })(),
  'kapanmış takip',
);

check(
  'takip tarihi girilmemiş görüşme hiçbir zaman bekleyen sayılmıyor',
  pendingFollowUps(notes).length === 0,
  `bekleyen=${pendingFollowUps(notes).length}`,
);

/* ---------------------------- Öğretmen raporu ------------------------------ */

const teacherReportRows = buildTeacherCounselingReports(assignments, notes);
const raporA = teacherReportRows.find((r) => r.teacherEmail === 'ayse@okul.k12.tr');
const raporB = teacherReportRows.find((r) => r.teacherEmail === 'burak@okul.k12.tr');

check(
  'öğretmen raporunda öğrenci atamadan, görüşme o öğretmenin yazdığı tüm kayıtlardan sayılıyor',
  raporA?.studentCount === 1 &&
    raporA?.noteCount === 1 &&
    raporB?.studentCount === 1 &&
    raporB?.noteCount === 2,
  `Ayşe=${raporA?.studentCount}/${raporA?.noteCount} Burak=${raporB?.studentCount}/${raporB?.noteCount}`,
);

check(
  'başkasının danışmanlığındaki öğrenci için yazılan görüş öğrenci sayısını artırmıyor, sınıf listesi yine doğru',
  raporB?.notMetCount === 0 && raporB?.classText === '8-A',
  `Burak görüşülmeyen=${raporB?.notMetCount} sınıflar=${raporB?.classText}`,
);

/* ----------------------------- Öğrenci raporu ------------------------------ */

const studentReportRows = buildStudentCounselingRows({ assignments, notes, roster: students });

check(
  'öğrenci raporu kayıt defterini de kapsıyor: 2 danışmanlı + 2 danışmansız öğrenci listeleniyor',
  studentReportRows.length === 4 &&
    studentReportRows.filter((r) => r.hasCounselor).length === 2 &&
    studentReportRows.filter((r) => !r.hasCounselor).length === 2,
  studentReportRows.map((r) => `${r.studentName}:${r.hasCounselor ? 'var' : 'yok'}`).join(' | '),
);

/*
  Sıralama, raporun "kimse ilgilenmiyor" sinyalini öne almasını sağlar: danışmanı
  olmayan öğrenci listenin sonunda kaybolursa kurumda kimsenin bakmadığı çocuk
  fark edilmez. İddia konuma değil KURALA bağlanıyor — sabit sıra yazmak, kural
  bozulduğunda da yeşil kalırdı.
*/
check(
  'danışmanı atanmamış öğrenciler raporun başında, ardından görüş sayısına ve isme göre sıralanıyor',
  (() => {
    const anahtar = (r: (typeof studentReportRows)[number]): [number, number, string] => [
      r.hasCounselor ? 1 : 0,
      -r.noteCount,
      r.studentName,
    ];
    const sirali = studentReportRows.every((row, i) => {
      if (i === 0) return true;
      const onceki = anahtar(studentReportRows[i - 1]!);
      const simdiki = anahtar(row);
      if (onceki[0] !== simdiki[0]) return onceki[0] < simdiki[0];
      if (onceki[1] !== simdiki[1]) return onceki[1] < simdiki[1];
      return onceki[2].localeCompare(simdiki[2], 'tr') <= 0;
    });
    return (
      sirali &&
      studentReportRows.slice(0, 2).every((r) => r.hasCounselor === false) &&
      studentReportRows.slice(2).every((r) => r.hasCounselor === true)
    );
  })(),
  studentReportRows.map((r) => `${r.studentName}(${r.hasCounselor ? 'danışman var' : 'danışman yok'})`).join(' → '),
);

check(
  'kayıt defteri verilmediğinde listeye dışarıdan öğrenci girmiyor (branş öğretmeni kapsamı)',
  buildStudentCounselingRows({ assignments, notes }).length === 2,
  `${buildStudentCounselingRows({ assignments, notes }).length} satır`,
);

check(
  'öğrenci raporu bekleyen takip sayısını ve EN YAKIN takip tarihini taşıyor',
  (() => {
    const rows = buildStudentCounselingRows({
      assignments,
      notes: [
        { ...notes[0], id: 71, follow_up_date: '2026-09-25' },
        { ...notes[0], id: 72, follow_up_date: '2026-09-22' },
      ],
    });
    const row = rows.find((r) => r.studentKey === ELIF);
    return row?.pendingFollowUpCount === 2 && row?.nextFollowUpDate === '2026-09-22';
  })(),
  'öğrenci takip',
);

check(
  'raporlar okunabilen veriyle besleniyor: branş öğretmeni kendi kapsamının sayısını, rehber öğretmen kurum genelini görüyor',
  (() => {
    const gorunenAtamalar = visibleAssignments(OGRETMEN_A, assignments);
    const gorunenNotlar = visibleNotes(OGRETMEN_A, notes, assignments);
    const branş = buildClassCounselingReports(gorunenAtamalar, gorunenNotlar).find(
      (r) => r.className === '8-A',
    );
    const branşOgrenci = buildStudentCounselingRows({
      assignments: gorunenAtamalar,
      notes: gorunenNotlar,
    });
    const rehber = buildClassCounselingReports(assignments, notes).find((r) => r.className === '8-A');
    return branş?.noteCount === 2 && rehber?.noteCount === 3 && branşOgrenci.length === 1;
  })(),
  'kapsam süzgeci',
);

/* ------------------------------ CSV çıktıları ------------------------------ */

check(
  'beş CSV çıktısında başlık ve veri satırı uzunlukları eşit (kaymış sütun yok)',
  (() => {
    const setler = [
      counselingClassCsv(classReports),
      counselingTeacherCsv(teacherReportRows),
      counselingStudentCsv(studentReportRows),
      counselingNotMetCsv(studentReportRows),
      counselingFollowUpCsv(pendingFollowUps(notes)),
    ];
    return setler.every((set) => set.rows.every((row) => row.length === set.headers.length));
  })(),
  'sütun hizası',
);

check(
  'tür kırılım sütunlarının toplamı "Görüşme" sütununa eşit (üç raporda da)',
  (() => {
    const turToplami = (row: (string | number | undefined)[]) =>
      row.slice(4, 9).reduce<number>((sum, value) => sum + Number(value ?? 0), 0);
    return (
      counselingClassCsv(classReports).rows.every((row) => turToplami(row) === Number(row[3])) &&
      counselingTeacherCsv(teacherReportRows).rows.every((row) => turToplami(row) === Number(row[3])) &&
      counselingStudentCsv(studentReportRows).rows.every((row) => turToplami(row) === Number(row[3]))
    );
  })(),
  'tür toplamı',
);

check(
  'CSV hücresi Türkçe Excel beklentisine uyuyor: ayırıcı noktalı virgül, ondalık virgül, ayırıcı içeren metin tırnaklı',
  (() => {
    const satir = toCsv(['A', 'B'], [['x;y', 1.5]]);
    return (
      csvCell(undefined) === '' &&
      csvCell(3) === '3' &&
      csvCell(1.5) === '1,5' &&
      csvCell('a;b') === '"a;b"' &&
      satir === 'A;B\r\n"x;y";1,5'
    );
  })(),
  JSON.stringify(toCsv(['A', 'B'], [['x;y', 1.5]])),
);

check(
  'görüşülmeyenler CSV yalnızca görüşmesi olmayan satırları, durum etiketiyle içeriyor',
  (() => {
    const { rows, headers } = counselingNotMetCsv(studentReportRows);
    const beklenen = studentReportRows.filter((row) => row.noteCount === 0).length;
    return (
      headers.length === 5 &&
      rows.length === beklenen &&
      rows.every((row) => row[4] === 'Danışmanı var, görüşme yok' || row[4] === 'Danışmanı atanmamış')
    );
  })(),
  'görüşülmeyenler CSV',
);

check(
  'indirilen dosya adı tarih damgalı ve .csv uzantılı (aynı adın üzerine yazılmıyor)',
  /^danismanlik-sinif-raporu-\d{4}-\d{2}-\d{2}\.csv$/.test(stampedCsvName('danismanlik-sinif-raporu')),
  stampedCsvName('danismanlik-sinif-raporu'),
);

/* -------------------------------------------------------------------------- */
/* Sonuç                                                                       */
/* -------------------------------------------------------------------------- */

console.log(`\n${'-'.repeat(64)}`);
console.log(`DANIŞMANLIK ERİŞİM KANITI: ${passed}/${passed + failures.length} OK`);
if (failures.length) {
  console.log(`\nBaşarısız iddialar (${failures.length}):`);
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exitCode = 1;
} else {
  console.log('Görüş gizliliği, yazma kapısı ve dönem kapsamı doğrulandı.');
}
