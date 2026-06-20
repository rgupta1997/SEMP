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
  const { eventId } = useEvent();
  const [params] = useSearchParams();
  // Deep links (e.g. the dashboard checklist) can target a tab with ?tab=invite.
  const wanted = params.get('tab');
  const [tab, setTab] = useState(() => (wanted && (TABS as readonly string[]).includes(wanted) ? wanted : 'sports'));
  // Follow ?tab changes when already mounted (clicking another deep link).
  useEffect(() => {
    if (wanted && (TABS as readonly string[]).includes(wanted)) setTab(wanted);
  }, [wanted]);
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
        ]}
      />
      <div className="mt-6">
        {tab === 'tournaments' && <TournamentsTab eventId={eventId} onCreated={() => setTab('venues')} />}
        {tab === 'venues' && <VenuesTab eventId={eventId} />}
        {tab === 'sports' && <SportsTab eventId={eventId} />}
        {tab === 'invite' && <InvitePanel eventId={eventId} />}
      </div>
    </div>
  );
}
