import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';

@Injectable()
export class DatabaseKeepAliveService {
  private readonly logger = new Logger(DatabaseKeepAliveService.name);

  constructor(private readonly dataSource: DataSource) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async ping() {
    try {
      await this.dataSource.query('SELECT 1');
    } catch (error) {
      this.logger.warn(`Database keep-alive failed: ${error instanceof Error ? error.message : error}`);
    }
  }
}