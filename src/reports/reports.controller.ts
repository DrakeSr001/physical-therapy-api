import { BadRequestException, Controller, Get, Header, Query, Req, UseGuards } from '@nestjs/common';
import { Repository, Between } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { DateTime } from 'luxon';
import { AttendanceLog } from '../attendance/attendance-log.entity';
import { User } from '../users/user.entity';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';


@Controller('reports')
export class ReportsController {
  constructor(
    @InjectRepository(AttendanceLog) private readonly logs: Repository<AttendanceLog>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  // Doctor: CSV for my month (one line per day with first IN / last OUT)
  @UseGuards(AuthGuard('jwt'))
  @Get('my-month.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async myMonthCsv(@Req() req: any, @Query('year') year?: string, @Query('month') month?: string) {
    const y = Number(year), m = Number(month);
    if (!y || !m || m < 1 || m > 12) throw new BadRequestException('year/month required');

    const tz = 'Africa/Cairo';
    const start = DateTime.fromObject({ year: y, month: m, day: 1 }, { zone: tz }).startOf('day');
    const end = start.plus({ months: 1 });
    const rows = await this.logs.find({
      where: {
        user: { id: req.user.userId },
        timestampUtc: Between(start.toUTC().toJSDate(), end.toUTC().toJSDate()),
      },
      order: { timestampUtc: 'ASC' },
    });

    const daysInMonth = start.daysInMonth!;
    const firstIn: (DateTime | null)[] = Array(daysInMonth).fill(null);
    const lastOut: (DateTime | null)[] = Array(daysInMonth).fill(null);

    for (const r of rows) {
      const local = DateTime.fromJSDate(r.timestampUtc, { zone: 'utc' }).setZone(tz);
      const i = local.day - 1;
      if (r.action === 'IN') {
        if (!firstIn[i] || local < firstIn[i]!) firstIn[i] = local;
      } else if (r.action === 'OUT') {
        if (!lastOut[i] || local > lastOut[i]!) lastOut[i] = local;
      }
    }

    const lines: string[] = [];
    lines.push('Date,IN,OUT'); // header
    for (let d = 1; d <= daysInMonth; d++) {
      const date = DateTime.fromObject({ year: y, month: m, day: d }, { zone: tz });
      const inStr = firstIn[d - 1]?.toFormat('hh:mm:ss a') ?? '';
      const outStr = lastOut[d - 1]?.toFormat('hh:mm:ss a') ?? '';
      lines.push(`${date.toFormat('MM/dd/yy')},${inStr},${outStr}`);
    }
    return lines.join('\n');
  }

  // Admin: CSV for the whole clinic in a month (raw logs)
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  @Get('clinic-month.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async clinicMonthCsv(@Query('year') year?: string, @Query('month') month?: string) {
    const y = Number(year), m = Number(month);
    if (!y || !m || m < 1 || m > 12) throw new BadRequestException('year/month required');

    const tz = 'Africa/Cairo';
    const start = DateTime.fromObject({ year: y, month: m, day: 1 }, { zone: tz }).startOf('day');
    const end = start.plus({ months: 1 });

    const rows = await this.logs.find({
      where: { timestampUtc: Between(start.toUTC().toJSDate(), end.toUTC().toJSDate()) },
      order: { timestampUtc: 'ASC' },
      relations: { user: true, device: true },
    });

    const lines: string[] = [];
    lines.push('Date,Time,Doctor,Action,Device'); // header
    for (const r of rows) {
      const local = DateTime.fromJSDate(r.timestampUtc, { zone: 'utc' }).setZone(tz);
      const date = local.toFormat('MM/dd/yy');
      const time = local.toFormat('hh:mm:ss a');
      const doc = r.user?.fullName ?? '';
      const device = r.device?.name ?? '';
      lines.push(`${date},${time},${csvEsc(doc)},${r.action},${csvEsc(device)}`);
    }
    return lines.join('\n');
  }

  // Admin: CSV for a specific doctor in a month
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  @Get('doctor-month.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async doctorMonthCsv(
    @Query('userId') userId?: string,
    @Query('year') year?: string,
    @Query('month') month?: string
  ) {
    const y = Number(year), m = Number(month);
    if (!userId || !y || !m || m < 1 || m > 12) throw new BadRequestException('userId/year/month required');

    const tz = 'Africa/Cairo';
    const start = DateTime.fromObject({ year: y, month: m, day: 1 }, { zone: tz }).startOf('day');
    const end = start.plus({ months: 1 });

    const rows = await this.logs.find({
      where: {
        user: { id: userId },
        timestampUtc: Between(start.toUTC().toJSDate(), end.toUTC().toJSDate()),
      },
      order: { timestampUtc: 'ASC' },
      relations: { user: true, device: true },
    });

    const lines: string[] = [];
    lines.push('Date,Time,Doctor,Action,Device');

    // Raw rows
    for (const r of rows) {
      const local = DateTime.fromJSDate(r.timestampUtc, { zone: 'utc' }).setZone(tz);
      lines.push(`${local.toFormat('MM/dd/yy')},${local.toFormat('hh:mm:ss a')},${csvEsc(r.user?.fullName ?? '')},${r.action},${csvEsc(r.device?.name ?? '')}`);
    }

    // Compute total hours from first IN / last OUT per day
    const daysInMonth = start.daysInMonth!;
    const firstIn: (DateTime | null)[] = Array(daysInMonth).fill(null);
    const lastOut: (DateTime | null)[] = Array(daysInMonth).fill(null);
    for (const r of rows) {
      const local = DateTime.fromJSDate(r.timestampUtc, { zone: 'utc' }).setZone(tz);
      const i = local.day - 1;
      if (r.action === 'IN') {
        if (!firstIn[i] || local < firstIn[i]!) firstIn[i] = local;
      } else if (r.action === 'OUT') {
        if (!lastOut[i] || local > lastOut[i]!) lastOut[i] = local;
      }
    }
    let totalMs = 0;
    for (let i = 0; i < daysInMonth; i++) {
      if (firstIn[i] && lastOut[i] && lastOut[i]! > firstIn[i]!) {
        totalMs += lastOut[i]!.toMillis() - firstIn[i]!.toMillis();
      }
    }
    const fmtHm = (ms: number) => {
      const mins = Math.floor(ms / 60000);
      const h = Math.floor(mins / 60);
      const m2 = mins % 60;
      return `${String(h).padStart(2, '0')}:${String(m2).padStart(2, '0')}`;
    };
    lines.push(`Total Hours,,${fmtHm(totalMs)},,,`);

    return lines.join('\n');
  }
}

function csvEsc(s: string) {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
