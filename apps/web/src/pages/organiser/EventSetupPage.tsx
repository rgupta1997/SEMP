import { useState } from 'react';
import { useEvent } from './EventLayout';
import { Tabs } from '../../components/ui';
import { TournamentsTab } from './setup/TournamentsTab';
import { SportsTab } from './setup/SportsTab';
import { VenuesTab } from './setup/VenuesTab';

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
          { id: 'sports', label: 'Sports & disciplines' },
          { id: 'venues', label: 'Venues & grounds' },
        ]}
      />
      <div className="mt-6">
        {tab === 'tournaments' && <TournamentsTab eventId={eventId} onCreated={() => setTab('sports')} />}
        {tab === 'sports' && <SportsTab eventId={eventId} />}
        {tab === 'venues' && <VenuesTab eventId={eventId} />}
      </div>
    </div>
  );
}
