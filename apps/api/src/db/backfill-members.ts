import { and, desc, eq, isNotNull, isNull, notInArray, sql, min } from "drizzle-orm";
import { db } from "./index";
import { user, members, telegramMessages } from "./schema";
import { createTelegramUser } from "../bot/lib/auth";
import { membersService } from "../services/members.service";

// Names that indicate a Telegram bot/service account rather than a real member.
// These have from_is_bot=false in the message data but are not community members.
const BOT_NAME_PATTERNS = [/bot(\s|$)/i, /^github$/i, /^combot$/i];

function isBotName(name: string): boolean {
  return BOT_NAME_PATTERNS.some((p) => p.test(name));
}

export async function backfillMissingMembers(): Promise<void> {
  // Step 0: Remove user rows that match bot name patterns.
  // Cascade deletes clean up account + member rows automatically.
  const botUsers = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(isNotNull(user.telegramId));

  let botsRemoved = 0;
  for (const u of botUsers) {
    if (isBotName(u.name)) {
      await db.delete(user).where(eq(user.id, u.id));
      botsRemoved++;
    }
  }
  if (botsRemoved > 0) {
    console.log(`Member backfill: removed ${botsRemoved} bot accounts`);
  }

  // Step 1: Find distinct non-bot Telegram senders missing a user row
  const existingTelegramIds = db
    .select({ id: sql<string>`${user.telegramId}::bigint` })
    .from(user)
    .where(isNotNull(user.telegramId));

  // Use the most recent message per sender to get the latest name/username
  const missingSenders = await db
    .selectDistinctOn([telegramMessages.fromUserId], {
      fromUserId: telegramMessages.fromUserId,
      fromFirstName: telegramMessages.fromFirstName,
      fromLastName: telegramMessages.fromLastName,
      fromUsername: telegramMessages.fromUsername,
    })
    .from(telegramMessages)
    .where(
      and(
        isNotNull(telegramMessages.fromUserId),
        eq(telegramMessages.fromIsBot, false),
        notInArray(telegramMessages.fromUserId, existingTelegramIds),
      ),
    )
    .orderBy(telegramMessages.fromUserId, desc(telegramMessages.date));

  if (missingSenders.length === 0) {
    console.log("Member backfill: no missing senders found");
  } else {
    console.log(
      `Member backfill: found ${missingSenders.length} Telegram senders without a user row`,
    );
  }

  let usersCreated = 0;
  let membersCreated = 0;

  // Step 2: Create user + account + member for each missing sender
  for (const sender of missingSenders) {
    const name = sender.fromFirstName ?? "Unknown";
    if (isBotName(name)) continue;

    const userId = await createTelegramUser({
      id: sender.fromUserId!,
      first_name: sender.fromFirstName ?? "Unknown",
      last_name: sender.fromLastName ?? undefined,
      username: sender.fromUsername ?? undefined,
    });
    usersCreated++;

    // Find their earliest telegram message date
    const [earliest] = await db
      .select({ date: min(telegramMessages.date) })
      .from(telegramMessages)
      .where(eq(telegramMessages.fromUserId, sender.fromUserId!));

    const { created } = await membersService.createIfNotExists(userId, {
      joinedAt: earliest?.date ?? undefined,
    });
    if (created) membersCreated++;
  }

  // Step 3: Backfill members for existing users missing a member row
  const usersWithoutMembers = await db
    .select({ id: user.id })
    .from(user)
    .leftJoin(members, eq(user.id, members.userId))
    .where(isNull(members.id));

  for (const u of usersWithoutMembers) {
    const { created } = await membersService.createIfNotExists(u.id);
    if (created) membersCreated++;
  }

  if (usersCreated > 0 || membersCreated > 0) {
    console.log(
      `Member backfill: created ${usersCreated} users, ${membersCreated} members`,
    );
  }

  // Step 4: Fix joinedAt for existing members where joinedAt was never corrected
  // (i.e., joinedAt equals createdAt, meaning it defaulted to now())
  const membersToFix = await db
    .select({
      memberId: members.id,
      telegramId: user.telegramId,
    })
    .from(members)
    .innerJoin(user, eq(members.userId, user.id))
    .where(
      and(
        isNotNull(user.telegramId),
        sql`${members.joinedAt} = ${members.createdAt}`,
      ),
    );

  let joinedAtFixed = 0;
  for (const m of membersToFix) {
    const [earliest] = await db
      .select({ date: min(telegramMessages.date) })
      .from(telegramMessages)
      .where(eq(telegramMessages.fromUserId, sql`${m.telegramId}::bigint`));

    if (earliest?.date) {
      await db
        .update(members)
        .set({ joinedAt: earliest.date })
        .where(eq(members.id, m.memberId));
      joinedAtFixed++;
    }
  }

  if (joinedAtFixed > 0) {
    console.log(
      `Member backfill: corrected joinedAt for ${joinedAtFixed} members`,
    );
  }

  // Step 5: Backfill missing telegram_username from most recent message
  const usersWithoutUsername = await db
    .select({ id: user.id, telegramId: user.telegramId })
    .from(user)
    .where(and(isNotNull(user.telegramId), isNull(user.telegramUsername)));

  let usernamesFixed = 0;
  for (const u of usersWithoutUsername) {
    const [latest] = await db
      .selectDistinctOn([telegramMessages.fromUserId], {
        fromUsername: telegramMessages.fromUsername,
      })
      .from(telegramMessages)
      .where(
        and(
          eq(telegramMessages.fromUserId, sql`${u.telegramId}::bigint`),
          isNotNull(telegramMessages.fromUsername),
        ),
      )
      .orderBy(telegramMessages.fromUserId, desc(telegramMessages.date));

    if (latest?.fromUsername) {
      await db
        .update(user)
        .set({ telegramUsername: latest.fromUsername })
        .where(eq(user.id, u.id));
      usernamesFixed++;
    }
  }

  if (usernamesFixed > 0) {
    console.log(
      `Member backfill: filled telegram_username for ${usernamesFixed} users`,
    );
  }
}
