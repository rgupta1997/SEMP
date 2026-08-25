export type AudienceRole =
  | 'organiser'
  | 'official'
  | 'captain'
  | 'poc';

export type AudienceRule =
  | {
      kind: 'role';
      role: AudienceRole;
      championshipId: string;
    }
  | {
      kind: 'org_admins';
      organizationId: string;
    }
  | {
      kind: 'team_members';
      teamId: string;
    }
  | {
      kind: 'direct_user';
      userId: string;
    }
  | {
      kind: 'everyone';
      championshipId: string;
    }
  | {
      kind: 'compose';
      rules: AudienceRule[];
    };

export const Rules = {
  role: (role: AudienceRole, championshipId: string): AudienceRule => ({
    kind: 'role',
    role,
    championshipId,
  }),

  orgAdmins: (organizationId: string): AudienceRule => ({
    kind: 'org_admins',
    organizationId,
  }),

  teamMembers: (teamId: string): AudienceRule => ({
    kind: 'team_members',
    teamId,
  }),

  directUser: (userId: string): AudienceRule => ({
    kind: 'direct_user',
    userId,
  }),

  everyone: (championshipId: string): AudienceRule => ({
    kind: 'everyone',
    championshipId,
  }),

  compose: (rules: AudienceRule[]): AudienceRule => ({
    kind: 'compose',
    rules,
  }),
};    