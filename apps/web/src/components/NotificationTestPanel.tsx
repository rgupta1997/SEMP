import { useState } from 'react';
import {
  Rules,
  type AudienceRole,
  type AudienceRule,
} from '@semp/notifications/client';
import { notificationHooks } from '../lib/notification.ts';
import { titleCase } from '../lib/format';

const AUDIENCES: AudienceRole[] = [
  'poc',
  'captain',
  'official',
  'organiser',
];

export function NotificationTestPanel() {
  const [championshipId, setChampionshipId] = useState('');
  const [selectedRoles, setSelectedRoles] = useState<AudienceRole[]>([]);
  const [everyone, setEveryone] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const sendNotification = notificationHooks.useSendNotification();

  const toggleRole = (role: AudienceRole) => {
    setSelectedRoles((current) =>
      current.includes(role)
        ? current.filter((item) => item !== role)
        : [...current, role],
    );
  };

  const buildAudience = (): AudienceRule | null => {
    if (!championshipId.trim()) {
      return null;
    }

    if (everyone) {
      return Rules.everyone(championshipId.trim());
    }

    const rules = selectedRoles.map((role) =>
      Rules.role(role, championshipId.trim()),
    );

    if (rules.length === 0) {
      return null;
    }

    if (rules.length === 1) {
      return rules[0];
    }

    return Rules.compose(rules);
  };

  const handleSend = () => {
    const audience = buildAudience();

    if (!audience) {
      return;
    }

    sendNotification.mutate({
      championshipId: championshipId.trim(),
      audience,
      title: title.trim() || 'Notification test',
      body: body.trim() || undefined,
    });
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">
        Notification Test
      </h2>

      <p className="mt-1 text-sm text-slate-500">
        Send a notification using the real audience rules.
      </p>

      <div className="mt-5 space-y-4">
        <div>
          <label className="text-sm font-medium">
            Championship ID
          </label>

          <input
            value={championshipId}
            onChange={(e) => setChampionshipId(e.target.value)}
            placeholder="Championship ID"
            className="mt-1 w-full rounded-lg border px-3 py-2"
          />
        </div>

        <div>
          <label className="text-sm font-medium">
            Audience
          </label>

          <div className="mt-2 flex flex-wrap gap-2">
            {AUDIENCES.map((role) => {
              const selected = selectedRoles.includes(role);

              return (
                <button
                  key={role}
                  type="button"
                  onClick={() => {
                    setEveryone(false);
                    toggleRole(role);
                  }}
                  className={`rounded-lg border px-3 py-2 text-sm ${
                    selected
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-slate-200'
                  }`}
                >
                  {role === 'poc' ? 'POC' : titleCase(role)}
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => {
                setEveryone(true);
                setSelectedRoles([]);
              }}
              className={`rounded-lg border px-3 py-2 text-sm ${
                everyone
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-slate-200'
              }`}
            >
              everyone
            </button>
          </div>

          {selectedRoles.length > 1 && (
            <p className="mt-2 text-xs text-slate-500">
              Multiple roles will be sent as a compose audience.
            </p>
          )}
        </div>

        <div>
          <label className="text-sm font-medium">
            Title
          </label>

          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Notification title"
            className="mt-1 w-full rounded-lg border px-3 py-2"
          />
        </div>

        <div>
          <label className="text-sm font-medium">
            Body
          </label>

          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Notification body"
            rows={3}
            className="mt-1 w-full rounded-lg border px-3 py-2"
          />
        </div>

        <button
          type="button"
          disabled={
            sendNotification.isPending ||
            !championshipId.trim() ||
            (!everyone && selectedRoles.length === 0)
          }
          onClick={handleSend}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {sendNotification.isPending
            ? 'Sending...'
            : 'Send notification'}
        </button>

        {sendNotification.isSuccess && (
          <p className="text-sm text-green-600">
            Notification sent successfully.
          </p>
        )}

        {sendNotification.isError && (
          <p className="text-sm text-red-600">
            {sendNotification.error instanceof Error
              ? sendNotification.error.message
              : 'Failed to send notification.'}
          </p>
        )}
      </div>
    </div>
  );
}