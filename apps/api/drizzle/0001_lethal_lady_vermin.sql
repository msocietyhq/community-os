ALTER TABLE "members" DROP CONSTRAINT "members_telegram_id_unique";--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "telegram_id" text;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "telegram_username" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "telegram_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "telegram_username" text;--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "telegram_id";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "telegram_username";