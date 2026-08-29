import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Rules,
  type AudienceRole,
  type AudienceRule,
} from '@semp/notifications/client';
import {
  Building2,
  Check,
  ContactRound,
  ShieldCheck,
  Users,
} from 'lucide-react';

import { useApi } from '../lib/hooks';
import { notificationHooks } from '../lib/notification';
import type { PostableEvent } from '../lib/notifications';

import {
  Button,
  Field,
  Input,
  Modal,
  Spinner,
  Textarea,
  toast,
} from './ui';

const AUDIENCE_OPTIONS: {
  value: AudienceRole;
  label: string;
  description: string;
  icon: typeof Users;
}[] = [
    {
      value: 'all' as AudienceRole,
      label: 'Everyone',
      description: 'All championship users',
      icon: Users,
    },
    {
      value: 'poc',
      label: 'Point of Contact',
      description: 'Organization points of contact',
      icon: ContactRound,
    },
    {
      value: 'captain',
      label: 'Captain',
      description: 'Team captains',
      icon: ShieldCheck,
    },
    {
      value: 'official',
      label: 'Official',
      description: 'Championship officials',
      icon: ShieldCheck,
    },
    {
      value: 'organiser',
      label: 'Organiser',
      description: 'Championship organisers',
      icon: Building2,
    },
  ];

export function NotificationComposeModal({
  onClose,
  defaultEventId,
}: {
  onClose: () => void;
  defaultEventId?: string;
}) {
  const qc = useQueryClient();

  const {
    data: championships = [],
    isLoading,
  } = useApi<PostableEvent[]>(
    '/notifications/postable-championships',
  );

  const [eventId, setEventId] = useState(
    defaultEventId ?? '',
  );

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const [selectedServiceAudiences, setSelectedServiceAudiences] =
    useState<AudienceRole[]>(['all' as AudienceRole]);

  const [busy, setBusy] = useState(false);
  const [error, setError] =
    useState<string | null>(null);

  const sendNotification =
    notificationHooks.useSendNotification();

  const buildServiceAudience = (
    championshipId: string,
  ): AudienceRule | null => {
    if (
      selectedServiceAudiences.includes(
        'all' as AudienceRole,
      )
    ) {
      return Rules.everyone(championshipId);
    }

    if (selectedServiceAudiences.length === 1) {
      return Rules.role(
        selectedServiceAudiences[0],
        championshipId,
      );
    }

    return Rules.compose(
      selectedServiceAudiences.map((role) =>
        Rules.role(role, championshipId),
      ),
    );
  };

  const toggleAudience = (role: AudienceRole) => {
  // Everyone is a special "all roles" selection.
  if (role === ('all' as AudienceRole)) {
    setSelectedServiceAudiences(['all' as AudienceRole]);
    return;
  }

  setSelectedServiceAudiences((current) => {
    // If Everyone is selected, selecting an individual role
    // switches from Everyone to that individual role.
    const currentRoles = current.filter(
      (item) => item !== ('all' as AudienceRole),
    );

    const alreadySelected = currentRoles.includes(role);

    const nextRoles = alreadySelected
      ? currentRoles.filter((item) => item !== role)
      : [...currentRoles, role];

    // POC + Captain + Official + Organiser = Everyone.
    if (nextRoles.length === 4) {
      return ['all' as AudienceRole];
    }

    // If nothing is selected, fall back to Everyone.
    if (nextRoles.length === 0) {
      return ['all' as AudienceRole];
    }

    return nextRoles;
  });
};

  const submit = async () => {
    setError(null);

    const chosen =
      eventId ||
      (championships.length === 1
        ? championships[0].id
        : '');

    if (!chosen) {
      setError('Pick an championship');
      return;
    }

    if (!title.trim()) {
      setError('A title is required');
      return;
    }

    setBusy(true);

    try {
      const serviceAudience =
        buildServiceAudience(chosen);

      if (serviceAudience) {
        await new Promise<void>((resolve, reject) => {
          sendNotification.mutate(
            {
              championshipId: chosen,
              audience: serviceAudience,
              title: title.trim(),
              body: body.trim() || undefined,
            },
            {
              onSuccess: () => resolve(),
              onError: (error) => reject(error),
            },
          );
        });
      }

      qc.invalidateQueries({
        predicate: (q) =>
          typeof q.queryKey[0] === 'string' &&
          (q.queryKey[0] as string).startsWith(
            '/notifications',
          ),
      });

      toast.success('Notification sent');
      onClose();
    } catch (e: any) {
      setError(
        e?.message ?? 'Could not send',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New notification"
      onClose={onClose}
    >
      {isLoading ? (
        <Spinner />
      ) : championships.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          You don't have any championships you can
          post to.
        </p>
      ) : (
        <>
          <Field label="Championship">
            <select
              value={
                eventId ||
                (championships.length === 1
                  ? championships[0].id
                  : '')
              }
              onChange={(e) =>
                setEventId(e.target.value)
              }
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-brand-500 focus:ring-[3px] focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              {championships.length !== 1 && (
                <option value="">
                  Select an championship…
                </option>
              )}

              {championships.map((ev) => (
                <option
                  key={ev.id}
                  value={ev.id}
                >
                  {ev.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Title">
            <Input
              value={title}
              onChange={(e) =>
                setTitle(e.target.value)
              }
              placeholder="e.g. Schedule update"
              maxLength={200}
            />
          </Field>

          <Field
            label="Message"
            hint="Optional details."
          >
            <Textarea
              value={body}
              onChange={(e) =>
                setBody(e.target.value)
              }
              rows={4}
              className="w-full"
              placeholder="What do you want people to know?"
            />
          </Field>

          <Field
            label="Audience"
            hint="Select one or more roles."
          >
            <div className="grid grid-cols-2 gap-2">
              {AUDIENCE_OPTIONS.map((option) => {
                const Icon = option.icon;
                const selected =
                  selectedServiceAudiences.includes(
                    option.value,
                  );

                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() =>
                      toggleAudience(option.value)
                    }
                    className={[
                      'relative flex min-h-[72px] items-center gap-3 rounded-xl border px-3 py-2.5 text-left',
                      selected
                        ? 'border-brand-500 bg-brand-500/10 text-slate-900 ring-1 ring-brand-500 dark:bg-brand-500/15 dark:text-slate-100'
                        : 'border-slate-200 bg-white text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'grid h-9 w-9 shrink-0 place-items-center rounded-lg',
                        selected
                          ? 'bg-brand-500/15 text-brand-600 dark:text-brand-300'
                          : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
                      ].join(' ')}
                    >
                      <Icon
                        size={18}
                        strokeWidth={2}
                      />
                    </span>

                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">
                        {option.label}
                      </span>

                      <span className="mt-0.5 block text-[11px] leading-4 text-slate-500 dark:text-slate-400">
                        {option.description}
                      </span>
                    </span>

                    {selected && (
                      <span className="absolute right-2 top-2 grid h-4 w-4 place-items-center rounded-full bg-brand-600 text-white">
                        <Check size={10} strokeWidth={3} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {selectedServiceAudiences.length > 1 &&
              !selectedServiceAudiences.includes(
                'all' as AudienceRole,
              ) && (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Multiple roles will receive the same
                  notification.
                </p>
              )}
          </Field>

          {error && (
            <p className="mt-1 text-sm text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={onClose}
            >
              Cancel
            </Button>

            <Button
              disabled={
                busy ||
                sendNotification.isPending
              }
              onClick={submit}
            >
              {busy ||
                sendNotification.isPending
                ? 'Sending…'
                : 'Send'}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}