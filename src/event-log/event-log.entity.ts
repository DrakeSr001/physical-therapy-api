import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

export type EventLogStatus = 'success' | 'error';

@Entity({ name: 'event_logs' })
@Index('event_logs_created_idx', ['createdAt'])
export class EventLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, { nullable: true })
  user?: User | null;

  @Column({ type: 'varchar', length: 80 })
  action!: string;

  @Column({ type: 'varchar', length: 16 })
  status!: EventLogStatus;

  @Column({ type: 'varchar', length: 240, nullable: true })
  message?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  details?: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
