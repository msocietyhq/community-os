export const ROLES = ["member", "admin", "superadmin"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export const ROLE_HIERARCHY: Record<Role, number> = {
  member: 0,
  admin: 1,
  superadmin: 2,
};

// NOTE: CASL abilities (see abilities.ts) are the runtime source of truth for
// authorization. This map is kept as documentation and for reference.
export const PERMISSIONS = {
  // Members
  "members:read": ["member", "admin", "superadmin"],
  "members:update_own": ["member", "admin", "superadmin"],
  "members:update_any": ["admin", "superadmin"],
  "members:delete": ["superadmin"],

  // Events
  "events:read": ["member", "admin", "superadmin"],
  "events:create": ["admin", "superadmin"],
  "events:update": ["admin", "superadmin"],
  "events:delete": ["admin", "superadmin"],
  "events:rsvp": ["member", "admin", "superadmin"],
  "events:check_in": ["admin", "superadmin"],

  // Projects
  "projects:read": ["member", "admin", "superadmin"],
  "projects:create": ["member", "admin", "superadmin"],
  "projects:update_own": ["member", "admin", "superadmin"],
  "projects:update_any": ["admin", "superadmin"],
  "projects:delete": ["admin", "superadmin"],
  "projects:endorse": ["admin", "superadmin"],

  // Infrastructure
  "infra:read": ["admin", "superadmin"],
  "infra:provision": ["admin", "superadmin"],
  "infra:deprovision": ["superadmin"],

  // Funds
  "funds:read": ["admin", "superadmin"],
  "funds:create": ["admin", "superadmin"],
  "funds:update": ["admin", "superadmin"],
  "funds:delete": ["superadmin"],

  // Reputation
  "reputation:read": ["member", "admin", "superadmin"],
  "reputation:create": ["member", "admin", "superadmin"],

  // Audit
  "audit:read": ["admin", "superadmin"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export const EVENT_TYPES = [
  "meetup",
  "workshop",
  "hackathon",
  "talk",
  "social",
  "other",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_STATUSES = [
  "draft",
  "published",
  "cancelled",
  "completed",
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const RSVP_STATUSES = ["going", "maybe", "not_going"] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];

export const PLEDGE_STATUSES = ["pledged", "fulfilled", "cancelled"] as const;
export type PledgeStatus = (typeof PLEDGE_STATUSES)[number];

export const PROJECT_NATURES = [
  "startup",
  "community",
  "side_project",
] as const;
export type ProjectNature = (typeof PROJECT_NATURES)[number];

export const PROJECT_PLATFORMS = [
  "web_app",
  "mobile_app",
  "mobile_game",
  "telegram_bot",
  "library",
  "other",
] as const;
export type ProjectPlatform = (typeof PROJECT_PLATFORMS)[number];

export const PROJECT_STATUSES = ["active", "paused", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_MEMBER_ROLES = ["owner", "contributor"] as const;
export type ProjectMemberRole = (typeof PROJECT_MEMBER_ROLES)[number];

export const RESOURCE_STATUSES = [
  "provisioning",
  "active",
  "suspended",
  "deprovisioned",
] as const;
export type ResourceStatus = (typeof RESOURCE_STATUSES)[number];

export const SUBDOMAIN_STATUSES = [
  "pending_dns",
  "active",
  "suspended",
  "deleted",
] as const;
export type SubdomainStatus = (typeof SUBDOMAIN_STATUSES)[number];

export const FUND_TRANSACTION_TYPES = [
  "expense",
  "reimbursement",
  "pledge_collection",
  "adjustment",
] as const;
export type FundTransactionType = (typeof FUND_TRANSACTION_TYPES)[number];

export const REPUTATION_TRIGGER_TYPES = ["reaction", "keyword"] as const;
export type ReputationTriggerType = (typeof REPUTATION_TRIGGER_TYPES)[number];

export const AUDIT_ACTIONS = [
  "create",
  "update",
  "delete",
  "provision",
  "deprovision",
  "approve",
  "reject",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ENTITY_TYPES = [
  "event",
  "project",
  "infra",
  "fund",
  "member",
  "subdomain",
] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

export const VOTE_QUOTA = 5;
export const VOTE_QUOTA_DURATION_HOURS = 24;

export const DEFAULT_REPUTATION_TRIGGERS = [
  { type: "reaction" as const, value: "👍", points: 1 },
  { type: "reaction" as const, value: "❤️", points: 1 },
  { type: "reaction" as const, value: "🔥", points: 1 },
  { type: "reaction" as const, value: "👎", points: -1 },
  { type: "keyword" as const, value: "thanks", points: 1 },
  { type: "keyword" as const, value: "thank you", points: 1 },
  { type: "keyword" as const, value: "jazakallah", points: 1 },
  { type: "keyword" as const, value: "boo", points: -1 },
  { type: "keyword" as const, value: "eww", points: -1 },
] as const;
