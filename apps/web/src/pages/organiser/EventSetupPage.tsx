import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useEvent } from './EventLayout';
import { Tabs } from '../../components/ui';
import { TournamentsTab } from './setup/TournamentsTab';
import { SportsTab } from './setup/SportsTab';
import { VenuesTab } from './setup/VenuesTab';
import { InvitePanel } from '../../components/InvitePanel';

const TABS = ['tournaments', 'sports', 'venues', 'invite'] as const;

export function EventSetupPage() {
  const { championship, eventId, canManage, canManageSport } = useEvent();
  // Seasons, venues and invitations are the whole event's. A sport organiser works
  // on their own sports here and nothing else.
  const tabs = canManage ? TABS : (['sports'] as const);
  const [params] = useSearchParams();
  // Deep links (e.g. the dashboard checklist) can target a tab with ?tab=invite.
  const wanted = params.get('tab');
  const [tab, setTab] = useState(() => (wanted && (tabs as readonly string[]).includes(wanted) ? wanted : 'sports'));
  // Follow ?tab changes when already mounted (clicking another deep link).
  useEffect(() => {
    if (wanted && (tabs as readonly string[]).includes(wanted)) setTab(wanted);
  }, [wanted, tabs]);
  return (
    <div>
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'tournaments', label: 'Seasons' },
          { id: 'sports', label: 'Sports & disciplines' },
          { id: 'venues', label: 'Venue' },
          { id: 'invite', label: 'Invite' },
        ].filter((t) => (tabs as readonly string[]).includes(t.id))}
      />
      {!canManage && (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          You organise some of this championship's sports - you can change those here. Seasons, venues and invitations are set by the overall organisers.
        </p>
      )}
      <div className="mt-6">
        {tab === 'tournaments' && <TournamentsTab eventId={eventId} onCreated={() => setTab('venues')} />}
        {tab === 'venues' && <VenuesTab eventId={eventId} />}
        {tab === 'sports' && <SportsTab eventId={eventId} canManageSport={canManageSport} canAddSports={canManage} />}
        {tab === 'invite' && <InvitePanel eventId={eventId} readOnly={!!championship.archived_at} />}
      </div>
    </div>
  );
}
