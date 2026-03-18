import { reputationService } from "../services/reputation.service";

console.log("Recalculating all reputation scores from telegram_messages...");
await reputationService.recalculateAllScores();
console.log("Done");
process.exit(0);
