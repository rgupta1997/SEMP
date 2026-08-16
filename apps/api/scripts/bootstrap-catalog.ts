/**
 * Bootstraps the global master catalog required by the application.
 *
 * The demo seed (`seed-iimb.ts`) assumes that global catalog data
 * (sports, tournament formats, roles, disciplines, etc.) already exists.
 *
 * This script is safe to run multiple times:
 * - Existing records are skipped.
 * - Missing records are inserted.
 *
 * Run before:
 *   npx tsx scripts/bootstrap-catalog.ts
 *   npx tsx scripts/seed-iimb.ts
 */

import { PrismaClient } from "@prisma/client";
import { DISCIPLINES } from './discipline';
import { PERMISSIONS } from '@semp/shared';

const prisma = new PrismaClient();

const SPORTS = [
    { name: "Archery", icon: "🏹" },
    { name: "Arm Wrestling", icon: "💪" },
    { name: "Athletics", icon: "🏃" },
    { name: "Badminton", icon: "🏸" },
    { name: "Basketball", icon: "🏀" },
    { name: "Box Cricket", icon: "🏏" },
    { name: "Boxing", icon: "🥊" },
    { name: "Carrom", icon: "🎱" },
    { name: "Chess", icon: "♟️" },
    { name: "Cricket", icon: "🏏" },
    { name: "Cycling", icon: "🚴" },
    { name: "Fencing", icon: "⚔️" },
    { name: "Football", icon: "⚽" },
    { name: "Frisbee", icon: "🥏" },
    { name: "Futsal", icon: "⚽" },
    { name: "Gymnastics", icon: "🤸" },
    { name: "Handball", icon: "🤾" },
    { name: "Hockey", icon: "🏑" },
    { name: "Judo", icon: "🥋" },
    { name: "Kabaddi", icon: "🤼" },
    { name: "Kho-Kho", icon: "🏃" },
    { name: "Pool/Snooker", icon: "🎱" },
    { name: "Powerlifting", icon: "💪" },
    { name: "Rowing", icon: "🚣" },
    { name: "Shooting", icon: "🎯" },
    { name: "Squash", icon: "🎾" },
    { name: "Swimming", icon: "🏊" },
    { name: "Table Tennis", icon: "🏓" },
    { name: "Taekwondo", icon: "🥋" },
    { name: "Tennis", icon: "🎾" },
    { name: "Throwball", icon: "🏐" },
    { name: "Tug of War", icon: "🪢" },
    { name: "Volleyball", icon: "🏐" },
    { name: "Weightlifting", icon: "🏋️" },
    { name: "Wrestling", icon: "🤼" },
    { name: "Yoga", icon: "🧘" },
];

const ROLES = [
    {
        name: "Organiser",
        description: "Manages a championship",
    },
];

const TOURNAMENT_FORMATS = [
    {
        name: "Knockout",
        description: "Single elimination tournament",
    },
    {
        name: "League",
        description: "Round-robin league tournament",
    },
];

async function bootstrapSports() {
    console.log("\n🏅 Bootstrapping sports...\n");

    const existingSports = await prisma.sports.findMany({
        select: {
            name: true,
        },
    });

    const existingSportNames = new Set(
        existingSports.map((sport) => sport.name)
    );

    const missingSports = SPORTS.filter(
        (sport) => !existingSportNames.has(sport.name)
    );

    if (missingSports.length > 0) {
        await prisma.sports.createMany({
            data: missingSports,
        });

        missingSports.forEach((sport) =>
            console.log(`✓ Inserted ${sport.name}`)
        );
    }

    SPORTS
        .filter((sport) => existingSportNames.has(sport.name))
        .forEach((sport) =>
            console.log(`• Skipped ${sport.name}`)
        );

    console.log(
        `\nSports: Inserted ${missingSports.length}, Skipped ${SPORTS.length - missingSports.length
        }\n`
    );
}

async function bootstrapTournamentFormats() {
    console.log("\n🏆 Bootstrapping tournament formats...\n");

    const existingFormats = await prisma.tournament_formats.findMany({
        select: {
            name: true,
        },
    });

    const existingFormatNames = new Set(
        existingFormats.map((format) => format.name)
    );

    const missingFormats = TOURNAMENT_FORMATS.filter(
        (format) => !existingFormatNames.has(format.name)
    );

    if (missingFormats.length > 0) {
        await prisma.tournament_formats.createMany({
            data: missingFormats,
        });

        missingFormats.forEach((format) =>
            console.log(`✓ Inserted ${format.name}`)
        );
    }

    TOURNAMENT_FORMATS
        .filter((format) => existingFormatNames.has(format.name))
        .forEach((format) =>
            console.log(`• Skipped ${format.name}`)
        );

    console.log(
        `\nFormats: Inserted ${missingFormats.length}, Skipped ${TOURNAMENT_FORMATS.length - missingFormats.length
        }\n`
    );
}

async function bootstrapDisciplines() {
    console.log("\n🥋 Bootstrapping disciplines...\n");

    // Get all sports so we can map sport name -> sport_id
    const sports = await prisma.sports.findMany({
        select: {
            id: true,
            name: true,
        },
    });

    const sportIdMap = new Map(
        sports.map((sport) => [sport.name, sport.id])
    );

    // Get existing disciplines
    const existingDisciplines = await prisma.disciplines.findMany({
        select: {
            sport_id: true,
            name: true,
        },
    });

    // sport_id:name
    const existingDisciplineKeys = new Set(
        existingDisciplines.map(
            (discipline) => `${discipline.sport_id}:${discipline.name}`
        )
    );

    // Convert DISCIPLINES to DB shape
    const disciplinesToInsert = DISCIPLINES.map((discipline) => {
        const sportId = sportIdMap.get(discipline.sport);

        if (!sportId) {
            throw new Error(`Sport not found: ${discipline.sport}`);
        }

        return {
            sport: discipline.sport,
            sport_id: sportId,
            name: discipline.name,
            description: discipline.description,
            entry_type: discipline.entry_type,
            squad_min: discipline.squad_min,
            squad_max: discipline.squad_max,
        };
    });

    const missingDisciplines = disciplinesToInsert.filter(
        (discipline) =>
            !existingDisciplineKeys.has(
                `${discipline.sport_id}:${discipline.name}`
            )
    );

    if (missingDisciplines.length > 0) {
        await prisma.disciplines.createMany({
            data: missingDisciplines.map(({ sport, ...discipline }) => discipline),
        });

        missingDisciplines.forEach((discipline) =>
            console.log(`✓ Inserted ${discipline.name}`)
        );
    }

    disciplinesToInsert
        .filter((discipline) =>
            existingDisciplineKeys.has(
                `${discipline.sport_id}:${discipline.name}`
            )
        )
        .forEach((discipline) =>
            console.log(`• Skipped ${discipline.sport} / ${discipline.name}`)
        );

    console.log(
        `\nDisciplines: Inserted ${missingDisciplines.length}, Skipped ${disciplinesToInsert.length - missingDisciplines.length
        }\n`
    );
}

async function bootstrapRoles() {
    console.log("\n👤 Bootstrapping roles...\n");

    const existingRoles = await prisma.roles.findMany({
        select: {
            name: true,
        },
    });

    const existingRoleNames = new Set(
        existingRoles.map((role) => role.name)
    );

    const missingRoles = ROLES.filter(
        (role) => !existingRoleNames.has(role.name)
    );

    if (missingRoles.length > 0) {
        await prisma.roles.createMany({
            data: missingRoles,
        });

        missingRoles.forEach((role) =>
            console.log(`✓ Inserted ${role.name}`)
        );
    }

    ROLES
        .filter((role) => existingRoleNames.has(role.name))
        .forEach((role) =>
            console.log(`• Skipped ${role.name}`)
        );

    console.log(
        `\nRoles: Inserted ${missingRoles.length}, Skipped ${ROLES.length - missingRoles.length
        }\n`
    );
}

async function bootstrap() {
    console.log("==================================");
    console.log("Bootstrapping Global Catalog");
    console.log("==================================");

    await bootstrapSports();
    await bootstrapTournamentFormats();
    await bootstrapDisciplines();
    await bootstrapRoles();
    await syncPermissions();

    console.log("==================================");
    console.log("Global catalog bootstrap completed.");
    console.log("==================================");
}

// The permission catalogue is code-owned (packages/shared/src/permissions.ts); this
// mirrors it into the `permissions` table so the roles matrix and future reports can
// join against real rows. Additive on purpose: a code removed from the catalogue is
// left in place rather than deleted, because a role may still reference it and
// silently dropping a grant is worse than carrying a stale row.
async function syncPermissions() {
    let created = 0;
    for (const [code, def] of Object.entries(PERMISSIONS)) {
        const existing = await prisma.permissions.findFirst({ where: { code }, select: { id: true } });
        if (existing) {
            await prisma.permissions.update({
                where: { id: existing.id },
                data: { label: def.label, scope: def.scope, area: def.area },
            });
        } else {
            await prisma.permissions.create({
                data: { code, label: def.label, scope: def.scope, area: def.area },
            });
            created += 1;
        }
    }
    console.log(`Permissions: ${created} created, ${Object.keys(PERMISSIONS).length - created} updated`);
}

bootstrap()
    .catch((error) => {
        console.error("\nBootstrap failed:");
        console.error(error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });