import { useEvent } from './EventLayout';
import { ChampionshipMatrixImportPage } from '../platform/ChampionshipMatrixImportPage';
import { EmptyState } from '../../components/ui';

// The matrix importer, scoped to the championship being managed (J2-E3-S4).
//
// The endpoint behind it has always been organiser-guarded; only the screen was behind
// super-admin, which meant the one feature that turns a day of clicking into a single
// upload was unreachable by the people who need it most. Same component, championship
// fixed to the one in the route.
export function EventImportPage() {
  const { eventId, canManage } = useEvent();

  if (!canManage) {
    return (
      <EmptyState icon="📄" title="Only the organising team can import a setup"
        description="Ask an organiser of this championship to run the import." />
    );
  }
  return <ChampionshipMatrixImportPage championshipId={eventId} />;
}
