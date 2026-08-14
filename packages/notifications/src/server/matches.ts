import type { AudienceRule } from '../core/rules.js'
import type { EventScopes } from './scopes.js';;



export function matches(
    scopes: EventScopes,
    rule: AudienceRule,
): boolean {
    if (scopes.isSuper) return true;

    switch (rule.kind) {
        case 'role':
            switch (rule.role) {
                case 'organiser':
                    return scopes.organiserEventIds.has(rule.championshipId);

                case 'official':
                    return scopes.officialEventIds.has(rule.championshipId);

                case 'captain':
                    return scopes.captainEventIds.has(rule.championshipId);

                case 'poc':
                    return scopes.pocEventIds.has(rule.championshipId);
            }

        case 'org_admins':
            return scopes.adminOrgIds.has(rule.organizationId);

        case 'team_members':
            return scopes.teamIds.has(rule.teamId);
        case 'direct_user':
            return scopes.userId === rule.userId;

        case 'everyone':
            return scopes.allRelatedEventIds.has(rule.championshipId);

        case 'compose':
            return rule.rules.some((childRule) => matches(scopes, childRule));
    }
}