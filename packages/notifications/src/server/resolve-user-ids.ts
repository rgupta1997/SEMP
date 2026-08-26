import type { AudienceRule } from '../core/rules.js';
import { ROLE_CODES, roleWhereByCode, type RoleWhere } from '@semp/shared';

export interface NotificationPrisma {
    user_championship_roles: {
        findMany(args: {
            where: {
                championship_id: string;
                role_id: {
                    in: string[];
                };
            };
            select: {
                user_id: true;
            };
        }): Promise<Array<{ user_id: string }>>;
    };

    championship_officials: {
        findMany(args: {
            where: {
                championship_id: string;
                is_active: true;
            };
            select: {
                user_id: true;
            };
        }): Promise<Array<{ user_id: string }>>;
    };

    championship_organizations: {
        findMany(args: {
            where: {
                championship_id: string;
            };
            select: {
                organization_id: true;
            };
        }): Promise<Array<{ organization_id: string }>>;
    };

    organization_members: {
        findMany(args: {
            where: {
                organization_id: string | { in: string[] };
                role: {
                    in: string[];
                } | string;
                status: string;
            };
            select: {
                user_id: true;
            };
        }): Promise<Array<{ user_id: string }>>;
    };

    team_members: {
        findMany(args: {
            where: {
                team_id?: string | { in: string[] };
                is_active: true;
                role?: { in: string[] };
            };
            select: {
                user_id: true;
            };
        }): Promise<Array<{ user_id: string }>>;
    };

    // Resolved by stable code, not display name - and therefore findFirst, not
    // findUnique: roles are org-scoped now, so `name` is no longer a unique key
    // and the platform row has to be selected explicitly. See @semp/shared
    // role-codes for why.
    roles: {
        findFirst(args: {
            where: RoleWhere;
            select: {
                id: true;
            };
        }): Promise<{ id: string } | null>;
    };

    team_entries: {
        findMany(args: {
            where: {
                championship_id: string;
            };
            select: {
                team_id: true;
            };
        }): Promise<Array<{ team_id: string }>>;
    };
}

export async function resolveUserIds(
    prisma: NotificationPrisma,
    rule: AudienceRule,
): Promise<Set<string>> {
    switch (rule.kind) {
        case 'direct_user': {
            return new Set([rule.userId]);
        }

        case 'org_admins': {
            const rows = await prisma.organization_members.findMany({
                where: {
                    organization_id: rule.organizationId,
                    role: { in: ['owner', 'admin'] },
                    status: 'active',
                },
                select: {
                    user_id: true,
                },
            });

            return new Set(
                rows.map((row) => row.user_id),
            );
        }

        case 'team_members': {
            const rows = await prisma.team_members.findMany({
                where: {
                    team_id: rule.teamId,
                    is_active: true,
                },
                select: {
                    user_id: true,
                },
            });

            return new Set(
                rows.map((row) => row.user_id),
            );
        }

        case 'role': {
            // Officials are stored separately from user_championship_roles.
            if (rule.role === 'official') {
                const rows =
                    await prisma.championship_officials.findMany({
                        where: {
                            championship_id:
                                rule.championshipId,
                            is_active: true,
                        },
                        select: {
                            user_id: true,
                        },
                    });

                return new Set(
                    rows.map((row) => row.user_id),
                );
            }

            // POC is NOT a row in the roles table.
            //
            // In the real application, the POC is the owner of
            // an organization. If that organization is enrolled
            // in this championship, its owner is the POC for
            // this championship.
            if (rule.role === 'poc') {
                const championshipOrganizations =
                    await prisma.championship_organizations.findMany({
                        where: {
                            championship_id:
                                rule.championshipId,
                        },
                        select: {
                            organization_id: true,
                        },
                    });

                const organizationIds =
                    championshipOrganizations.map(
                        (row) => row.organization_id,
                    );

                if (organizationIds.length === 0) {
                    return new Set();
                }

                const owners =
                    await prisma.organization_members.findMany({
                        where: {
                            organization_id: {
                                in: organizationIds,
                            },
                            role: 'owner',
                            status: 'active',
                        },
                        select: {
                            user_id: true,
                        },
                    });

                return new Set(
                    owners.map((row) => row.user_id),
                );
            }

            // Captains are team memberships, not championship-role rows.
            if (rule.role === 'captain') {
                const entries = await prisma.team_entries.findMany({
                    where: { championship_id: rule.championshipId },
                    select: { team_id: true },
                });

                const teamIds = entries.map((entry) => entry.team_id);

                if (teamIds.length === 0) {
                    return new Set();
                }

                const captains = await prisma.team_members.findMany({
                    where: {
                        team_id: { in: teamIds },
                        is_active: true,
                        role: { in: ['captain', 'vice_captain'] },
                    },
                    select: { user_id: true },
                });

                return new Set(captains.map((row) => row.user_id));
            }

            // Organisers continue to use the championship role system.
            const role = await prisma.roles.findFirst({
                where: roleWhereByCode(ROLE_CODES[rule.role]),
                select: {
                    id: true,
                },
            });

            if (!role) {
                return new Set();
            }

            const rows =
                await prisma.user_championship_roles.findMany({
                    where: {
                        championship_id:
                            rule.championshipId,
                        role_id: {
                            in: [role.id],
                        },
                    },
                    select: {
                        user_id: true,
                    },
                });

            return new Set(
                rows.map((row) => row.user_id),
            );
        }

        case 'everyone': {
            const result = new Set<string>();

            // Organisers
            const organiserRole =
                await prisma.roles.findFirst({
                    where: roleWhereByCode(ROLE_CODES.organiser),
                    select: {
                        id: true,
                    },
                });

            if (organiserRole) {
                const organisers =
                    await prisma.user_championship_roles.findMany({
                        where: {
                            championship_id:
                                rule.championshipId,
                            role_id: {
                                in: [organiserRole.id],
                            },
                        },
                        select: {
                            user_id: true,
                        },
                    });

                for (const row of organisers) {
                    result.add(row.user_id);
                }
            }

            // Officials
            const officials =
                await prisma.championship_officials.findMany({
                    where: {
                        championship_id:
                            rule.championshipId,
                        is_active: true,
                    },
                    select: {
                        user_id: true,
                    },
                });

            for (const row of officials) {
                result.add(row.user_id);
            }

            // Participants / captains
            const entries =
                await prisma.team_entries.findMany({
                    where: {
                        championship_id:
                            rule.championshipId,
                    },
                    select: {
                        team_id: true,
                    },
                });

            const teamIds = entries.map(
                (entry) => entry.team_id,
            );

            if (teamIds.length > 0) {
                const members =
                    await prisma.team_members.findMany({
                        where: {
                            team_id: {
                                in: teamIds,
                            },
                            is_active: true,
                        },
                        select: {
                            user_id: true,
                        },
                    });

                for (const member of members) {
                    result.add(member.user_id);
                }
            }

            // POCs
            //
            // POC = organization owner in the real application.
            //
            // Find all organizations enrolled in this
            // championship, then find their active owners.
            const championshipOrganizations =
                await prisma.championship_organizations.findMany({
                    where: {
                        championship_id:
                            rule.championshipId,
                    },
                    select: {
                        organization_id: true,
                    },
                });

            const organizationIds =
                championshipOrganizations.map(
                    (row) => row.organization_id,
                );

            if (organizationIds.length > 0) {
                const owners =
                    await prisma.organization_members.findMany({
                        where: {
                            organization_id: {
                                in: organizationIds,
                            },
                            role: 'owner',
                            status: 'active',
                        },
                        select: {
                            user_id: true,
                        },
                    });

                for (const row of owners) {
                    result.add(row.user_id);
                }
            }

            return result;
        }

        case 'compose': {
            const result = new Set<string>();

            for (const childRule of rule.rules) {
                const ids = await resolveUserIds(
                    prisma,
                    childRule,
                );

                for (const id of ids) {
                    result.add(id);
                }
            }

            return result;
        }
    }
}
