/**
 * Analiz paneli sayfası: mevcut karne/analiz panelini yetki bazlı sarar.
 * Okul geneli yetkisi olanlar tüm öğrencileri görür, diğerleri yalnızca kendi karnesini.
 *
 * Veli/öğrenci için hangi karnenin gösterileceği önce öğrenci kayıt defterinden
 * (e-posta eşleşmesiyle), bulunamazsa üyelik kaydındaki öğrenci adından çözülür.
 */
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import SiteLayout, { useSession } from '@/components/SiteLayout';
import Index from '@/pages/Index';
import ExcelToolbar from '@/components/ExcelToolbar';
import PageGuide from '@/components/PageGuide';
import { ANALYSIS_GUIDE } from '@/lib/pageGuides';
import { ROLE_LABELS } from '@/lib/site';
import { useLinkedStudents } from '@/hooks/use-linked-students';
import { loadDataset } from '@/lib/store';
import { pullDataset } from '@/lib/cloud';
import {
  analysisExportSheet,
  analysisRowsFromExams,
  analysisTopicSheet,
} from '@/lib/moduleExcel';
import type { ExamRecord } from '@/lib/types';

function AnalysisBody() {
  const { profile, role, school, user, can } = useSession();
  const full = can('view_school');
  const linked = useLinkedStudents({
    email: user?.email,
    schoolId: Number(school?.id) || undefined,
    fallbackName: profile?.student_name,
    enabled: !full,
  });

  // Excel dışa aktarımı için analiz veri seti: önce yerel önbellek, sonra kalıcı depo.
  const [exams, setExams] = useState<ExamRecord[]>([]);
  useEffect(() => {
    const local = loadDataset();
    setExams(local.exams);
    let alive = true;
    void pullDataset(local)
      .then((merged) => {
        if (alive) setExams(merged.exams);
      })
      .catch(() => {
        /* çevrimdışı: yerel önbellekle devam */
      });
    return () => {
      alive = false;
    };
  }, [school?.id]);

  /** Okul geneli yetkisi yoksa yalnızca bağlı öğrencinin satırları aktarılır. */
  const exportScope = full ? undefined : linked.primaryName || undefined;
  const canExport = full || Boolean(linked.primaryName);

  const body = (() => {
    if (full) {
      return <Index allowSchoolView allowUpload={can('upload_exams')} allowExamDelete={can('upload_exams')} />;
    }
    if (linked.loading) {
      return (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      );
    }
    if (!linked.primaryName) {
      return (
        <div className="rounded-2xl border border-dashed bg-card px-4 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            Hesabınıza bağlı bir öğrenci bulunamadı. Kurum yöneticinizin öğrenci kayıtlarında
            e-postanızı veli veya öğrenci olarak tanımlaması gerekiyor.
          </p>
        </div>
      );
    }
    return (
      <Index
        restrictToStudent={linked.primaryName}
        allowSchoolView={false}
        allowUpload={can('upload_exams')}
      />
    );
  })();

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-extrabold">Analiz paneli</h1>
        {canExport && exams.length > 0 && (
          <ExcelToolbar
            compact
            fileName={`analiz-${new Date().toISOString().slice(0, 10)}`}
            buildSheets={() => [
              analysisExportSheet(analysisRowsFromExams(exams, exportScope)),
              analysisTopicSheet(exams, exportScope),
            ]}
          />
        )}
        {!full && linked.primaryName && (
          <span className="rounded-full border px-2.5 py-1 text-[11px] font-bold">
            {linked.primaryName}
          </span>
        )}
        {role && (
          <span className="rounded-full border px-2.5 py-1 text-[11px] font-bold">
            {ROLE_LABELS[role]} görünümü
          </span>
        )}
      </div>
      {body}
      <PageGuide storageKey="analiz" {...ANALYSIS_GUIDE} />
    </div>
  );
}

export default function AnalysisPage() {
  return (
    <SiteLayout requireAuth wide>
      <AnalysisBody />
    </SiteLayout>
  );
}