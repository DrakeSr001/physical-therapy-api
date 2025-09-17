import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  ok() {
    return { ok: true, time: new Date().toISOString() };
  }

  @Get('db')
  async db() {
    // simple round trip to Neon
    await this.dataSource.query('SELECT 1');
    return { db: 'up', time: new Date().toISOString() };
  }
}
