import { notFound } from 'next/navigation';
import { ProjectShell } from '@/components/project-shell';
import { getProjectContext } from '@/lib/server-data';

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const context = await getProjectContext(projectId);
  if (!context) {
    notFound();
  }

  return (
    <ProjectShell context={context}>
      {children}
    </ProjectShell>
  );
}
