import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { AttendanceService } from './attendance.service';
import { ScanDto } from './dto/scan.dto';
import { HistoryQuery } from './dto/history.query';

@Controller('attendance')
export class AttendanceController {
  constructor(private readonly svc: AttendanceService) {}

  /**
   * Doctor scans a kiosk QR code (requires Bearer JWT).
   * Body: { code: string }
   */
  @UseGuards(AuthGuard('jwt'))
  @Throttle({ default: { limit: 30, ttl: 60_000 } }) // 30 req/min
  @Post('scan')
  async scan(@Req() req: any, @Body() body: ScanDto) {
    const dto = plainToInstance(ScanDto, body);
    try {
      await validateOrReject(dto);
    } catch {
      throw new BadRequestException('invalid_body');
    }
    const userId = req.user.userId; // from JwtStrategy.validate()
    return this.svc.scan(userId, dto.code);
  }

  /**
   * Raw history (paginated), newest first.
   * Query: ?limit=30&offset=0
   */
  @UseGuards(AuthGuard('jwt'))
  @Get('my')
  async my(@Req() req: any, @Query() query: HistoryQuery) {
    const dto = plainToInstance(HistoryQuery, query);
    try {
      await validateOrReject(dto);
    } catch {
      throw new BadRequestException('invalid_query');
    }
    return this.svc.myHistory(req.user.userId, dto.limit, dto.offset);
  }

  /**
   * Month summary: one row per local day with first IN / last OUT.
   * Query: ?year=2025&month=9
   */
  @UseGuards(AuthGuard('jwt'))
  @Get('my-month')
  async myMonth(@Req() req: any, @Query('year') year?: string, @Query('month') month?: string) {
    const y = Number(year);
    const m = Number(month);
    if (!y || !m || m < 1 || m > 12) throw new BadRequestException('year/month required');
    return this.svc.monthSummary(req.user.userId, y, m, 'Africa/Cairo');
  }
}
