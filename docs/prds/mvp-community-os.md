# PRD: MVP — community-os

**Status**: in-progress
**Author**: Aziz
**Date**: 2026-03-14
**Target Release**: Q2 2026

## Problem Statement

MSOCIETY (500+ Muslim tech professionals, Singapore, est. 2015) currently manages community operations through a Telegram group and a basic Telegram bot (`msocietybot`). There is no centralized system for:

- Member profiles and directory
- Event management and RSVPs
- Project showcasing and endorsement
- Infrastructure provisioning for member projects
- Community fund tracking and transparency
- Reputation/contribution tracking

Community admins rely on spreadsheets, manual Telegram polls, and ad-hoc processes. This doesn't scale and lacks transparency.

## Goals

1. **Centralize community management** into a single API-first platform
2. **Replace msocietybot** with an AI-enhanced bot that integrates with the new platform
3. **Provide a web portal** for members to manage profiles, view events, and track projects
4. **Enable self-service infra** for endorsed member projects (subdomains, databases, deployments)
5. **Transparent fund management** — every SGD in and out is tracked and visible

## Non-Goals

- Mobile app (web SPA is mobile-responsive)
- Payment processing (fund tracking only, not payment collection)
- Content management / blog
- Job board

## User Stories

### Members
- As a member, I want to log in with my Telegram account so I don't need another password
- As a member, I want to view and RSVP to upcoming events
- As a member, I want to showcase my projects and get community endorsement
- As a member, I want to see my reputation score from community contributions
- As a member, I want to ask the bot questions about community events and projects

### Admins
- As an admin, I want to create and manage events with RSVP tracking
- As an admin, I want to endorse member projects for MSOCIETY infrastructure
- As an admin, I want to provision infrastructure (Railway, Neon, subdomains) for endorsed projects
- As an admin, I want to track all community expenses and reimbursements
- As an admin, I want to see audit logs of all administrative actions

### Bot Users
- As a group member, I want to earn reputation by helping others (reactions, keywords)
- As a group member, I want to ask @msocietybot about upcoming events
- As a group member, I want to RSVP to events directly from Telegram

## Requirements

### Must Have (P0)
- Telegram Login authentication
- Member profiles with Telegram linking
- Event CRUD with RSVP and attendance tracking
- Basic reputation system (emoji reactions + keywords)
- Telegram bot with event commands and AI chat
- Health check and OpenAPI documentation
- Audit logging

### Should Have (P1)
- Project directory with endorsement workflow
- Fund transaction tracking with balance derivation
- Event pledge system
- Web portal with dashboard, events, and projects pages
- Bot AI agent with tool-use (read events, RSVP, check reputation)

### Nice to Have (P2)
- Infrastructure provisioning (Railway, Neon, Cloudflare)
- Subdomain management for member projects
- Email notifications via Resend
- Reputation leaderboard

### Future (P3)
- Admin CLI tool
- Webhooks for external integrations
- Advanced analytics and reporting
- Member skills matching / project team formation

## Technical Approach

See `/docs/architecture/system-overview.md` for the full architecture. Key decisions:

- **Monorepo** with Bun workspaces (API, web, bot, shared package)
- **ElysiaJS** API with Eden Treaty for type-safe clients
- **Drizzle ORM** with Neon PostgreSQL
- **Better Auth** with Telegram Login plugin
- **grammY** for Telegram bot with Claude AI agent

## Success Metrics

1. All active MSOCIETY members can log in and have profiles within 4 weeks of launch
2. At least 3 events managed through the platform in the first month
3. Bot successfully handles 80% of common queries via AI
4. Fund tracking replaces the existing spreadsheet

## Open Questions

1. How to handle the transition period where both old and new bot coexist?
2. Should we support multiple Telegram groups or just the main one?
3. What's the retention policy for audit logs?
