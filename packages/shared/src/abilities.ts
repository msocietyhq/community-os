import {
  AbilityBuilder,
  createMongoAbility,
  type ForcedSubject,
  type MongoAbility,
} from "@casl/ability";
import type { ProjectMemberRole, Role } from "./constants";

// Tagged interfaces for subjects that need ownership conditions.
// CASL uses __caslSubjectType__ to match instances to their subject type.
export interface MemberSubject extends ForcedSubject<"Member"> {
  userId: string;
}
export interface ProjectSubject extends ForcedSubject<"Project"> {
  ownerId: string;
}
/**
 * `projectRole` is the caller's own project_members.role for the environment's
 * project ("none" if they aren't a member at all) — resolved per-request from
 * the DB, since project roles aren't part of the global ability. `ownerId` is
 * the environment's own owner, so a caller can always manage their own.
 */
export interface DevEnvironmentSubject extends ForcedSubject<"DevEnvironment"> {
  ownerId: string;
  projectRole: ProjectMemberRole | "none";
}
export interface SharedSecretSubject extends ForcedSubject<"SharedSecret"> {
  projectRole: ProjectMemberRole | "none";
}

export type Subjects =
  | "Event"
  | "Member"
  | MemberSubject
  | "Project"
  | ProjectSubject
  | "Infra"
  | "DevEnvironment"
  | DevEnvironmentSubject
  | "SharedSecret"
  | SharedSecretSubject
  | "Venue"
  | "Dataset"
  | "Fund"
  | "Reputation"
  | "Audit"
  | "Settings"
  | "all";

export type Actions =
  | "manage"
  | "create"
  | "read"
  | "update"
  | "delete"
  | "rsvp"
  | "check_in"
  | "endorse"
  | "provision"
  | "deprovision"
  | "ban"
  | "manage_role"
  | "revoke"
  | "issue";

export type AppAbility = MongoAbility<[Actions, Subjects]>;

export function defineAbilityFor(user: { id: string; role: Role }) {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

  // superadmin — full access
  if (user.role === "superadmin") {
    can("manage", "all");
    return build();
  }

  // admin — explicit rules, no ownership conditions
  if (user.role === "admin") {
    // Events
    can("read", "Event");
    can("create", "Event");
    can("update", "Event");
    can("delete", "Event");
    can("rsvp", "Event");
    can("check_in", "Event");
    // Members
    can("read", "Member");
    can("update", "Member");
    can("ban", "Member");
    // Projects
    can("read", "Project");
    can("create", "Project");
    can("update", "Project");
    can("delete", "Project");
    can("endorse", "Project");
    // Venues
    can("read", "Venue");
    can("create", "Venue");
    can("update", "Venue");
    can("delete", "Venue");
    // Datasets
    can("read", "Dataset");
    can("create", "Dataset");
    can("update", "Dataset");
    can("delete", "Dataset");
    // Infra
    can("read", "Infra");
    can("provision", "Infra");
    // Dev environments & shared secrets — full control of any project's
    can("manage", "DevEnvironment");
    can("manage", "SharedSecret");
    // Funds
    can("read", "Fund");
    can("create", "Fund");
    can("update", "Fund");
    // Reputation & Audit
    can("read", "Reputation");
    can("create", "Reputation");
    can("read", "Audit");
    // Bot settings
    can("read", "Settings");
    can("update", "Settings");
  }

  // member — ownership-conditioned where applicable
  if (user.role === "member") {
    can("read", "Event");
    can("rsvp", "Event");
    can("read", "Member");
    can("update", "Member", { userId: user.id });
    can("read", "Project");
    can("create", "Project");
    can("update", "Project", { ownerId: user.id });
    can("delete", "Project", { ownerId: user.id });
    can("read", "Venue");
    can("read", "Dataset");
    can("read", "Reputation");
    can("create", "Reputation");
    // Any project member can create their own dev environment; managing it
    // (reveal, store vars, issue/revoke agent keys, revoke the environment)
    // is scoped to its owner. Maintainers/owners of the project additionally
    // manage every environment in it and the project's shared secrets.
    can("create", "DevEnvironment", {
      projectRole: { $in: ["owner", "maintainer", "contributor"] },
    });
    can("manage", "DevEnvironment", { ownerId: user.id });
    can("manage", "DevEnvironment", {
      projectRole: { $in: ["owner", "maintainer"] },
    });
    can("read", "SharedSecret", { projectRole: { $ne: "none" } });
    can("manage", "SharedSecret", {
      projectRole: { $in: ["owner", "maintainer"] },
    });
  }

  return build();
}
