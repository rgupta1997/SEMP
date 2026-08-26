import type { RequestHandler } from 'express';
import {
  assertCapability,
  CapabilityRequiredError,
  entitlementSnapshot,
  type EntitlementsPrisma,
} from '@semp/entitlements/server';
import type { CapabilityKey } from '@semp/entitlements';
import { DomainError, UnauthorizedError } from '../../shared/errors.js';

// The subscription gate. Distinct from the permission gate next door, and the
// two answer different questions:
//
//   permissions  - is this person allowed to do it?
//   entitlements - has this tenant paid for it to exist at all?
//
// Both can refuse. A Sports Admin with verify_players still cannot reach
// Campuses & Units on a Pro org, because the capability is not there to permit.

/** DomainError wrapper so the central error handler renders it like everything else. */
export class CapabilityError extends DomainError {
  constructor(err: CapabilityRequiredError) {
    // `capability` travels to the client so the locked surface can name what is
    // missing. The tier is deliberately absent - see the note in the registry.
    super('CAPABILITY_REQUIRED', err.message, 403, {
      capability: err.capability,
      ladder: err.ladder,
    });
  }
}

export interface CapabilityGuardOptions {
  /**
   * Super admins bypass the gate by default, matching the permission guards.
   *
   * The reasoning: super admin is Sportagon staff, and the platform console
   * operates across every tenant regardless of what that tenant bought - gating
   * it on the customer's plan would break support.
   *
   * Pass `false` on any route where the real gate must be exercised, which
   * includes anything used to demo or test tier behaviour: a super admin who
   * silently bypasses makes a broken gate look like a working one.
   */
  allowSuperAdmin?: boolean;
  /**
   * Where to read the organisation from, when it is not the caller's own.
   * Org capabilities are a property of the tenant being acted on, so a route
   * operating on `:organizationId` must gate on that org, not on the caller's.
   */
  organizationIdFrom?: (req: Parameters<RequestHandler>[0]) => string | null | undefined;
}

export function makeEntitlementGuards(prisma: EntitlementsPrisma) {
  /** Refuses with 403 CAPABILITY_REQUIRED unless the capability is granted. */
  function requireCapability(
    capability: CapabilityKey,
    options: CapabilityGuardOptions = {},
  ): RequestHandler {
    const { allowSuperAdmin = true, organizationIdFrom } = options;

    const guard: RequestHandler = (req, _res, next) => {
      const user = req.user;
      if (!user) return next(new UnauthorizedError());
      if (allowSuperAdmin && user.isSuperAdmin) return next();

      const organizationId = organizationIdFrom
        ? organizationIdFrom(req) ?? null
        : user.organizationId;

      assertCapability(prisma, capability, { userId: user.id, organizationId })
        .then(() => next())
        .catch((err: unknown) =>
          next(err instanceof CapabilityRequiredError ? new CapabilityError(err) : err),
        );
    };

    // Express copies a handler's function name onto the layer, which is the only
    // way to tell a mounted gate apart from the router it stands in front of.
    // Naming it makes "is this surface gated?" an answerable question - see
    // entitlement-mounts.test.ts, which exists because it once was not.
    Object.defineProperty(guard, 'name', { value: `capability:${capability}` });
    return guard;
  }

  /**
   * Everything the caller is entitled to, on both ladders. The client renders
   * every lock from this one payload rather than asking per capability.
   */
  const readSnapshot: RequestHandler = (req, res, next) => {
    const user = req.user;
    if (!user) return next(new UnauthorizedError());

    entitlementSnapshot(prisma, { userId: user.id, organizationId: user.organizationId })
      .then((snapshot) => res.json(snapshot))
      .catch(next);
  };

  return { requireCapability, readSnapshot };
}
