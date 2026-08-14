import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { NotificationAudience } from '@semp/shared';
import {
  Rules,
  type AudienceRole,
  type AudienceRule,
} from '@semp/notifications/client';

import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { notificationHooks } from '../lib/notification';
import type { PostableEvent } from '../lib/notifications';

import {
  Button,
  Field,
  Input,
  Modal,
  Segmented,
  Spinner,
  Textarea,
  toast,
} from './ui';

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

  const [audience, setAudience] =
    useState<NotificationAudience>('all');

  const [selectedServiceAudiences, setSelectedServiceAudiences] =
    useState<AudienceRole[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] =
    useState<string | null>(null);

  const sendNotification =
    notificationHooks.useSendNotification();

  const buildServiceAudience = (
    championshipId: string,
  ): AudienceRule | null => {
    if (selectedServiceAudiences.length === 0) {
      return null;
    }

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
        // Notification Service flow.
        // This is the only notification sent when a
        // Notification Service Audience is selected.
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
      } else {
        // Existing notification flow.
        // Used only when no Notification Service Audience
        // has been selected.
        await api('POST', '/notifications', {
          championship_id: chosen,
          title: title.trim(),
          body: body.trim() || undefined,
          audience,
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
            hint="Who should receive this notification."
          >
            <Segmented<NotificationAudience>
              value={audience}
              onChange={setAudience}
              options={[
                {
                  value: 'all',
                  label: 'All championship users',
                },
                {
                  value: 'organizations_captains',
                  label: 'Organizations + captains',
                },
              ]}
            />
          </Field>

          <Field
            label="Notification Service Audience"
            hint="Hold Ctrl (Windows) or Cmd (Mac) to select multiple."
          >
            <select
              multiple
              value={selectedServiceAudiences}
              onChange={(e) => {
                const values = Array.from(
                  e.target.selectedOptions,
                  (option) =>
                    option.value as AudienceRole,
                );

                setSelectedServiceAudiences(values);
              }}
              className="min-h-32 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-brand-500 focus:ring-[3px] focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="poc">
                Point of Contact
              </option>

              <option value="captain">
                Captain
              </option>

              <option value="official">
                Official
              </option>

              <option value="organiser">
                Organiser
              </option>
            </select>

            {selectedServiceAudiences.length > 0 && (
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Selected:{' '}
                {selectedServiceAudiences.join(', ')}
              </p>
            )}

            {selectedServiceAudiences.length > 1 && (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Multiple selections will create a
                composed audience.
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