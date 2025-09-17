import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn, Index } from 'typeorm';
import { AttendanceLog } from '../attendance/attendance-log.entity';
import { KioskCode } from '../kiosk/kiosk-code.entity';

@Entity({ name: 'devices' })
@Index('devices_apikey_uq', ['apiKey'], { unique: true })
export class Device {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 160, nullable: true })
  location?: string | null;

  @Column({ name: 'api_key', type: 'varchar', length: 200, unique: true })
  apiKey: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @OneToMany(() => AttendanceLog, (log) => log.device)
  logs: AttendanceLog[];

  @OneToMany(() => KioskCode, (kc) => kc.device)
  kioskCodes: KioskCode[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
