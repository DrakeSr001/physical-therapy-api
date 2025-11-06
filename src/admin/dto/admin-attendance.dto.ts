import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { AttendanceAction } from '../../attendance/attendance-log.entity';

export class AdminCreateAttendanceDto {
  @IsUUID()
  userId!: string;

  @IsIn(['IN', 'OUT'])
  action!: AttendanceAction;

  @IsISO8601()
  timestamp!: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  notes?: string | null;
}

export class AdminUpdateAttendanceDto {
  @IsOptional()
  @IsIn(['IN', 'OUT'])
  action?: AttendanceAction;

  @IsOptional()
  @IsISO8601()
  timestamp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  notes?: string | null;
}
