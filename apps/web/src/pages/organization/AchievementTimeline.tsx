import { useParams } from 'react-router-dom';
import { useApi } from '../../lib/hooks';
import { AchievementTimelineView } from '../../components/AchievementTimelineView';

// The institution's history: every honour the place holds, squad medals included.
//
// The subtitle names the institution rather than saying "this organisation", because
// somebody who plays here AND runs the sports office has both this timeline and their
// own open, and "whose history am I reading" must be answerable without scrolling.
export function AchievementTimeline() {
  const { orgId } = useParams();
  const { data: org } = useApi<{ name: string }>(orgId ? `/organizations/${orgId}` : null);

  return (
    <AchievementTimelineView
      path={orgId ? `/organizations/${orgId}/achievements/timeline` : null}
      title="Achievement timeline"
      subtitle={`${org?.name ?? 'This institution'} · every milestone and accolade, in order.`}
      emptyDescription="Milestones appear here the moment a result is locked, or when a claimed achievement is validated."
    />
  );
}
