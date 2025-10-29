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
import * as ExcelJS from 'exceljs';

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
  @Get('clinic-month.xlsx')
  async clinicMonthWorkbook(
    @Query('year') year?: string,
    @Query('month') month?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const y = Number(year), m = Number(month);
    if (!y || !m || m < 1 || m > 12) throw new BadRequestException('year/month required');

    const tz = CLINIC_TZ;
    const start = DateTime.fromObject({ year: y, month: m, day: 1 }, { zone: tz }).startOf('day');
    const end = start.plus({ months: 1 });

    if (res) {
      const mm = m.toString().padStart(2, '0');
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader('Content-Disposition', `attachment; filename="clinic-${y}-${mm}.xlsx"`);
    }

    const rows = await this.logs.find({
      where: { timestampUtc: Between(start.toUTC().toJSDate(), end.toUTC().toJSDate()) },
      order: { timestampUtc: 'ASC' },
      relations: { user: true, device: true },
    });

    const workbook = await this.buildClinicWorkbook(rows, start, end);
    return this.workbookToBuffer(workbook);
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
  @Get('clinic-range.xlsx')
  async clinicRangeWorkbook(
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
      const filename = `clinic-${range.start.toFormat('yyyyMMdd')}-${range.end.toFormat('yyyyMMdd')}.xlsx`;
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    }

    const workbook = await this.buildClinicWorkbook(rows, range.start, range.end);
    return this.workbookToBuffer(workbook);
  }

  private async buildClinicWorkbook(
    rows: AttendanceLog[],
    rangeStart: DateTime,
    rangeEnd: DateTime,
  ) {
    const workbook = new ExcelJS.Workbook();
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.title = 'Clinic Attendance';

    const grouped = new Map<string, AttendanceLog[]>();
    for (const entry of rows) {
      const doctor = (entry.user?.fullName ?? 'Unknown Doctor').trim();
      if (!grouped.has(doctor)) grouped.set(doctor, []);
      grouped.get(doctor)!.push(entry);
    }

    const summaryRows: Array<{ doctor: string; totalMinutes: number; workedDays: number }> = [];

    const sortedDoctors = Array.from(grouped.entries()).sort((a, b) =>
      a[0].localeCompare(b[0]),
    );

    for (const [doctor, logs] of sortedDoctors) {
      logs.sort((a, b) => a.timestampUtc.getTime() - b.timestampUtc.getTime());
      const sheetName = this.sanitiseWorksheetName(workbook, doctor);
      const sheet = workbook.addWorksheet(sheetName);
      sheet.columns = [
        { header: 'Date', key: 'date', width: 14 },
        { header: 'Time', key: 'time', width: 14 },
        { header: 'Action', key: 'action', width: 10 },
        { header: 'Device', key: 'device', width: 26 },
      ];
      sheet.views = [{ state: 'frozen', ySplit: 1 }];

      for (const log of logs) {
        const local = DateTime.fromJSDate(log.timestampUtc, { zone: 'utc' }).setZone(CLINIC_TZ);
        sheet.addRow({
          date: local.toFormat('yyyy-MM-dd'),
          time: local.toFormat('hh:mm:ss a'),
          action: log.action,
          device: log.device?.name ?? '',
        });
      }

      const daySummary = this.buildDoctorDaySummary(logs, rangeStart, rangeEnd);
      const totalMinutes = daySummary.reduce((sum, d) => sum + d.workedMinutes, 0);
      const workedDays = daySummary.filter((d) => d.workedMinutes > 0).length;
      summaryRows.push({ doctor, totalMinutes, workedDays });

      sheet.addRow([]);
      sheet.addRow(['Daily summary']);
      sheet.addRow(['Date', 'Weekday', 'First IN', 'Last OUT', 'Hours']);
      for (const day of daySummary) {
        sheet.addRow([
          day.date.toFormat('yyyy-MM-dd'),
          day.date.toFormat('ccc'),
          day.firstIn ? day.firstIn.toFormat('hh:mm a') : '',
          day.lastOut ? day.lastOut.toFormat('hh:mm a') : '',
          day.workedMinutes > 0 ? this.formatMinutes(day.workedMinutes) : '',
        ]);
      }
      sheet.addRow([]);
      sheet.addRow(['Totals', '', '', '', this.formatMinutes(totalMinutes)]);
      sheet.addRow(['Worked days', '', '', '', workedDays]);
      sheet.addRow([
        'Average per worked day',
        '',
        '',
        '',
        workedDays > 0 ? this.formatMinutes(Math.floor(totalMinutes / workedDays)) : '-',
      ]);
    }

    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.columns = [
      { header: 'Doctor', key: 'doctor', width: 32 },
      { header: 'Worked days', key: 'days', width: 16 },
      { header: 'Total hours', key: 'hours', width: 16 },
      { header: 'Average / worked day', key: 'avg', width: 18 },
    ];
    summarySheet.views = [{ state: 'frozen', ySplit: 1 }];

    const orderedSummary = summaryRows.sort((a, b) => a.doctor.localeCompare(b.doctor));
    for (const row of orderedSummary) {
      summarySheet.addRow({
        doctor: row.doctor,
        days: row.workedDays,
        hours: this.formatMinutes(row.totalMinutes),
        avg:
          row.workedDays > 0
            ? this.formatMinutes(Math.floor(row.totalMinutes / row.workedDays))
            : '-',
      });
    }

    summarySheet.addRow([]);
    summarySheet.addRow(['Range start', rangeStart.toFormat('yyyy-MM-dd')]);
    summarySheet.addRow(['Range end', rangeEnd.toFormat('yyyy-MM-dd')]);

    return workbook;
  }

  private async workbookToBuffer(workbook: ExcelJS.Workbook) {
    const raw = await workbook.xlsx.writeBuffer();
    return Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
  }

  private sanitiseWorksheetName(workbook: ExcelJS.Workbook, rawName: string) {
    const forbidden = /[\\/?*[\]:]/g;
    let base = rawName.replace(forbidden, ' ').trim();
    if (!base) base = 'Doctor';
    if (base.length > 31) {
      base = base.substring(0, 31).trim();
    }
    let attempt = base;
    let counter = 2;
    while (workbook.getWorksheet(attempt)) {
      const suffix = ` (${counter})`;
      const trimmedLength = Math.min(31 - suffix.length, base.length);
      attempt = `${base.substring(0, trimmedLength)}${suffix}`;
      counter++;
    }
    return attempt;
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


