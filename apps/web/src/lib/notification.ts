import { api } from './api';
import {
  createNotificationClient,
  createNotificationHooks,
} from '@semp/notifications/client';

export const notificationClient = createNotificationClient(api);

export const notificationHooks = createNotificationHooks(api);