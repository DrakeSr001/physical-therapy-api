import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Device } from '../devices/device.entity';

@Entity({ name: 'kiosk_codes' })
@Index('kiosk_code_code_uq', ['code'], { unique: true })
@Index('kiosk_code_exp_idx', ['expiresAt'])
export class KioskCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // short-lived opaque string or JWT
  @Column({ type: 'varchar', length: 300 })
  code: string;

  @ManyToOne(() => Device, (d) => d.kioskCodes, { nullable: false })
  device: Device;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'is_used', type: 'boolean', default: false })
  isUsed: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
