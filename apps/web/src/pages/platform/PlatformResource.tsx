import { useParams } from 'react-router-dom';
import { RESOURCES } from '../../lib/resources';
import { ResourcePage } from '../../components/ResourcePage';
import { EmptyState } from '../../components/ui';

const SUBTITLES: Record<string, string> = {
  sports: 'The master catalogue of sports available across all events.',
  disciplines: 'Sub-disciplines and their default entry & squad rules.',
  'tournament-formats': 'Fixture algorithms (knockout, league, …) reused by every tournament.',
  institutions: 'Colleges and schools that can participate in events.',
  users: 'All platform accounts and their roles.',
  roles: 'Role definitions used for event-scoped permissions.',
};

export function PlatformResource() {
  const { key } = useParams();
  const config = key ? RESOURCES[key] : undefined;

  if (!config) {
    return <EmptyState icon="⚙" title="Unknown section" description="This platform section does not exist." />;
  }

  return (
    <div>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">{SUBTITLES[config.key] ?? 'Platform master data.'}</p>
      <ResourcePage config={config} />
    </div>
  );
}
