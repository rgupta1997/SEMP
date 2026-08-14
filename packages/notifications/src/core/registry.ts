import { Rules, type AudienceRule } from './rules.js';

export interface RuleContext {
  championshipId?: string;
  organizationId?: string;
  teamId?: string;
  userId?: string;
}

export interface NotificationTypeDef {
  key: string;
  defaultAudience: (ctx: RuleContext) => AudienceRule;
  titleTemplate: (data: Record<string, unknown>) => string;
  bodyTemplate?: (data: Record<string, unknown>) => string | null;
}

export const NOTIFICATION_TYPES: Record<string, NotificationTypeDef> = {
  event_lifecycle: {
    key: 'event_lifecycle',

    defaultAudience: (ctx) => {
      if (!ctx.championshipId) {
        throw new Error('championshipId is required for event_lifecycle');
      }

      return Rules.role('captain', ctx.championshipId);
    },

    titleTemplate: (data) => {
      switch (data.status) {
        case 'registration_open':
          return 'Registration is open';
        case 'ongoing':
          return 'The championship is now live';
        case 'completed':
          return 'The championship has concluded';
        default:
          throw new Error(`Unsupported lifecycle status: ${String(data.status)}`);
      }
    },

    bodyTemplate: (data) => {
      switch (data.status) {
        case 'registration_open':
          return 'This championship is now open for organization registration.';
        case 'ongoing':
          return 'Matches are underway - good luck to all teams.';
        case 'completed':
          return 'Thanks for taking part. Final standings are available.';
        default:
          return null;
      }
    },
  },
  enrollment_approved: {
    key: 'enrollment_approved',

    defaultAudience: (ctx) => {
      if (!ctx.championshipId) {
        throw new Error('championshipId is required for enrollment_approved');
      }

      return Rules.everyone(ctx.championshipId);
    },

    titleTemplate: (data) => {
      const orgName = String(data.orgName ?? 'An organization');
      return `${orgName} has joined the championship`;
    },

    bodyTemplate: (data) => {
      const orgName = String(
        data.bodyOrgName ?? data.orgName ?? 'An organization',
      );

      if (data.invitationAccepted === true) {
        const championshipName = String(
          data.championshipName ?? 'the championship',
        );

        return `${orgName} accepted the invitation to ${championshipName} and can now enter teams.`;
      }

      const championshipName = data.championshipName
        ? ` in ${String(data.championshipName)}`
        : '';

      return `${orgName} has been approved to participate${championshipName}.`;
    },
  },
  manual: {
    key: 'manual',

    defaultAudience: (ctx) => {
      if (!ctx.userId) {
        throw new Error('userId is required for manual notification');
      }

      return Rules.directUser(ctx.userId);
    },

    titleTemplate: (data) => {
      return String(data.title ?? '');
    },

    bodyTemplate: (data) => {
      return data.body == null ? null : String(data.body);
    },
  },
  org_join_request: {
    key: 'org_join_request',

    defaultAudience: (ctx) => {
      if (!ctx.organizationId) {
        throw new Error('organizationId is required for org_join_request');
      }

      return Rules.orgAdmins(ctx.organizationId);
    },

    titleTemplate: (data) => {
      const who = String(data.who ?? 'Someone');
      const organizationName = String(
        data.organizationName ?? 'the organization',
      );

      return `${who} requested to join ${organizationName}`;
    },

    bodyTemplate: () => {
      return 'Review the request on your organization’s Members page.';
    },
  },
  org_join_approved: {
    key: 'org_join_approved',

    defaultAudience: (ctx) => {
      if (!ctx.userId) {
        throw new Error('userId is required for org_join_approved');
      }

      return Rules.directUser(ctx.userId);
    },

    titleTemplate: (data) => {
      const organizationName = String(
        data.organizationName ?? 'the organization',
      );

      return `You’ve been approved to join ${organizationName}`;
    },
  },
  org_join_declined: {
    key: 'org_join_declined',

    defaultAudience: (ctx) => {
      if (!ctx.userId) {
        throw new Error('userId is required for org_join_declined');
      }

      return Rules.directUser(ctx.userId);
    },

    titleTemplate: (data) => {
      const organizationName = String(
        data.organizationName ?? 'the organization',
      );

      return `Your request to join ${organizationName} was declined`;
    },
  },
};