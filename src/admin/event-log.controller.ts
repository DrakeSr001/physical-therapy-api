import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { EventLogService } from '../event-log/event-log.service';

@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('admin')
@Controller('admin/event-logs')
export class EventLogController {
  constructor(private readonly logs: EventLogService) {}

  @Get()
  async list(@Query('limit') limit?: string) {
    const parsed = Number(limit);
    const safeLimit = Number.isFinite(parsed) ? Math.max(1, Math.min(200, parsed)) : 50;
    const events = await this.logs.recent(safeLimit);
    return events.map((log) => ({
      id: log.id,
      action: log.action,
      status: log.status,
      message: log.message,
      details: log.details,
      createdAt: log.createdAt.toISOString(),
      user: log.user
        ? {
            id: log.user.id,
            name: log.user.fullName,
            email: log.user.email,
          }
        : null,
    }));
  }
}
