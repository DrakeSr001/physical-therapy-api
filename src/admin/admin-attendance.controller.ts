import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AttendanceLog } from '../attendance/attendance-log.entity';
import { User } from '../users/user.entity';
import { AdminCreateAttendanceDto, AdminUpdateAttendanceDto } from './dto/admin-attendance.dto';
import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';

@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('admin')
@Controller('admin/attendance')
export class AdminAttendanceController {
  constructor(
    @InjectRepository(AttendanceLog) private readonly logs: Repository<AttendanceLog>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  @Get('logs')
  async list(
    @Query('userId') userId?: string,
    @Query('start') startIso?: string,
    @Query('end') endIso?: string,
  ) {
    if (!userId) throw new BadRequestException('userId required');
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new BadRequestException('user_not_found');

    let start: Date | undefined;
    let end: Date | undefined;
    if (startIso) {
      const parsed = new Date(startIso);
      if (Number.isNaN(parsed.getTime())) throw new BadRequestException('invalid_start');
      start = parsed;
    }
    if (endIso) {
      const parsed = new Date(endIso);
      if (Number.isNaN(parsed.getTime())) throw new BadRequestException('invalid_end');
      end = parsed;
    }
    if (start && end && end < start) throw new BadRequestException('invalid_range');

    const where: any = { user: { id: userId } };
    if (start && end) {
      where.timestampUtc = Between(start, end);
    } else if (start) {
      where.timestampUtc = Between(start, new Date(start.getTime() + 24 * 60 * 60 * 1000));
    }

    const logs = await this.logs.find({
      where,
      order: { timestampUtc: 'ASC' },
      relations: { device: true },
    });

    return logs.map((log) => ({
      id: log.id,
      action: log.action,
      source: log.source,
      timestampUtc: log.timestampUtc.toISOString(),
      notes: log.notes ?? null,
      device: log.device
        ? { id: log.device.id, name: log.device.name, location: log.device.location ?? null }
        : null,
    }));
  }

  @Post('logs')
  async create(@Body() body: AdminCreateAttendanceDto) {
    const dto = plainToInstance(AdminCreateAttendanceDto, body);
    await validateOrReject(dto);

    const user = await this.users.findOne({ where: { id: dto.userId } });
    if (!user) throw new BadRequestException('user_not_found');

    const timestamp = new Date(dto.timestamp);
    if (Number.isNaN(timestamp.getTime())) throw new BadRequestException('invalid_timestamp');

    const log = this.logs.create({
      user,
      action: dto.action,
      timestampUtc: timestamp,
      source: 'ADMIN',
      notes: dto.notes?.trim() || null,
    });
    const saved = await this.logs.save(log);
    return {
      id: saved.id,
      action: saved.action,
      source: saved.source,
      timestampUtc: saved.timestampUtc.toISOString(),
      notes: saved.notes ?? null,
    };
  }

  @Patch('logs/:id')
  async update(@Param('id') id: string, @Body() body: AdminUpdateAttendanceDto) {
    const dto = plainToInstance(AdminUpdateAttendanceDto, body);
    await validateOrReject(dto);

    const log = await this.logs.findOne({ where: { id } });
    if (!log) throw new BadRequestException('log_not_found');

    if (dto.action) {
      log.action = dto.action;
    }
    if (dto.timestamp) {
      const timestamp = new Date(dto.timestamp);
      if (Number.isNaN(timestamp.getTime())) throw new BadRequestException('invalid_timestamp');
      log.timestampUtc = timestamp;
    }
    if (dto.notes !== undefined) {
      log.notes = dto.notes ? dto.notes.trim() : null;
    }
    log.source = 'ADMIN';

    const saved = await this.logs.save(log);
    return {
      id: saved.id,
      action: saved.action,
      source: saved.source,
      timestampUtc: saved.timestampUtc.toISOString(),
      notes: saved.notes ?? null,
    };
  }

  @Delete('logs/:id')
  async delete(@Param('id') id: string) {
    const log = await this.logs.findOne({ where: { id } });
    if (!log) throw new BadRequestException('log_not_found');
    await this.logs.remove(log);
    return { ok: true };
  }
}
