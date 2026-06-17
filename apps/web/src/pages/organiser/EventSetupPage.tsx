import { useState } from 'react';
import { useEvent } from './EventLayout';
import { Tabs } from '../../components/ui';
import { TournamentsTab } from './setup/TournamentsTab';
import { SportsTab } from './setup/SportsTab';
import { VenuesTab } from './setup/VenuesTab';
import { InvitePanel } from '../../components/InvitePanel';

export function EventSetupPage() {
  const { eventId } = useEvent();
  const [tab, setTab] = useState('tournaments');
  return (
    <div>
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'tournaments', label: 'Tournaments' },
          { id: 'venues', label: 'Venues & grounds' },
          { id: 'sports', label: 'Sports & disciplines' },
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
