import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Repository, Between } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { DateTime } from 'luxon';
import { AttendanceLog } from '../attendance/attendance-log.entity';
import { User } from '../users/user.entity';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { Response } from 'express';

const CLINIC_TZ = 'Africa/Cairo';
const MAX_RANGE_DAYS = 120;

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

    const tz = CLINIC_TZ;
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
  async clinicMonthCsv(
    @Query('year') year?: string,
    @Query('month') month?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const y = Number(year), m = Number(month);
    if (!y || !m || m < 1 || m > 12) throw new BadRequestException('year/month required');

    const tz = CLINIC_TZ;
    const start = DateTime.fromObject({ year: y, month: m, day: 1 }, { zone: tz }).startOf('day');
    const end = start.plus({ months: 1 });

    const rows = await this.logs.find({
      where: { timestampUtc: Between(start.toUTC().toJSDate(), end.toUTC().toJSDate()) },
      order: { timestampUtc: 'ASC' },
      relations: { user: true, device: true },
    });

    if (res) {
      const mm = m.toString().padStart(2, '0');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="clinic-${y}-${mm}.csv"`);
    }

    const grouped = new Map<string, AttendanceLog[]>();
    for (const entry of rows) {
      const doctor = (entry.user?.fullName ?? 'Unknown Doctor').trim();
      if (!grouped.has(doctor)) grouped.set(doctor, []);
      grouped.get(doctor)!.push(entry);
    }

    const summaryRows: Array<{ doctor: string; totalMinutes: number; workedDays: number }> = [];
    const lines: string[] = [];
    const monthLabel = `${y}-${String(m).padStart(2, '0')}`;
    lines.push('Clinic Attendance (Monthly)');
    lines.push(`Month,${monthLabel}`);
    lines.push('');

    const sortedDoctors = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b));
    for (const doctor of sortedDoctors) {
      const logs = grouped.get(doctor)!;
      logs.sort((a, b) => a.timestampUtc.getTime() - b.timestampUtc.getTime());

      lines.push(`Doctor,${csvEsc(doctor)}`);
      lines.push('Date,Time,Action,Device');
      for (const log of logs) {
        const local = DateTime.fromJSDate(log.timestampUtc, { zone: 'utc' }).setZone(CLINIC_TZ);
        lines.push(
          `${local.toFormat('yyyy-MM-dd')},${local.toFormat('hh:mm:ss a')},${log.action},${csvEsc(log.device?.name ?? '')}`,
        );
      }

      const daySummary = this.buildDoctorDaySummary(logs, start, end);
      const totalMinutes = daySummary.reduce((sum, d) => sum + d.workedMinutes, 0);
      const workedDays = daySummary.filter((d) => d.workedMinutes > 0).length;
      summaryRows.push({ doctor, totalMinutes, workedDays });

      lines.push('');
      lines.push('Daily Summary,,,');
      lines.push('Date,First IN,Last OUT,Hours');
      for (const day of daySummary) {
        const label = day.date.toFormat('yyyy-MM-dd');
        const firstIn = day.firstIn ? day.firstIn.toFormat('hh:mm:ss a') : '';
        const lastOut = day.lastOut ? day.lastOut.toFormat('hh:mm:ss a') : '';
        const hours = day.workedMinutes > 0 ? this.formatMinutes(day.workedMinutes) : '';
        lines.push(`${label},${firstIn},${lastOut},${hours}`);
      }
      lines.push(`Totals,,${this.formatMinutes(totalMinutes)},Worked days ${workedDays}`);
      lines.push('');
    }

    if (summaryRows.length) {
      lines.push('Overall Summary,,');
      lines.push('Doctor,Worked days,Total hours,Average / worked day');
      const sortedSummary = summaryRows.sort((a, b) => a.doctor.localeCompare(b.doctor));
      for (const row of sortedSummary) {
        const avg =
          row.workedDays > 0
            ? this.formatMinutes(Math.floor(row.totalMinutes / row.workedDays))
            : '-';
        lines.push(
          `${csvEsc(row.doctor)},${row.workedDays},${this.formatMinutes(row.totalMinutes)},${avg}`,
        );
      }
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

    const tz = CLINIC_TZ;
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

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  @Get('doctor-range-summary')
  async doctorRangeSummary(
    @Query('userId') userId?: string,
    @Query('start') startRaw?: string,
    @Query('end') endRaw?: string,
  ) {
    if (!userId) throw new BadRequestException('userId required');
    const range = this.ensureRange(startRaw, endRaw);

    const rows = await this.logs.find({
      where: {
        user: { id: userId },
        timestampUtc: Between(range.start.toUTC().toJSDate(), range.end.toUTC().toJSDate()),
      },
      order: { timestampUtc: 'ASC' },
    });

    const daySummary = this.buildDoctorDaySummary(rows, range.start, range.end);
    const totalMinutes = daySummary.reduce((sum, d) => sum + d.workedMinutes, 0);
    const workedDays = daySummary.filter((d) => d.workedMinutes > 0).length;
    const averageMinutes = workedDays > 0 ? Math.floor(totalMinutes / workedDays) : 0;

    return {
      range: {
        start: range.start.startOf('day').toISODate(),
        end: range.end.startOf('day').toISODate(),
        timezone: CLINIC_TZ,
        totalDays: daySummary.length,
      },
      totalMinutes,
      totalHours: this.formatMinutes(totalMinutes),
      workedDays,
      averagePerWorkedDay: this.formatMinutes(averageMinutes),
      days: daySummary.map((d) => ({
        date: d.date.toISODate(),
        weekday: d.date.toFormat('ccc'),
        in: d.firstIn ? d.firstIn.toFormat('hh:mm a') : null,
        out: d.lastOut ? d.lastOut.toFormat('hh:mm a') : null,
        hours: d.workedMinutes > 0 ? this.formatMinutes(d.workedMinutes) : '',
        minutes: d.workedMinutes,
      })),
    };
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  @Get('doctor-range.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async doctorRangeCsv(
    @Query('userId') userId?: string,
    @Query('start') startRaw?: string,
    @Query('end') endRaw?: string,
  ) {
    if (!userId) throw new BadRequestException('userId required');
    const range = this.ensureRange(startRaw, endRaw);

    const rows = await this.logs.find({
      where: {
        user: { id: userId },
        timestampUtc: Between(range.start.toUTC().toJSDate(), range.end.toUTC().toJSDate()),
      },
      order: { timestampUtc: 'ASC' },
      relations: { user: true, device: true },
    });

    const lines: string[] = [];
    lines.push('Date,Time,Doctor,Action,Device');
    for (const r of rows) {
      const local = DateTime.fromJSDate(r.timestampUtc, { zone: 'utc' }).setZone(CLINIC_TZ);
      lines.push(
        `${local.toFormat('MM/dd/yy')},${local.toFormat('hh:mm:ss a')},${csvEsc(r.user?.fullName ?? '')},${r.action},${csvEsc(r.device?.name ?? '')}`,
      );
    }

    lines.push('', 'Daily summary,,,', 'Date,First IN,Last OUT,Hours');
    const daySummary = this.buildDoctorDaySummary(rows, range.start, range.end);
    let totalMinutes = 0;
    for (const day of daySummary) {
      const label = day.date.toFormat('MM/dd/yy');
      const firstIn = day.firstIn ? day.firstIn.toFormat('hh:mm:ss a') : '';
      const lastOut = day.lastOut ? day.lastOut.toFormat('hh:mm:ss a') : '';
      const hours = day.workedMinutes > 0 ? this.formatMinutes(day.workedMinutes) : '';
      totalMinutes += day.workedMinutes;
      lines.push(`${label},${firstIn},${lastOut},${hours}`);
    }
    lines.push(`Total,,${this.formatMinutes(totalMinutes)},`);

    return lines.join('\n');
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  @Get('clinic-range.csv')
  async clinicRangeCsv(
    @Query('start') startRaw?: string,
    @Query('end') endRaw?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const range = this.ensureRange(startRaw, endRaw);

    const rows = await this.logs.find({
      where: {
        timestampUtc: Between(range.start.toUTC().toJSDate(), range.end.toUTC().toJSDate()),
      },
      order: { timestampUtc: 'ASC' },
      relations: { user: true, device: true },
    });

    if (res) {
      const filename = `clinic-${range.start.toFormat('yyyyMMdd')}-${range.end.toFormat('yyyyMMdd')}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    }

    const grouped = new Map<string, AttendanceLog[]>();
    for (const entry of rows) {
      const doctor = (entry.user?.fullName ?? 'Unknown Doctor').trim();
      if (!grouped.has(doctor)) grouped.set(doctor, []);
      grouped.get(doctor)!.push(entry);
    }

    const summaryRows: Array<{ doctor: string; totalMinutes: number; workedDays: number }> = [];
    const lines: string[] = [];
    lines.push('Clinic Attendance (Custom Range)');
    lines.push(`Range start,${range.start.toFormat('yyyy-MM-dd')}`);
    lines.push(`Range end,${range.end.toFormat('yyyy-MM-dd')}`);
    lines.push('');

    const sortedDoctors = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b));
    for (const doctor of sortedDoctors) {
      const logs = grouped.get(doctor)!;
      logs.sort((a, b) => a.timestampUtc.getTime() - b.timestampUtc.getTime());

      lines.push(`Doctor,${csvEsc(doctor)}`);
      lines.push('Date,Time,Action,Device');
      for (const log of logs) {
        const local = DateTime.fromJSDate(log.timestampUtc, { zone: 'utc' }).setZone(CLINIC_TZ);
        lines.push(
          `${local.toFormat('yyyy-MM-dd')},${local.toFormat('hh:mm:ss a')},${log.action},${csvEsc(log.device?.name ?? '')}`,
        );
      }

      const daySummary = this.buildDoctorDaySummary(logs, range.start, range.end);
      const totalMinutes = daySummary.reduce((sum, d) => sum + d.workedMinutes, 0);
      const workedDays = daySummary.filter((d) => d.workedMinutes > 0).length;
      summaryRows.push({ doctor, totalMinutes, workedDays });

      lines.push('');
      lines.push('Daily Summary,,,');
      lines.push('Date,First IN,Last OUT,Hours');
      for (const day of daySummary) {
        const label = day.date.toFormat('yyyy-MM-dd');
        const firstIn = day.firstIn ? day.firstIn.toFormat('hh:mm:ss a') : '';
        const lastOut = day.lastOut ? day.lastOut.toFormat('hh:mm:ss a') : '';
        const hours = day.workedMinutes > 0 ? this.formatMinutes(day.workedMinutes) : '';
        lines.push(`${label},${firstIn},${lastOut},${hours}`);
      }
      lines.push(`Totals,,${this.formatMinutes(totalMinutes)},Worked days ${workedDays}`);
      lines.push('');
    }

    if (summaryRows.length) {
      lines.push('Overall Summary,,');
      lines.push('Doctor,Worked days,Total hours,Average / worked day');
      const sortedSummary = summaryRows.sort((a, b) => a.doctor.localeCompare(b.doctor));
      for (const row of sortedSummary) {
        const avg =
          row.workedDays > 0
            ? this.formatMinutes(Math.floor(row.totalMinutes / row.workedDays))
            : '-';
        lines.push(
          `${csvEsc(row.doctor)},${row.workedDays},${this.formatMinutes(row.totalMinutes)},${avg}`,
        );
      }
    }

    return lines.join('\n');
  }

  private ensureRange(startRaw?: string, endRaw?: string) {
    if (!startRaw || !endRaw) throw new BadRequestException('start/end required');
    let start = DateTime.fromISO(startRaw, { zone: CLINIC_TZ });
    let end = DateTime.fromISO(endRaw, { zone: CLINIC_TZ });
    if (!start.isValid || !end.isValid) throw new BadRequestException('invalid_date');
    start = start.startOf('day');
    end = end.endOf('day');
    if (end < start) throw new BadRequestException('invalid_range');
    const span = end.startOf('day').diff(start.startOf('day'), 'days').days;
    if (span > MAX_RANGE_DAYS) throw new BadRequestException('range_too_large');
    return { start, end };
  }

  private buildDoctorDaySummary(rows: AttendanceLog[], start: DateTime, end: DateTime) {
    const startDay = start.startOf('day');
    const endDay = end.startOf('day');
    const totalDays = Math.floor(endDay.diff(startDay, 'days').days) + 1;
    const buckets = Array.from({ length: totalDays }, (_, index) => ({
      date: startDay.plus({ days: index }),
      firstIn: null as DateTime | null,
      lastOut: null as DateTime | null,
      workedMinutes: 0,
    }));

    for (const entry of rows) {
      const local = DateTime.fromJSDate(entry.timestampUtc, { zone: 'utc' }).setZone(CLINIC_TZ);
      const dayIndex = Math.floor(local.startOf('day').diff(startDay, 'days').days);
      if (dayIndex < 0 || dayIndex >= buckets.length) continue;
      if (entry.action === 'IN') {
        if (!buckets[dayIndex].firstIn || local < buckets[dayIndex].firstIn!) {
          buckets[dayIndex].firstIn = local;
        }
      } else if (entry.action === 'OUT') {
        if (!buckets[dayIndex].lastOut || local > buckets[dayIndex].lastOut!) {
          buckets[dayIndex].lastOut = local;
        }
      }
    }

    return buckets.map((bucket) => {
      let workedMinutes = 0;
      if (bucket.firstIn && bucket.lastOut && bucket.lastOut > bucket.firstIn) {
        workedMinutes = Math.max(
          0,
          Math.floor(bucket.lastOut.diff(bucket.firstIn, 'minutes').minutes),
        );
      }
      return {
        date: bucket.date,
        firstIn: bucket.firstIn,
        lastOut: bucket.lastOut,
        workedMinutes,
      };
    });
  }

  private formatMinutes(totalMinutes: number) {
    const minutesValue = Number.isFinite(totalMinutes) ? Math.floor(totalMinutes) : 0;
    const safeMinutes = Math.max(0, minutesValue);
    const h = Math.floor(safeMinutes / 60);
    const m = safeMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}

function csvEsc(s: string) {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}


