import { useState } from 'react';
import { confirmDialog, toast } from '../../../components/ui';
import { eventSetupApi, useSetupCache } from '../api';
import type { EventSetupDetail } from '../types';

/**
 * Undo, behind a confirmation that says what goes and what stays. Shared by the
 * After-apply panel and a failed run (which may have built part of the event
 * before it stopped). The server is the one that refuses once a match is played;
 * its sentence is shown as it is.
 */
export function useUndoSetup(setup: EventSetupDetail) {
  const { put, refresh } = useSetupCache();
  const [undoing, setUndoing] = useState(false);

  const undo = async () => {
    // What is typed is what is deleted: the championship's name, or the setup's label
    // when no championship was made. The API refuses the undo without it.
    const confirmText = (setup.championship_name ?? setup.label).trim();
    const ok = await confirmDialog({
      title: 'Undo this setup?',
      message: (
        <div className="flex flex-col gap-2">
          <p>
            Everything this run created is removed: the championship{setup.championship_name ? ` "${setup.championship_name}"` : ''}, its venue,
            draws, squads and fixtures, and the people and logins it made. Anything it found already on the platform and reused is left alone.
          </p>
          <p className="font-semibold">Undo is refused once any match has been played.</p>
        </div>
      ),
      confirmLabel: 'Undo setup',
      tone: 'danger',
      confirmText,
    });
    if (!ok) return;
    setUndoing(true);
    try {
      put(await eventSetupApi.undo(setup.id, confirmText));
      toast.success('Undone', 'Everything the run created was removed.');
    } catch (e) {
      toast.error('Could not undo', (e as Error)?.message ?? 'Try again.');
      refresh(setup.id);
    } finally {
      setUndoing(false);
    }
  };

  return { undo, undoing };
}
