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
      // `entrants` is the host's own noun for what competes - "campuses",
      // "batches", or absent for an open championship. It matters most here:
      // "open for organization registration" is simply false on an internal
      // event, where no organisation registers and the competitors are the
      // host's own units, added by the organiser.
      const entrants = data.entrants ? String(data.entrants) : null;
      switch (data.status) {
        case 'registration_open':
          return entrants
            ? `This championship is now open. Its ${entrants} can enter their squads.`
            : 'This championship is now open for organization registration.';
        case 'ongoing':
          return 'Matches are underway - good luck to all teams.';
        case 'completed':
          return 'Thanks for taking part. Final standings are available.';
        default:
          return null;
      }
    },
  },

  /**
   * A campus or batch has been added to an internal championship.
   *
   * Distinct from `enrollment_approved`, which announces that an ORGANISATION
   * joined. Reusing that type here produced "Northfield has joined the
   * championship" on an event contested between Northfield's own campuses - which
   * is both useless and slightly absurd, since the organisation is the host. What
   * the reader needs is WHICH campus.
   *
   * There is nothing to approve, so the wording is an announcement rather than a
   * decision: being added is taking part.
   */
  contingent_added: {
    key: 'contingent_added',

    defaultAudience: (ctx) => {
      if (!ctx.championshipId) {
        throw new Error('championshipId is required for contingent_added');
      }
      return Rules.everyone(ctx.championshipId);
    },

    titleTemplate: (data) => {
      const name = String(data.unitName ?? 'A campus');
      return `${name} is taking part`;
    },

    bodyTemplate: (data) => {
      const name = String(data.unitName ?? 'A campus');
      const where = data.championshipName ? ` in ${String(data.championshipName)}` : '';
      // Named with its parent when it has one: two campuses can each have a
      // "2026", and a notification naming only the batch tells nobody whose it is.
      const under = data.parentName ? ` (${String(data.parentName)})` : '';
      return `${name}${under} has been added${where} and can now enter squads.`;
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
  // ---- organisation verification ------------------------------------------
  //
  // Addressed to the institution's owners and admins rather than to whoever
  // submitted the request. Verification is a fact about the ORGANISATION, the
  // person who filled the form in may have left, and the tick appearing (or not)
  // is something its administrators need to know either way.
  org_verification_approved: {
    key: 'org_verification_approved',

    defaultAudience: (ctx) => {
      if (!ctx.organizationId) {
        throw new Error('organizationId is required for org_verification_approved');
      }

      return Rules.orgAdmins(ctx.organizationId);
    },

    titleTemplate: () => 'Your organisation is now verified',

    bodyTemplate: (data) => {
      const organizationName = String(data.organizationName ?? 'Your organisation');

      return `${organizationName} carries the verification tick wherever it appears.`;
    },
  },
  org_verification_rejected: {
    key: 'org_verification_rejected',

    defaultAudience: (ctx) => {
      if (!ctx.organizationId) {
        throw new Error('organizationId is required for org_verification_rejected');
      }

      return Rules.orgAdmins(ctx.organizationId);
    },

    titleTemplate: () => 'Verification was not approved',

    // The reason is the whole point of the notification. Without it this is a dead
    // end: nothing on the screen would say what to fix, and the only next step
    // would be a support email.
    bodyTemplate: (data) => {
      const reason = data.reason ? String(data.reason) : null;

      return reason
        ? `${reason} You can submit a new request once that is sorted.`
        : 'You can submit a new request from Administration → Organization Profile.';
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

  // ---- Trigger Matrix build-out (2026-08-26) -----------------------------
  //
  // Every type below wires an existing app action to notify() for the first
  // time - none of them add a new status, field, or workflow. Recipients and
  // copy are taken directly from the trigger-matrix/notification-spec doc.
  // Anything from that doc needing a scheduler or a not-yet-built concept
  // (trials, waitlists, deadlines, lineups, reminders, reports) is
  // deliberately left out - see the audit this build-out followed.

  role_assigned: {
    key: 'role_assigned',
    defaultAudience: (ctx) => {
      if (!ctx.userId) throw new Error('userId is required for role_assigned');
      return Rules.directUser(ctx.userId);
    },
    titleTemplate: () => 'You have been assigned a new role',
    bodyTemplate: (data) => {
      const role = String(data.roleName ?? 'a role');
      const org = String(data.organizationName ?? 'your institution');
      return `You've been given the ${role} role at ${org}.`;
    },
  },

  role_changed: {
    key: 'role_changed',
    defaultAudience: (ctx) => {
      if (!ctx.userId) throw new Error('userId is required for role_changed');
      return Rules.directUser(ctx.userId);
    },
    titleTemplate: () => 'Your organization role changed',
    bodyTemplate: (data) => {
      const role = String(data.roleName ?? 'your role');
      const status = String(data.status ?? '').toLowerCase();
      const org = String(data.organizationName ?? 'your institution');
      return status
        ? `Your ${role} role at ${org} is now ${status}.`
        : `Your ${role} role at ${org} has changed.`;
    },
  },

  admin_access_revoked: {
    key: 'admin_access_revoked',
    defaultAudience: (ctx) => {
      if (!ctx.userId) throw new Error('userId is required for admin_access_revoked');
      return Rules.directUser(ctx.userId);
    },
    titleTemplate: () => 'Your admin access changed',
    bodyTemplate: (data) => {
      const role = String(data.roleName ?? 'role');
      const org = String(data.organizationName ?? 'your institution');
      return `Your ${role} access at ${org} has been removed.`;
    },
  },

  // ---- Team (2026-08-26) --------------------------------------------------

  team_created: {
    key: 'team_created',
    defaultAudience: (ctx) => {
      if (!ctx.userId) throw new Error('userId is required for team_created');
      return Rules.directUser(ctx.userId);
    },
    titleTemplate: () => 'Team created successfully',
    bodyTemplate: (data) => `${String(data.teamName ?? 'Your team')} is ready.`,
  },

  team_player_added: {
    key: 'team_player_added',
    defaultAudience: (ctx) => {
      if (!ctx.userId) throw new Error('userId is required for team_player_added');
      return Rules.directUser(ctx.userId);
    },
    titleTemplate: () => "You've been added to a team",
    bodyTemplate: (data) => `You're now part of ${String(data.teamName ?? 'the team')}.`,
  },

  team_player_removed: {
    key: 'team_player_removed',
    defaultAudience: (ctx) => {
      if (!ctx.userId) throw new Error('userId is required for team_player_removed');
      return Rules.directUser(ctx.userId);
    },
    titleTemplate: () => 'You were removed from a team',
    bodyTemplate: (data) => `You're no longer part of ${String(data.teamName ?? 'the team')}.`,
  },

  team_coach_assigned: {
    key: 'team_coach_assigned',
    defaultAudience: (ctx) => {
      if (!ctx.userId) throw new Error('userId is required for team_coach_assigned');
      return Rules.directUser(ctx.userId);
    },
    titleTemplate: () => "You've been assigned as coach",
    bodyTemplate: (data) => `You're now the coach of ${String(data.teamName ?? 'the team')}.`,
  },

  team_captain_assigned: {
    key: 'team_captain_assigned',
    defaultAudience: (ctx) => {
      if (!ctx.userId) throw new Error('userId is required for team_captain_assigned');
      return Rules.directUser(ctx.userId);
    },
    titleTemplate: () => "You've been named team captain",
    bodyTemplate: (data) => `You're now captain of ${String(data.teamName ?? 'the team')}.`,
  },

  team_roster_locked: {
    key: 'team_roster_locked',
    defaultAudience: (ctx) => {
      if (!ctx.teamId) throw new Error('teamId is required for team_roster_locked');
      return Rules.teamMembers(ctx.teamId);
    },
    titleTemplate: () => 'Team roster locked',
    bodyTemplate: (data) => `${String(data.teamName ?? 'Your team')}'s roster is now locked in.`,
  },

  // ---- Fixture / Match / Result (2026-08-26) ------------------------------
  //
  // match_* types are always called with an explicit `audience` (both teams'
  // members + coaches, composed from real ids at the call site) - there's no
  // single teamId/championshipId in RuleContext that could express "both
  // sides of this match", so defaultAudience intentionally refuses to guess.

  fixtures_generated: {
    key: 'fixtures_generated',
    defaultAudience: (ctx) => {
      if (!ctx.championshipId) throw new Error('championshipId is required for fixtures_generated');
      return Rules.role('organiser', ctx.championshipId);
    },
    titleTemplate: () => 'Fixtures generated',
    bodyTemplate: (data) => `Fixtures for ${String(data.disciplineName ?? 'the draw')} are ready to review.`,
  },

  match_scheduled: {
    key: 'match_scheduled',
    defaultAudience: () => { throw new Error('match_scheduled requires an explicit audience'); },
    titleTemplate: () => 'Your match has been scheduled',
    bodyTemplate: (data) => String(data.body ?? ''),
  },

  match_rescheduled: {
    key: 'match_rescheduled',
    defaultAudience: () => { throw new Error('match_rescheduled requires an explicit audience'); },
    titleTemplate: () => 'Match time changed',
    bodyTemplate: (data) => String(data.body ?? ''),
  },

  match_venue_changed: {
    key: 'match_venue_changed',
    defaultAudience: () => { throw new Error('match_venue_changed requires an explicit audience'); },
    titleTemplate: () => 'Match venue changed',
    bodyTemplate: (data) => String(data.body ?? ''),
  },

  match_opponent_changed: {
    key: 'match_opponent_changed',
    defaultAudience: () => { throw new Error('match_opponent_changed requires an explicit audience'); },
    titleTemplate: () => 'Match opponent changed',
    bodyTemplate: (data) => String(data.body ?? ''),
  },

  match_cancelled: {
    key: 'match_cancelled',
    defaultAudience: () => { throw new Error('match_cancelled requires an explicit audience'); },
    titleTemplate: () => 'Match cancelled',
    bodyTemplate: (data) => String(data.body ?? ''),
  },

  match_live: {
    key: 'match_live',
    defaultAudience: () => { throw new Error('match_live requires an explicit audience'); },
    titleTemplate: () => 'Match is live',
    bodyTemplate: (data) => String(data.body ?? ''),
  },

  result_submitted: {
    key: 'result_submitted',
    defaultAudience: (ctx) => {
      if (!ctx.championshipId) throw new Error('championshipId is required for result_submitted');
      return Rules.role('organiser', ctx.championshipId);
    },
    titleTemplate: () => 'Result submitted',
    bodyTemplate: (data) => String(data.body ?? 'A match result is ready to review.'),
  },

  team_qualifies: {
    key: 'team_qualifies',
    defaultAudience: () => { throw new Error('team_qualifies requires an explicit audience'); },
    titleTemplate: () => 'Your team has qualified',
    bodyTemplate: (data) => String(data.body ?? ''),
  },

  // ---- Event (2026-08-26) --------------------------------------------------

  registration_submitted: {
    key: 'registration_submitted',
    defaultAudience: (ctx) => {
      if (!ctx.userId) throw new Error('userId is required for registration_submitted');
      return Rules.directUser(ctx.userId);
    },
    titleTemplate: () => 'Registration submitted',
    bodyTemplate: (data) => `Your application to ${String(data.championshipName ?? 'the championship')} was received.`,
  },

  participant_approval_pending: {
    key: 'participant_approval_pending',
    defaultAudience: (ctx) => {
      if (!ctx.championshipId) throw new Error('championshipId is required for participant_approval_pending');
      return Rules.role('organiser', ctx.championshipId);
    },
    titleTemplate: () => 'Registrations awaiting approval',
    bodyTemplate: (data) => `${String(data.orgName ?? 'An organization')} applied to ${String(data.championshipName ?? 'your championship')}.`,
  },

  registration_rejected: {
    key: 'registration_rejected',
    defaultAudience: (ctx) => {
      if (!ctx.organizationId) throw new Error('organizationId is required for registration_rejected');
      return Rules.orgAdmins(ctx.organizationId);
    },
    titleTemplate: () => 'Registration not approved',
    bodyTemplate: (data) => {
      const reason = data.reason ? String(data.reason) : null;
      const championshipName = String(data.championshipName ?? 'the championship');
      return reason
        ? `Your application to ${championshipName} was not approved: ${reason}`
        : `Your application to ${championshipName} was not approved.`;
    },
  },

  // ---- Organization / Achievement / Certificate / Signup (2026-08-26) -----

  organization_created: {
    key: 'organization_created',
    defaultAudience: (ctx) => {
      if (!ctx.userId) throw new Error('userId is required for organization_created');
      return Rules.directUser(ctx.userId);
    },
    titleTemplate: () => 'Organization workspace created',
    bodyTemplate: (data) => `${String(data.organizationName ?? 'Your organization')} is ready to set up.`,
  },

  achievement_created: {
    key: 'achievement_created',
    defaultAudience: (ctx) => {
      if (!ctx.userId) throw new Error('userId is required for achievement_created');
      return Rules.directUser(ctx.userId);
    },
    titleTemplate: () => 'New achievement added',
    bodyTemplate: (data) => String(data.title ?? 'A new achievement was added to your profile.'),
  },

  certificate_generated: {
    key: 'certificate_generated',
    defaultAudience: (ctx) => {
      if (!ctx.userId) throw new Error('userId is required for certificate_generated');
      return Rules.directUser(ctx.userId);
    },
    titleTemplate: () => 'Your certificate is ready',
    bodyTemplate: (data) => String(data.title ?? 'A certificate was generated for you.'),
  },

  account_created: {
    key: 'account_created',
    defaultAudience: (ctx) => {
      if (!ctx.userId) throw new Error('userId is required for account_created');
      return Rules.directUser(ctx.userId);
    },
    titleTemplate: () => 'Welcome to EOS',
    bodyTemplate: () => 'Your account is ready. Complete your profile to get started.',
  },

  account_security_changed: {
    key: 'account_security_changed',
    defaultAudience: (ctx) => {
      if (!ctx.userId) throw new Error('userId is required for account_security_changed');
      return Rules.directUser(ctx.userId);
    },
    titleTemplate: () => 'Account security updated',
    bodyTemplate: () => 'Your password was changed. If this wasn’t you, review your account.',
  },

  // ---- Corrections (2026-08-27) - two rows mis-scoped as blocked earlier -------

  fixtures_published: {
    key: 'fixtures_published',
    // Same shape as the match_* family: the audience is every team in the newly-
    // generated draw, composed from real ids at the call site - no single teamId in
    // RuleContext could express that.
    defaultAudience: () => { throw new Error('fixtures_published requires an explicit audience'); },
    titleTemplate: () => 'Fixtures are now available',
    bodyTemplate: (data) => `Fixtures for ${String(data.disciplineName ?? 'the draw')} are ready to view.`,
  },

  match_score_locked: {
    key: 'match_score_locked',
    defaultAudience: () => { throw new Error('match_score_locked requires an explicit audience'); },
    titleTemplate: () => 'Match score locked',
    bodyTemplate: (data) => String(data.body ?? 'This scorecard is now locked.'),
  },
};