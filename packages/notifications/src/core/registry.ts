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

      // Matches the pre-refactor 'organizations_captains' audience (POCs + team
      // captains/vice-captains) - the migration to notify() had narrowed this to
      // captains only, silently dropping organization owners from every lifecycle
      // announcement (registration opening, going live, completion).
      return Rules.compose([
        Rules.role('poc', ctx.championshipId),
        Rules.role('captain', ctx.championshipId),
      ]);
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
  // ---- Billing (20260826000040) ------------------------------------------
  //
  // All four go to the people who can act on them, which for an institution is
  // the owners and admins - the same set `billing.manage` falls back to. A plan
  // change is shared: somebody who did not buy it will notice the capability
  // move, and a feed that explains why is cheaper than the support ticket that
  // otherwise follows.
  //
  // Note these DO name the plan. The rule that a locked surface must never name
  // a tier is about walls; a billing notification is the other case, where
  // saying "you are now on Pro" is the entire message.

  plan_changed: {
    key: 'plan_changed',

    defaultAudience: (ctx) => {
      if (!ctx.organizationId) {
        throw new Error('organizationId is required for plan_changed');
      }

      return Rules.orgAdmins(ctx.organizationId);
    },

    titleTemplate: (data) => `${String(data.organizationName ?? 'Your institution')} is now on ${String(data.to ?? 'a new plan')}`,

    bodyTemplate: (data) => {
      const from = data.from ? String(data.from) : null;
      return from
        ? `Changed from ${from}. Everything the new plan includes is available now.`
        : 'Everything the new plan includes is available now.';
    },
  },

  plan_downgrade_scheduled: {
    key: 'plan_downgrade_scheduled',

    defaultAudience: (ctx) => {
      if (!ctx.organizationId) {
        throw new Error('organizationId is required for plan_downgrade_scheduled');
      }

      return Rules.orgAdmins(ctx.organizationId);
    },

    titleTemplate: (data) => `${String(data.organizationName ?? 'Your institution')} will move to ${String(data.to ?? 'a lower plan')}`,

    // The date is the point of this message. Somebody has until then to change
    // their mind, and the feed is where most people will first learn of it.
    bodyTemplate: (data) => {
      const at = data.effectiveAt ? new Date(String(data.effectiveAt)) : null;
      const when = at && !Number.isNaN(at.getTime())
        ? at.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
        : 'the end of the current period';

      return `Nothing changes until ${when} - the plan you have paid for runs to the end of its term. Nothing you have created will be deleted.`;
    },
  },

  plan_downgrade_applied: {
    key: 'plan_downgrade_applied',

    defaultAudience: (ctx) => {
      if (!ctx.organizationId) {
        throw new Error('organizationId is required for plan_downgrade_applied');
      }

      return Rules.orgAdmins(ctx.organizationId);
    },

    titleTemplate: (data) => `${String(data.organizationName ?? 'Your institution')} has moved to ${String(data.to ?? 'a lower plan')}`,

    bodyTemplate: () => 'Anything created on the previous plan is still there, and becomes available again if you resubscribe.',
  },

  plan_upgrade_requested: {
    key: 'plan_upgrade_requested',

    defaultAudience: (ctx) => {
      if (!ctx.organizationId) {
        throw new Error('organizationId is required for plan_upgrade_requested');
      }

      return Rules.orgAdmins(ctx.organizationId);
    },

    titleTemplate: (data) => {
      const who = String(data.who ?? 'Somebody');
      const capability = data.capability ? String(data.capability) : null;

      return capability
        ? `${who} needs ${capability}`
        : `${who} asked about upgrading the plan`;
    },

    bodyTemplate: (data) => {
      const note = data.note ? String(data.note) : null;
      const where = `Review it on ${String(data.organizationName ?? 'your institution')}’s Billing & Subscription page.`;

      return note ? `“${note}”

${where}` : where;
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