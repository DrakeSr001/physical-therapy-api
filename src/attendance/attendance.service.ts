import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository, DataSource } from 'typeorm';
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
    private readonly dataSource: DataSource,
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

    const tz = 'Africa/Cairo';
    const nowUtc = DateTime.utc();
    const nowLocal = nowUtc.setZone(tz);
    const autoClose = (process.env.AUTO_CLOSE_PREVIOUS_DAY ?? 'true') === 'true';

    // Transaction to avoid race conditions (double scans)
    try {
      return await this.dataSource.transaction(async (manager) => {
        // Lock the last log row for this user
        const last = await manager
          .getRepository(AttendanceLog)
          .createQueryBuilder('log')
          .setLock('pessimistic_write')
          .where('log.userId = :uid', { uid: user.id })
          .orderBy('log.timestampUtc', 'DESC')
          .getOne();

        const lastLocal = last
          ? DateTime.fromJSDate(last.timestampUtc, { zone: 'utc' }).setZone(tz)
          : null;

        const repo = manager.getRepository(AttendanceLog);

        // Helper: create log row
        const write = async (action: 'IN' | 'OUT', src: 'KIOSK' | 'API', tsUtc: Date) => {
          const log = repo.create({
            user,
            device,
            action,
            source: src,
            timestampUtc: tsUtc,
          });
          await repo.save(log);
          return log;
        };

        if (!last) {
          // First scan ever -> start the day
          const saved = await write('IN', 'KIOSK', nowUtc.toJSDate());
          return { action: saved.action, at: saved.timestampUtc.toISOString() };
        }

        if (last.action === 'OUT') {
          if (lastLocal && lastLocal.toISODate() === nowLocal.toISODate()) {
            throw new BadRequestException('daily_limit_reached');
          }
          const saved = await write('IN', 'KIOSK', nowUtc.toJSDate());
          return { action: saved.action, at: saved.timestampUtc.toISOString() };
        }

        // There is an open session (last.action === 'IN')
        const sameDay = lastLocal!.toISODate() === nowLocal.toISODate();

        if (sameDay) {
          // Normal close of today's session
          const saved = await write('OUT', 'KIOSK', nowUtc.toJSDate());
          return { action: saved.action, at: saved.timestampUtc.toISOString() };
        }

        // Day changed and last IN belongs to a previous day
        if (autoClose) {
          // Auto close yesterday at 23:59:59 local time
          const closeLocal = lastLocal!.endOf('day'); // 23:59:59.999
          const closeUtc = closeLocal.toUTC().toJSDate();
          await write('OUT', 'API', closeUtc);

          // Start a new session now (IN)
          const savedIn = await write('IN', 'KIOSK', nowUtc.toJSDate());
          return { action: savedIn.action, at: savedIn.timestampUtc.toISOString(), autoClosed: true };
        }

        // If not auto-closing, we enforce: must OUT first, but stamp with now (even if next day)
        const savedOut = await write('OUT', 'KIOSK', nowUtc.toJSDate());
        return {
          action: savedOut.action,
          at: savedOut.timestampUtc.toISOString(),
          note: 'closed previous open session',
        };
      });
    } catch (err) {
      console.error('attendance.scan error', err);
      throw err;
    }
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
   * Month summary: for each local day, first IN and last OUT times, plus worked hours.
   */
  async monthSummary(userId: string, year: number, month: number, tz = 'Africa/Cairo') {
    if (!year || !month || month < 1 || month > 12) {
      throw new BadRequestException('invalid_year_or_month');
    }

    const startLocal = DateTime.fromObject({ year, month, day: 1 }, { zone: tz }).startOf('day');
    const endLocal = startLocal.plus({ months: 1 });

    const rows = await this.logs.find({
      where: { user: { id: userId }, timestampUtc: Between(startLocal.toUTC().toJSDate(), endLocal.toUTC().toJSDate()) },
      order: { timestampUtc: 'ASC' },
    });

    const daysInMonth = startLocal.daysInMonth!;
    type DayAgg = { firstIn?: DateTime; lastOut?: DateTime; workedMs: number };
    const perDay: DayAgg[] = Array.from({ length: daysInMonth }, () => ({ workedMs: 0 }));

    // First pass: compute first IN and last OUT per day
    for (const r of rows) {
      const local = DateTime.fromJSDate(r.timestampUtc, { zone: 'utc' }).setZone(tz);
      if (local.month !== month || local.year !== year) continue;
      const idx = local.day - 1;
      if (idx < 0 || idx >= daysInMonth) continue;

      if (r.action === 'IN') {
        if (!perDay[idx].firstIn || local < perDay[idx].firstIn!) perDay[idx].firstIn = local;
      } else if (r.action === 'OUT') {
        if (!perDay[idx].lastOut || local > perDay[idx].lastOut!) perDay[idx].lastOut = local;
      }
    }

    // Second pass: compute workedMs (first IN + last OUT; floor negative to 0)
    let totalMs = 0;
    for (let i = 0; i < daysInMonth; i++) {
      const fin = perDay[i].firstIn;
      const lout = perDay[i].lastOut;
      if (fin && lout && lout > fin) {
        const ms = lout.toMillis() - fin.toMillis();
        perDay[i].workedMs = ms;
        totalMs += ms;
      } else {
        perDay[i].workedMs = 0;
      }
    }

    // Format helpers
    const fmtHm = (ms: number) => {
      const mins = Math.floor(ms / 60000);
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };

    const days = Array.from({ length: daysInMonth }, (_, i) => {
      const date = DateTime.fromObject({ year, month, day: i + 1 }, { zone: tz });
      const fin = perDay[i].firstIn ? perDay[i].firstIn!.toFormat('hh:mm:ss a') : null;
      const lout = perDay[i].lastOut ? perDay[i].lastOut!.toFormat('hh:mm:ss a') : null;
      const hours = fmtHm(perDay[i].workedMs);
      return { date: date.toISODate()!, in: fin, out: lout, hours };
    });

    return { year, month, timezone: tz, totalHours: fmtHm(totalMs), days };
  }
}