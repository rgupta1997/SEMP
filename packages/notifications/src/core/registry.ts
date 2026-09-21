import { Rules, type AudienceRule } from './rules.js';

export interface RuleContext {
  championshipId?: string;
  organizationId?: string;
  teamId?: string;
  userId?: string;
}

/**
 * What the same event looks like as an email.
 *
 * Separate from title/bodyTemplate rather than derived from them, because the feed
 * and the inbox are different rooms. A feed entry is read in context, next to the
 * thing it is about, and can be a fragment; an email arrives cold days later and has
 * to carry its own context and a way back into the product.
 */
export interface NotificationEmailContent {
  subject: string;
  paragraphs: string[];
  /** Rendered as a table. Values must be strings - a number is rejected upstream. */
  details?: Array<{ label: string; value: string }>;
  /**
   * App-RELATIVE path. The transport makes it absolute, because only the API layer
   * knows where the web app lives and this package must stay free of that config.
   */
  ctaPath?: string;
  ctaLabel?: string;
}

export interface NotificationEmailDef {
  /** Return null to skip the email for this particular instance. */
  build: (data: Record<string, unknown>, ctx: RuleContext) => NotificationEmailContent | null;
  /** 1-2 urgent, 3-5 transactional, 6-9 bulk. Defaults to 5. */
  priority?: number;
}

export interface NotificationTypeDef {
  key: string;
  defaultAudience: (ctx: RuleContext) => AudienceRule;
  titleTemplate: (data: Record<string, unknown>) => string;
  bodyTemplate?: (data: Record<string, unknown>) => string | null;
  /**
   * Opt-in. A type with no `email` block reaches the in-app feed only, which is the
   * right default: every type here fires today without anybody having agreed to be
   * emailed about it, and quietly turning them all on would be a mailing list nobody
   * subscribed to.
   */
  email?: NotificationEmailDef;
}

// `satisfies` rather than a `: Record<string, NotificationTypeDef>` annotation
// on purpose: an explicit annotation widens every key to `string`, which is
// exactly what NotificationTypeKey below exists to avoid. `satisfies` still
// checks every entry against the shape, but leaves the literal key union intact.
export const NOTIFICATION_TYPES = {
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

    // `data.visibility === 'public'` is a distinct trigger from `data.status` -
    // a championship going from private (invite-only) to public in Settings, not
    // a status transition. Checked first since `data.status` is absent on that call.
    titleTemplate: (data) => {
      if (data.visibility === 'public') return 'This championship is now public';
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
      if (data.visibility === 'public') {
        return 'This championship is no longer invite-only - anyone can now find and view it.';
      }
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

    // Emailed because these three moments are deadlines for somebody: registration
    // opening is the one where a POC who misses the feed misses the event entirely.
    email: {
      build: (data, ctx) => {
        const name = data.championshipName ? String(data.championshipName) : 'A championship';
        if (!ctx.championshipId) return null;

        switch (data.status) {
          case 'registration_open':
            return {
              subject: `Registration is open for ${name}`,
              paragraphs: [
                `${name} is now open for institutions to register.`,
                'Register your institution to enter teams before entries close.',
              ],
              ctaPath: `/championships/${ctx.championshipId}`,
              ctaLabel: 'Open the championship',
            };
          case 'ongoing':
            return {
              subject: `${name} is now live`,
              paragraphs: [`Matches at ${name} are underway. Fixtures and results update as they are recorded.`],
              ctaPath: `/championships/${ctx.championshipId}/schedule`,
              ctaLabel: 'View the schedule',
            };
          case 'completed':
            return {
              subject: `${name} has concluded`,
              paragraphs: [`Thanks for taking part in ${name}. Final standings are now available.`],
              ctaPath: `/championships/${ctx.championshipId}/standings`,
              ctaLabel: 'View final standings',
            };
          default:
            return null;
        }
      },
      priority: 5,
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

    // A billing change against somebody's institution. Emailed because the person who
    // notices the capability move is often not the person who made the change, and a
    // written record of what changed and when is the cheaper half of that conversation.
    email: {
      build: (data, ctx) => {
        const org = String(data.organizationName ?? 'Your institution');
        const to = String(data.to ?? 'a new plan');
        const from = data.from ? String(data.from) : null;
        return {
          subject: `${org} is now on ${to}`,
          paragraphs: [
            from
              ? `${org}'s plan has changed from ${from} to ${to}.`
              : `${org} is now on ${to}.`,
            'Everything the new plan includes is available now.',
          ],
          details: from
            ? [{ label: 'Previous plan', value: from }, { label: 'New plan', value: to }]
            : [{ label: 'Plan', value: to }],
          ctaPath: ctx.organizationId ? `/organizations/${ctx.organizationId}/admin` : '/plans',
          ctaLabel: 'View billing',
        };
      },
      priority: 3,
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

    // The date is the whole message, and it is a deadline: somebody has until then to
    // change their mind. That is exactly the kind of thing a feed entry scrolls past.
    email: {
      build: (data, ctx) => {
        const org = String(data.organizationName ?? 'Your institution');
        const to = String(data.to ?? 'a lower plan');
        const at = data.effectiveAt ? new Date(String(data.effectiveAt)) : null;
        const when = at && !Number.isNaN(at.getTime())
          ? at.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
          : 'the end of the current period';

        return {
          subject: `${org} will move to ${to} on ${when}`,
          paragraphs: [
            `${org} is scheduled to move to ${to}.`,
            `Nothing changes until ${when} - the plan you have paid for runs to the end of its term, and nothing you have created will be deleted.`,
            'If this was not intended, you can change it before that date.',
          ],
          details: [{ label: 'New plan', value: to }, { label: 'Takes effect', value: when }],
          ctaPath: ctx.organizationId ? `/organizations/${ctx.organizationId}/admin` : '/plans',
          ctaLabel: 'Review the plan',
        };
      },
      priority: 3,
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

  // Fired centrally from the error handler whenever a PlanLimitError reaches it
  // (@semp/entitlements/server) - one hook regardless of which of the several
  // routes (teams, members, events, staff seats) tripped the ceiling.
  usage_limit_reached: {
    key: 'usage_limit_reached',
    defaultAudience: (ctx) => {
      if (!ctx.organizationId) throw new Error('organizationId is required for usage_limit_reached');
      return Rules.orgAdmins(ctx.organizationId);
    },
    titleTemplate: () => 'A plan limit has been reached',
    bodyTemplate: (data) => `${String(data.message ?? 'Your plan has reached one of its limits.')} Upgrade to add more.`,
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

    // The outcome of something the recipient asked for and is waiting on, so it is
    // worth reaching them wherever they are rather than only in a feed they may not
    // revisit.
    email: {
      build: (data, ctx) => {
        const org = String(data.organizationName ?? 'the organisation');
        return {
          subject: `You've been approved to join ${org}`,
          paragraphs: [
            `Your request to join ${org} on Sportagon has been approved.`,
            'You can now see its teams, players and championships.',
          ],
          ctaPath: ctx.organizationId ? `/organizations/${ctx.organizationId}/overview` : '/home',
          ctaLabel: `Open ${org}`,
        };
      },
      priority: 3,
    },
  },
  // Somebody has been invited to join an organisation.
  //
  // In the DB's type CHECK since the email-invitations migration but never added
  // here, so notify() rejected it and the in-app half of that feature never shipped.
  // Direct-to-user: it only fires when the invited address already resolves to an
  // account. An invitee with no account has nothing to show a feed to - the email is
  // the whole message for them.
  org_invitation: {
    key: 'org_invitation',

    defaultAudience: (ctx) => {
      if (!ctx.userId) {
        throw new Error('userId is required for org_invitation');
      }

      return Rules.directUser(ctx.userId);
    },

    titleTemplate: (data) => {
      const organizationName = String(data.organizationName ?? 'an organization');
      const inviterName = data.inviterName ? String(data.inviterName) : null;

      return inviterName
        ? `${inviterName} invited you to join ${organizationName}`
        : `You've been invited to join ${organizationName}`;
    },

    bodyTemplate: (data) => {
      const role = data.role ? String(data.role) : null;
      return role
        ? `You've been invited as ${role}. Open the invitation to accept it.`
        : 'Open the invitation to accept it.';
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

    // The other half of the same wait. Told plainly and without a call to action -
    // there is nothing useful to click, and a button here would only invite a retry
    // that lands somebody back where they started.
    email: {
      build: (data) => {
        const org = String(data.organizationName ?? 'the organisation');
        return {
          subject: `Your request to join ${org} was declined`,
          paragraphs: [
            `Your request to join ${org} on Sportagon was not approved.`,
            'If you think this is a mistake, contact the institution directly - they manage their own membership.',
          ],
        };
      },
      priority: 3,
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
    // Fired on ANY role grant removal (org-roles.routes.ts's DELETE route is
    // generic - Official, Organiser, POC, not just Admin), so the title must
    // name the actual role, matching bodyTemplate below - a fixed "admin access"
    // title on a non-admin role removal contradicted its own body.
    titleTemplate: (data) => `Your ${String(data.roleName ?? 'role')} access changed`,
    bodyTemplate: (data) => {
      const role = String(data.roleName ?? 'role');
      const org = String(data.organizationName ?? 'your institution');
      return `Your ${role} access at ${org} has been removed.`;
    },
  },

  // ---- Team (2026-08-26) --------------------------------------------------

  // Coach + captain(s) + this org's admins - not just whoever clicked Create.
  // Composed from real ids at the call site (same shape as roster_incomplete):
  // no single Rule kind expresses "this team's coach + captains + this org's
  // admins" together.
  team_created: {
    key: 'team_created',
    defaultAudience: () => { throw new Error('team_created requires an explicit audience'); },
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

  // Roster + coach + org admins, composed at the call site (see
  // teams.notifications.ts) - team_members alone reaches the roster but not the
  // coach (a separate column, not a team_members row) or org admins.
  team_roster_locked: {
    key: 'team_roster_locked',
    defaultAudience: () => { throw new Error('team_roster_locked requires an explicit audience'); },
    titleTemplate: () => 'Team roster locked',
    bodyTemplate: (data) => `${String(data.teamName ?? 'Your team')}'s roster is now locked in.`,
  },

  // Coach/Captain/Admin only, not the whole roster (a player waiting to be added
  // isn't who can fix this) - composed from real ids at the call site, since no
  // single Rule kind expresses "this team's coach + captains + this org's
  // admins" together.
  roster_incomplete: {
    key: 'roster_incomplete',
    defaultAudience: () => { throw new Error('roster_incomplete requires an explicit audience'); },
    titleTemplate: () => 'Team roster needs completion',
    bodyTemplate: (data) => `${String(data.teamName ?? 'Your team')} has ${String(data.count ?? '?')} of the ${String(data.squadMin ?? '?')} players required to lock its roster for ${String(data.disciplineName ?? 'this draw')}.`,
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
    // Discipline alone reads fine for one sport, but a championship running six of
    // them at once turned into a wall of identical "Fixtures for Men's are ready to
    // review" / "Fixtures for Whole sport are ready to review" rows with nothing
    // to tell them apart until you opened each one. The sport name is what
    // actually distinguishes them - same "sport · discipline" convention already
    // used everywhere else a draw is labelled (see drawLabel in FormatPicker.tsx).
    bodyTemplate: (data) => {
      const discipline = String(data.disciplineName ?? 'the draw');
      const sport = data.sportName ? String(data.sportName) : null;
      const label = sport ? `${sport} · ${discipline}` : discipline;
      return `Fixtures for ${label} are ready to review.`;
    },
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

  // Fires on the scorer's draft -> submitted handoff, distinct from
  // `result_submitted` (which fires later, on a *completed* result via
  // PATCH /fixtures/:id/result). This is the earlier "somebody needs to look at
  // this" signal in the scorecard state machine (draft -> submitted -> locked).
  score_pending_validation: {
    key: 'score_pending_validation',
    defaultAudience: (ctx) => {
      if (!ctx.championshipId) throw new Error('championshipId is required for score_pending_validation');
      return Rules.role('organiser', ctx.championshipId);
    },
    titleTemplate: () => 'A scorecard needs validation',
    bodyTemplate: (data) => `${String(data.label ?? 'A match')} has been submitted and is awaiting your review to lock it.`,
  },

  // The officiating assignment itself (PATCH /fixtures/:id/official). The
  // reassigned-away "no longer officiating" side of that same route stays on the
  // generic `manual` type - it isn't a named journey, just a courtesy heads-up.
  match_official_assigned: {
    key: 'match_official_assigned',
    defaultAudience: (ctx) => {
      if (!ctx.userId) throw new Error('userId is required for match_official_assigned');
      return Rules.directUser(ctx.userId);
    },
    titleTemplate: (data) => `You're officiating ${String(data.label ?? 'a match')}`,
    bodyTemplate: (data) => {
      const details = data.details ? String(data.details) : '';
      return `You've been assigned to score this match.${details ? ` ${details}` : ''} It's in your Officiating queue.`;
    },
  },

  team_qualifies: {
    key: 'team_qualifies',
    defaultAudience: () => { throw new Error('team_qualifies requires an explicit audience'); },
    titleTemplate: () => 'Your team has qualified',
    bodyTemplate: (data) => String(data.body ?? ''),
  },

  // Fired at lock time for a bracket fixture only (bracket_position != null) - a
  // league/pool loss doesn't eliminate anyone, only a knockout one does. Derived
  // from winner_team_id vs. home/away at the call site, not stored separately.
  team_eliminated: {
    key: 'team_eliminated',
    defaultAudience: () => { throw new Error('team_eliminated requires an explicit audience'); },
    titleTemplate: () => 'Your team has been eliminated',
    bodyTemplate: (data) => `${String(data.label ?? 'Your match')} - the result is now official.`,
  },

  // Fired from PATCH /fixtures/:id/awards - only for genuinely NEW awards, never
  // re-notifying for one already recorded in an earlier save (that route replaces
  // the whole award list every time it's called - see the call site).
  player_of_the_match: {
    key: 'player_of_the_match',
    defaultAudience: (ctx) => {
      if (!ctx.userId) throw new Error('userId is required for player_of_the_match');
      return Rules.directUser(ctx.userId);
    },
    titleTemplate: () => 'Player of the Match',
    bodyTemplate: (data) => `You were named Player of the Match for ${String(data.label ?? 'your match')}.`,
  },

  // Any award type other than Player of the Match (Player of the Tournament, MVP,
  // Top Scorer, Fair Play, Best Team, ...), plus untyped free-text awards - all
  // recorded through the same fixture_awards route, just tagged to a different (or
  // no) award_types catalog entry.
  tournament_award: {
    key: 'tournament_award',
    defaultAudience: (ctx) => {
      if (!ctx.userId) throw new Error('userId is required for tournament_award');
      return Rules.directUser(ctx.userId);
    },
    titleTemplate: (data) => String(data.awardName ?? 'Tournament award'),
    bodyTemplate: (data) => `You've received ${String(data.awardName ?? 'an award')}${data.label ? ` (${String(data.label)})` : ''}.`,
  },

  // Fired at the same lock-time hook as `team_eliminated`, but unconditionally
  // (every locked result recomputes standings) and to the whole championship
  // rather than just the two teams that played.
  standings_updated: {
    key: 'standings_updated',
    defaultAudience: (ctx) => {
      if (!ctx.championshipId) throw new Error('championshipId is required for standings_updated');
      return Rules.everyone(ctx.championshipId);
    },
    titleTemplate: () => 'Standings updated',
    bodyTemplate: (data) => `Standings have been updated after ${String(data.label ?? 'a match')}.`,
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

  // Direct confirmation to the applicant org itself. Distinct from
  // `enrollment_approved`, which broadcasts "X has joined" to everyone already in
  // the championship - that's news for the room, not a decision notice for the
  // applicant. Mirrors `registration_rejected`'s audience/shape.
  registration_approved: {
    key: 'registration_approved',
    defaultAudience: (ctx) => {
      if (!ctx.organizationId) throw new Error('organizationId is required for registration_approved');
      return Rules.orgAdmins(ctx.organizationId);
    },
    titleTemplate: () => 'Registration approved',
    bodyTemplate: (data) => `Your application to ${String(data.championshipName ?? 'the championship')} was approved. You can now enter squads.`,
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

  // ---- Organization: invites & campuses (Version 2, batch 1) --------------
  //
  // org_invite_sent / org_invite_accepted are deliberately NOT built yet. The PDF
  // names "invite sent -> User" as a trigger, but that delivery is structurally
  // impossible for the one case an org-member invite actually serves (a phone
  // number with no account yet - there is no inbox to land in at send time), and
  // the right resolution (what, if anything, reaches the invitee once they DO
  // sign up and the invite auto-applies) needs a team decision, not a guess.
  // Tracked as follow-up.

  // Not a PDF trigger, and deliberately NOT worded as an invite - an admin adding
  // an already-registered person via the member picker's checkbox+Add is instant
  // and has no consent step at all, unlike org_invite_sent/org_invite_accepted
  // above (which stay reserved for the real invite-and-wait flow, for someone with
  // no account yet). Calling this "invitation accepted" would claim a decision
  // that was never made by the person it happened to.
  org_member_added: {
    key: 'org_member_added',
    defaultAudience: (ctx) => {
      if (!ctx.userId) throw new Error('userId is required for org_member_added');
      return Rules.directUser(ctx.userId);
    },
    titleTemplate: () => "You've been added to an organization",
    bodyTemplate: (data) => `You are now a member of ${String(data.organizationName ?? 'an organization')}.`,
  },

  campus_created: {
    key: 'campus_created',
    defaultAudience: (ctx) => {
      if (!ctx.organizationId) throw new Error('organizationId is required for campus_created');
      return Rules.orgAdmins(ctx.organizationId);
    },
    titleTemplate: (data) => `A new ${String(data.unitLabel ?? 'campus').toLowerCase()} was added`,
    bodyTemplate: (data) => `${String(data.unitName ?? 'A new campus')} is now part of ${String(data.organizationName ?? 'your organization')}.`,
  },

  campus_admin_assigned: {
    key: 'campus_admin_assigned',
    defaultAudience: (ctx) => {
      if (!ctx.userId) throw new Error('userId is required for campus_admin_assigned');
      return Rules.directUser(ctx.userId);
    },
    titleTemplate: (data) => `You are now a ${String(data.unitLabel ?? 'campus').toLowerCase()} admin`,
    bodyTemplate: (data) => `You've been made admin of ${String(data.unitName ?? 'a campus')} at ${String(data.organizationName ?? 'your organization')}.`,
  },

  // Fired when an Annual Sports Impact Report job (POST /organizations/:id/reports/impact)
  // finishes - this is the only asynchronous, job-based "report generation" in the
  // codebase (report_jobs.kind is only ever 'impact'), so it's what "Event report
  // generated" maps onto: the requester is told instead of having to keep polling
  // GET /report-jobs/:jobId. Notifies on success only, not on a failed job.
  event_report_generated: {
    key: 'event_report_generated',
    defaultAudience: (ctx) => {
      if (!ctx.userId) throw new Error('userId is required for event_report_generated');
      return Rules.directUser(ctx.userId);
    },
    titleTemplate: () => 'Your report is ready',
    bodyTemplate: (data) => `The ${String(data.label ?? 'Impact')} report${data.seasonLabel ? ` for ${String(data.seasonLabel)}` : ''} is ready to view.`,
  },

  // Fired on POST /certificates/:certId/revoke - a recipient holding a document
  // that is no longer valid needs to know, same as the issuer's audit trail does.
  // Only fires when the certificate has a linked account (certificates.user_id is
  // nullable - some are issued to a recipient_name with no platform account).
  certificate_validation_issue: {
    key: 'certificate_validation_issue',
    defaultAudience: (ctx) => {
      if (!ctx.userId) throw new Error('userId is required for certificate_validation_issue');
      return Rules.directUser(ctx.userId);
    },
    titleTemplate: () => 'A certificate of yours has been withdrawn',
    bodyTemplate: (data) => {
      const title = data.title ? `"${String(data.title)}" ` : '';
      const serial = data.serial ? ` (${String(data.serial)})` : '';
      return `Your certificate ${title}${serial}was withdrawn: ${String(data.reason ?? 'no reason given')}.`;
    },
  },

  // Fired on POST /championships/:eventId/invitations, the "open championship,
  // invite another organisation" branch - the internal "invite our own campus"
  // branch fires contingent_added instead, since there is nobody outside the
  // host institution to tell. Addressed to the invited org's admins: the
  // invitation is addressed to the ORGANISATION (any of its admins may accept
  // it - see /invitations/:id/accept), not to one named person.
  championship_invitation_sent: {
    key: 'championship_invitation_sent',
    defaultAudience: (ctx) => {
      if (!ctx.organizationId) throw new Error('organizationId is required for championship_invitation_sent');
      return Rules.orgAdmins(ctx.organizationId);
    },
    titleTemplate: (data) => `You're invited to ${String(data.championshipName ?? 'a championship')}`,
    bodyTemplate: (data) => {
      const host = String(data.hostName ?? 'The organiser');
      const championshipName = String(data.championshipName ?? 'their championship');
      return `${host} has invited your organization to compete in ${championshipName}. Review it from your Invitations.`;
    },
  },

  // ---- Claims (J4-E5) ------------------------------------------------------
  //
  // Posted via createNotification() directly, not notify() - claims.routes.ts
  // already has its exact title/body in hand and there is no template to run.
  // Registered here anyway so `type` is checked against ONE list: a key that
  // exists only for createNotification() callers is still a key a typo can get
  // wrong, and this is what makes that a compile error instead of a runtime one.
  claim_submitted: {
    key: 'claim_submitted',
    defaultAudience: () => { throw new Error('claim_submitted is posted via createNotification(), not notify()'); },
    titleTemplate: () => 'An achievement claim needs review',
  },
  claim_approved: {
    key: 'claim_approved',
    defaultAudience: () => { throw new Error('claim_approved is posted via createNotification(), not notify()'); },
    titleTemplate: () => 'Your claim was validated',
  },
  claim_rejected: {
    key: 'claim_rejected',
    defaultAudience: () => { throw new Error('claim_rejected is posted via createNotification(), not notify()'); },
    titleTemplate: () => 'Your claim was not accepted',
  },
} satisfies Record<string, NotificationTypeDef>;

export type NotificationTypeKey = keyof typeof NOTIFICATION_TYPES;