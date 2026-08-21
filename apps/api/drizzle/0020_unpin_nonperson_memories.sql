-- Custom SQL migration file, put your code below! --

-- Un-pin memories whose subject is not a person.
--
-- memory-extractor.ts resolved a fact's subject to a telegram id and, on
-- failure, fell back to whoever happened to send the message. Measured on this
-- corpus that misattributed 956 of 1117 active memories (86%): an industry
-- observation became a fact about the person who voiced it, a shared news link
-- became a fact about the sharer. Those memories then fed AI profile
-- generation, which reads them by subject_telegram_id.
--
-- The fallback is gone. This corrects the rows it already wrote, applying the
-- same rules resolveSubjectTelegramId now uses:
--   1. exact match on name or telegram_username (@ stripped)  -> keep
--   2. unambiguous first-name match                           -> keep
--   3. anything else                                          -> null
--
-- Nulling only clears the attribution. The memory itself, its content,
-- embedding and source pointer are untouched, so it stays fully searchable via
-- recallMemories — it just stops being treated as a fact about a person.
--
-- Runs before the app boots, so the profile regeneration triggered by the
-- PROMPT_VERSION bump reads already-cleaned evidence.

UPDATE bot_memories bm
SET subject_telegram_id = NULL
WHERE bm.subject_telegram_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "user" u
    WHERE u.telegram_id IS NOT NULL
      AND (
        lower(u.name) = lower(regexp_replace(trim(bm.subject), '^@', ''))
        OR lower(u.telegram_username) = lower(regexp_replace(trim(bm.subject), '^@', ''))
      )
  )
  AND NOT (
    -- Unambiguous first name: exactly one member answers to it. Two members
    -- called "Ali" means neither is a safe guess, and a wrong guess is worse
    -- than none — it writes a fact onto the wrong person's profile.
    SELECT count(*) = 1
    FROM "user" u
    WHERE u.telegram_id IS NOT NULL
      AND lower(split_part(u.name, ' ', 1)) =
          lower(regexp_replace(trim(bm.subject), '^@', ''))
  );
