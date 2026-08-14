export interface NotificationClient {
  getFeed(params?: {
    championshipId?: string;
    unread?: boolean;
  }): Promise<unknown>;

  getUnreadCount(): Promise<number>;

  sendManual(input: {
    championshipId?: string;
    organizationId?: string;
    teamId?: string;
    userId?: string;
    audience: unknown;
    title: string;
    body?: string;
  }): Promise<unknown>;

  markRead(notificationId: string): Promise<void>;

  markAllRead(): Promise<unknown>;

  react(
    notificationId: string,
    reaction: string,
  ): Promise<unknown>;
}

export interface NotificationRequest {
  <T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T>;
}

export function createNotificationClient(
  request: NotificationRequest,
): NotificationClient {
  return {
    getFeed: (params) => {
      const search = new URLSearchParams();

      if (params?.championshipId) {
        search.set('championship_id', params.championshipId);
      }

      if (params?.unread) {
        search.set('unread', '1');
      }

      const query = search.toString();

      return request(
        'GET',
        `/notifications${query ? `?${query}` : ''}`,
      );
    },

    getUnreadCount: () =>
      request<{ count: number }>(
        'GET',
        '/notifications/unread-count',
      ).then((result) => result.count),

    sendManual: (input) =>
      request('POST', '/notifications/test-compose', {
        championship_id: input.championshipId,
        organization_id: input.organizationId,
        team_id: input.teamId,
        user_id: input.userId,
        audience: input.audience,
        title: input.title,
        body: input.body,
      }),

    markRead: (notificationId) =>
      request(
        'POST',
        `/notifications/${notificationId}/read`,
      ),

    markAllRead: () =>
      request(
        'POST',
        '/notifications/read-all',
      ),

    react: (notificationId, reaction) =>
      request(
        'POST',
        `/notifications/${notificationId}/reactions`,
        { reaction },
      ),
  };
}