-- Custom SQL migration file, put your code below! --

-- Profile photo bytes, moved out of user.image.
--
-- user.image previously held base64 data URIs averaging 144KB each. Any agent
-- listing members pulled them into its prompt and blew past the model's
-- context window (479k tokens against a 200k limit). The bytes now live here
-- and user.image holds a URL to the photo route.
CREATE TABLE IF NOT EXISTS "user_photo" (
	"user_id" text PRIMARY KEY NOT NULL,
	"data" bytea NOT NULL,
	"content_type" text DEFAULT 'image/jpeg' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "user_photo"
		ADD CONSTRAINT "user_photo_user_id_user_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
