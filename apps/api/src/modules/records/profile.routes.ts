import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { ConflictError, NotFoundError } from '../../shared/errors.js';

// The sports profile: identity, the controlled half, and the privacy choices.
//
// The verified half (lifetime entries, achievements, medals) is served by
// records.routes; this is everything a person can actually change about
// themselves, kept separate for a reason worth stating - a single endpoint that
// both read verified records and accepted edits would be one refactor away from
// letting an edit reach them.

const HANDLE = /^[a-z0-9][a-z0-9-]{2,38}[a-z0-9]$/;

const updateProfileSchema = z.object({
  tagline: z.string().max(160).nullable().optional(),
  preferred_sports: z.array(z.string().max(40)).max(12).optional(),
  // Lowercase, hyphenated, no leading or trailing hyphen. It becomes a public URL,
  // so it is validated on the way in rather than sanitised on the way out.
  handle: z.string().regex(HANDLE, 'Use 4-40 lowercase letters, numbers or hyphens').nullable().optional(),
});

const updatePrivacySchema = z.object({
  public_profile: z.boolean().optional(),
  public_stats: z.boolean().optional(),
  discoverable: z.boolean().optional(),
});

/**
 * Always true, and deliberately not stored.
 *
 * An institution has to be able to rely on the record it issued still being
 * visible to it. A column here would become a switch, and a switch would make
 * "verified record" mean "verified until inconvenient".
 */
export const VERIFIED_RECORDS_VISIBLE = true as const;

export function makeProfileRouter(prisma: Prisma): Router {
  const router = Router();

  async function identity(userId: string) {
    const [user, privacy] = await Promise.all([
      prisma.users.findUnique({
        where: { id: userId },
        select: {
          id: true, name: true, email: true, phone: true, avatar_url: true,
          sportagon_id: true, handle: true, tagline: true, preferred_sports: true,
          officiates: true, email_verified_at: true, phone_verified_at: true,
        },
      }),
      prisma.profile_privacy.findUnique({ where: { user_id: userId } }),
    ]);
    if (!user) throw new NotFoundError('Person');

    return {
      // ---- identity: issued once, never editable ----
      id: user.id,
      sportagon_id: user.sportagon_id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      email_verified: user.email_verified_at != null,
      phone_verified: user.phone_verified_at != null,
      officiates: user.officiates,

      // ---- controlled: theirs to change ----
      controlled: {
        handle: user.handle,
        tagline: user.tagline,
        preferred_sports: user.preferred_sports,
        avatar_url: user.avatar_url,
      },

      // ---- privacy ----
      privacy: {
        public_profile: privacy?.public_profile ?? false,
        public_stats: privacy?.public_stats ?? false,
        discoverable: privacy?.discoverable ?? true,
        // Sent so the screen can render it as a value row rather than a switch.
        verified_records_visible: VERIFIED_RECORDS_VISIBLE,
      },

      // The public URL, only once there is a handle AND the profile is public -
      // showing a link that 404s is worse than showing none.
      public_url: privacy?.public_profile && user.handle ? `/p/${user.handle}` : null,
    };
  }

  router.get('/me/identity', asyncHandler(async (req, res) => {
    res.json(await identity(req.user!.id));
  }));

  router.patch('/me/identity', validateBody(updateProfileSchema), asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof updateProfileSchema>;

    if (body.handle) {
      // Case-insensitive, because the handle is a URL and URLs are not.
      const taken = await prisma.users.findFirst({
        where: { handle: { equals: body.handle, mode: 'insensitive' }, id: { not: req.user!.id } },
        select: { id: true },
      });
      if (taken) throw new ConflictError('That handle is already taken');
    }

    await prisma.users.update({
      where: { id: req.user!.id },
      data: {
        ...(body.tagline !== undefined ? { tagline: body.tagline } : {}),
        ...(body.preferred_sports !== undefined ? { preferred_sports: body.preferred_sports } : {}),
        ...(body.handle !== undefined ? { handle: body.handle } : {}),
      },
    });
    res.json(await identity(req.user!.id));
  }));

  router.patch('/me/privacy', validateBody(updatePrivacySchema), asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof updatePrivacySchema>;

    // Publishing without a handle would produce a profile at no address, so the
    // API refuses rather than silently minting one - a handle is a name somebody
    // will see, and picking it for them is a poor first impression.
    if (body.public_profile) {
      const me = await prisma.users.findUnique({ where: { id: req.user!.id }, select: { handle: true } });
      if (!me?.handle) throw new ConflictError('Choose a profile handle before making your profile public');
    }

    await prisma.profile_privacy.upsert({
      where: { user_id: req.user!.id },
      update: { ...body, updated_at: new Date() },
      create: { user_id: req.user!.id, ...body },
    });
    res.json(await identity(req.user!.id));
  }));

  return router;
}
