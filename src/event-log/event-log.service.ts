import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventLog, EventLogStatus } from './event-log.entity';
import { User } from '../users/user.entity';
import fetch from 'node-fetch';

type RecordOptions = {
  user?: User | null;
  userId?: string | null;
  action: string;
  status: EventLogStatus;
  message?: string;
  details?: Record<string, any>;
};

@Injectable()
export class EventLogService {
  private readonly logger = new Logger(EventLogService.name);

  constructor(
    @InjectRepository(EventLog)
    private readonly repo: Repository<EventLog>,
  ) {}

  async record(options: RecordOptions) {
    try {
      const entry = this.repo.create({
        action: options.action,
        status: options.status,
        message: options.message ?? null,
        details: options.details ?? null,
      });
      if (options.user) {
        entry.user = options.user;
      } else if (options.userId) {
        entry.user = { id: options.userId } as User;
      }
      const saved = await this.repo.save(entry);
      if (saved.status === 'error') {
        await this.sendAlert(saved).catch((err) => {
          this.logger.debug(`Alert webhook failed: ${err instanceof Error ? err.message : err}`);
        });
      }
    } catch (error) {
      this.logger.warn(`Failed to record event log: ${error instanceof Error ? error.message : error}`);
    }
  }

  async recent(limit = 50) {
    return this.repo.find({
      take: limit,
      order: { createdAt: 'DESC' },
      relations: { user: true },
    });
  }

  private async sendAlert(log: EventLog) {
    const webhook = process.env.ADMIN_ALERT_WEBHOOK;
    if (!webhook) return;
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `[${log.action}] ${log.message ?? 'No message'} (${log.user?.fullName ?? log.user?.email ?? 'unknown user'})`,
        event: {
          id: log.id,
          action: log.action,
          status: log.status,
          message: log.message,
          details: log.details,
          userId: log.user?.id ?? null,
          createdAt: log.createdAt.toISOString(),
        },
      }),
    });
  }
}
