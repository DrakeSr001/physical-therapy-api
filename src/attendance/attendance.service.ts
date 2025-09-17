import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { DateTime } from 'luxon';

import { AttendanceLog } from './attendance-log.entity';
import { User } from '../users/user.entity';
import { KioskService } from '../kiosk/kiosk.service';

@Injectable()
export class AttendanceService {
  constructor(
    @InjectRepository(AttendanceLog) private readonly logs: Repository<AttendanceLog>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly kiosk: KioskService,
  ) {}

  /**
   * Toggle IN/OUT for a user after validating a short-lived kiosk code.
   */
  async scan(userId: string, code: string) {
    // 1) Validate the kiosk code (exists, not expired, not used), and consume it
    const res = await this.kiosk.validateAndConsume(code);
    if (!res.ok) throw new BadRequestException(res.reason);
    const device = res.device;

    // 2) Ensure user exists & active
    const user = await this.users.findOne({ where: { id: userId, isActive: true } });
    if (!user) throw new BadRequestException('user_not_found');

    // 3) Determine next action based on last log
    const last = await this.logs.findOne({
      where: { user: { id: user.id } },
      order: { timestampUtc: 'DESC' },
    });
    const nextAction: 'IN' | 'OUT' = last?.action === 'IN' ? 'OUT' : 'IN';

    // 4) Write log
    const log = this.logs.create({
      user,
      device,
      action: nextAction,
      source: 'KIOSK',
      // timestampUtc defaults to NOW()
    });
    await this.logs.save(log);

    return { action: nextAction, at: new Date().toISOString() };
  }

  /**
   * Paginated list of the user's raw logs (newest first).
   */
  async myHistory(userId: string, limit = 30, offset = 0) {
    const [rows, total] = await this.logs.findAndCount({
      where: { user: { id: userId } },
      order: { timestampUtc: 'DESC' },
      skip: offset,
      take: limit,
      relations: { device: true },
    });

    return {
      total,
      limit,
      offset,
      items: rows.map((r) => ({
        id: r.id,
        action: r.action,                                  // "IN" | "OUT"
        at: r.timestampUtc.toISOString(),                  // UTC ISO
        device: r.device ? { id: r.device.id, name: r.device.name } : null,
      })),
    };
  }

  /**
   * Month summary: for each local day, first IN and last OUT times.
   * Times are returned formatted (e.g., "09:02:52 AM") in the desired tz.
   */
  async monthSummary(userId: string, year: number, month: number, tz = 'Africa/Cairo') {
    if (!year || !month || month < 1 || month > 12) {
      throw new BadRequestException('invalid_year_or_month');
    }

    // Month start/end in target tz → convert to UTC for querying
    const startLocal = DateTime.fromObject({ year, month, day: 1 }, { zone: tz }).startOf('day');
    const endLocal = startLocal.plus({ months: 1 });
    const startUtc = startLocal.toUTC().toJSDate();
    const endUtc = endLocal.toUTC().toJSDate();

    // Pull all logs for that UTC window
    const rows = await this.logs.find({
      where: { user: { id: userId }, timestampUtc: Between(startUtc, endUtc) },
      order: { timestampUtc: 'ASC' },
    });

    const daysInMonth = startLocal.daysInMonth ?? 31;

    // Temp holders to compute earliest IN / latest OUT per day
    const perDay: Array<{ firstIn?: DateTime; lastOut?: DateTime }> = Array.from(
      { length: daysInMonth },
      () => ({}),
    );

    for (const r of rows) {
      // Convert each UTC timestamp to local tz and map to calendar day index
      const local = DateTime.fromJSDate(r.timestampUtc, { zone: 'utc' }).setZone(tz);
      const idx = local.day - 1; // 0-based
      if (idx < 0 || idx >= daysInMonth) continue;

      if (r.action === 'IN') {
        const cur = perDay[idx].firstIn;
        if (!cur || local < cur) perDay[idx].firstIn = local;
      } else if (r.action === 'OUT') {
        const cur = perDay[idx].lastOut;
        if (!cur || local > cur) perDay[idx].lastOut = local;
      }
    }

    // Build response (formatted strings)
    const days = Array.from({ length: daysInMonth }, (_, i) => {
      const date = DateTime.fromObject({ year, month, day: i + 1 }, { zone: tz });
      const firstIn = perDay[i].firstIn ? perDay[i].firstIn!.toFormat('hh:mm:ss a') : null;
      const lastOut = perDay[i].lastOut ? perDay[i].lastOut!.toFormat('hh:mm:ss a') : null;
      return {
        date: date.toISODate()!, // "YYYY-MM-DD"
        in: firstIn,
        out: lastOut,
      };
    });

    return { year, month, timezone: tz, days };
  }
}
