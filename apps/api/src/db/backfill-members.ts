import { and, eq, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "./index";
import { user, members, telegramMessages } from "./schema";
import { createTelegramUser } from "../bot/lib/auth";
import { membersService } from "../services/members.service";

export async function backfillMissingMembers(): Promise<void> {
  // Step 1: Find distinct non-bot Telegram senders missing a user row
  const existingTelegramIds = db
    .select({ id: sql<string>`${user.telegramId}::bigint` })
    .from(user)
    .where(isNotNull(user.telegramId));

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
    );

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
    const userId = await createTelegramUser({
      id: sender.fromUserId!,
      first_name: sender.fromFirstName ?? "Unknown",
      last_name: sender.fromLastName ?? undefined,
      username: sender.fromUsername ?? undefined,
    });
    usersCreated++;

    const { created } = await membersService.createIfNotExists(userId);
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
}
