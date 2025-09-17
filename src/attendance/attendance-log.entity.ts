import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn, Index } from 'typeorm';
import { User } from '../users/user.entity';
import { Device } from '../devices/device.entity';

export type AttendanceAction = 'IN' | 'OUT';
export type AttendanceSource = 'KIOSK' | 'ADMIN' | 'API';

@Entity({ name: 'attendance_logs' })
@Index('attendance_user_ts_idx', ['user', 'timestampUtc'])
export class AttendanceLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (u) => u.attendanceLogs, { eager: false, nullable: false })
  user: User;

  @ManyToOne(() => Device, (d) => d.logs, { eager: false, nullable: true })
  device?: Device | null;

  @Column({ name: 'timestamp_utc', type: 'timestamptz', default: () => 'NOW()' })
  timestampUtc: Date;

  @Column({ type: 'varchar', length: 6 })
  action: AttendanceAction; // 'IN' | 'OUT'

  @Column({ type: 'varchar', length: 10, default: 'KIOSK' })
  source: AttendanceSource;

  @Column({ type: 'varchar', length: 240, nullable: true })
  notes?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
