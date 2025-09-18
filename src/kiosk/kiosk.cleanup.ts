// src/kiosk/kiosk.cleanup.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, IsNull } from 'typeorm'; // ⬅️ add IsNull
import { KioskCode } from './kiosk-code.entity';

@Injectable()
export class KioskCleanup {
  private readonly log = new Logger(KioskCleanup.name);
  constructor(@InjectRepository(KioskCode) private codes: Repository<KioskCode>) {}

  // Runs every 10 minutes
  @Cron(CronExpression.EVERY_10_MINUTES)
  async sweep() {
    const now = Date.now();
    const oneHourAgo = new Date(now - 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    // 1) Expired and NEVER used → older than 1 hour
    const res1 = await this.codes.delete({
      usedAt: IsNull(),                     // ⬅️ use IsNull()
      expiresAt: LessThan(oneHourAgo),
    });

    // 2) Used codes → keep 7 days for audit, then delete
    const res2 = await this.codes.delete({
      usedAt: LessThan(sevenDaysAgo),
    });

    const removed = (res1.affected ?? 0) + (res2.affected ?? 0);
    if (removed > 0) {
      this.log.log(`Kiosk cleanup removed ${removed} stale codes`);
    }
  }
}
