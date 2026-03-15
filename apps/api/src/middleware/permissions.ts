import type {
  Actions,
  Subjects,
  AppAbility,
  MemberSubject,
  ProjectSubject,
} from "@community-os/shared";

/**
 * Route-level permission guard. Checks if the user's ability allows
 * the given action on the given subject type (no instance/ownership check).
 *
 * Usage: `beforeHandle: checkPermission("create", "Event")`
 */
export function checkPermission(
  action: Actions,
  subjectType: Subjects & string,
) {
  return ({
    ability,
    status,
  }: {
    ability: AppAbility;
    status: (code: number, body: unknown) => unknown;
  }) => {
    if (ability.cannot(action, subjectType)) {
      return status(403, {
        error: {
          code: "FORBIDDEN",
          message: `Insufficient permissions: cannot ${action} ${subjectType}`,
        },
      });
    }
  };
}

// Union of subject interfaces that carry ownership fields
type SubjectInstance = MemberSubject | ProjectSubject;

/**
 * Instance-level permission guard with ownership check. Fetches the resource
 * via `getResource`, then checks CASL conditions against the resource fields.
 *
 * The `getResource` callback must return a tagged subject instance (with
 * `__caslSubjectType__` set) so CASL can evaluate ownership conditions.
 *
 * Usage:
 * ```ts
 * beforeHandle: checkPermissionOn("update", async (ctx) => ({
 *   __caslSubjectType__: "Member",
 *   userId: ctx.user.id,
 * }))
 * ```
 */
export function checkPermissionOn<S extends SubjectInstance>(
  action: Actions,
  getResource: (ctx: {
    ability: AppAbility;
    status: (code: number, body: unknown) => unknown;
    user: { id: string };
    params: Record<string, string>;
  }) => Promise<S | null>,
) {
  return async (ctx: {
    ability: AppAbility;
    status: (code: number, body: unknown) => unknown;
    user: { id: string };
    params: Record<string, string>;
  }) => {
    const resource = await getResource(ctx);
    if (!resource) {
      return ctx.status(404, {
        error: { code: "NOT_FOUND", message: "Resource not found" },
      });
    }
    if (ctx.ability.cannot(action, resource)) {
      return ctx.status(403, {
        error: {
          code: "FORBIDDEN",
          message: `Insufficient permissions: cannot ${action} this ${resource.__caslSubjectType__}`,
        },
      });
    }
  };
}
