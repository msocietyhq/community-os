import {
  AbilityBuilder,
  createMongoAbility,
  type ForcedSubject,
  type MongoAbility,
} from "@casl/ability";
import type { Role } from "./constants";

// Tagged interfaces for subjects that need ownership conditions.
// CASL uses __caslSubjectType__ to match instances to their subject type.
export interface MemberSubject extends ForcedSubject<"Member"> {
  userId: string;
}
export interface ProjectSubject extends ForcedSubject<"Project"> {
  ownerId: string;
}

export type Subjects =
  | "Event"
  | "Member"
  | MemberSubject
  | "Project"
  | ProjectSubject
  | "Infra"
  | "Venue"
  | "Fund"
  | "Reputation"
  | "Audit"
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
  | "manage_role";

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
    // Infra
    can("read", "Infra");
    can("provision", "Infra");
    // Funds
    can("read", "Fund");
    can("create", "Fund");
    can("update", "Fund");
    // Reputation & Audit
    can("read", "Reputation");
    can("create", "Reputation");
    can("read", "Audit");
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
    can("read", "Reputation");
    can("create", "Reputation");
  }

  return build();
}
