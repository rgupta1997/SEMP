import { useParams } from 'react-router-dom';
import { RESOURCES } from '../../lib/resources';
import { ResourcePage } from '../../components/ResourcePage';
import { EmptyState } from '../../components/ui';

const SUBTITLES: Record<string, string> = {
  sports: 'The master catalogue of sports available across all championships.',
  disciplines: 'Sub-disciplines and their default entry & squad rules.',
  'tournament-formats': 'Fixture algorithms (knockout, league, …) reused by every tournament.',
  organizations: 'Colleges and schools that can participate in championships.',
  'org-domains': 'Email domains claimed by an organisation. Anyone signing in with a listed domain joins that organisation automatically - only rows with "Routes sign-in" ticked take effect.',
  users: 'All platform accounts and their roles.',
  roles: 'Role definitions used for championship-scoped permissions.',
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
