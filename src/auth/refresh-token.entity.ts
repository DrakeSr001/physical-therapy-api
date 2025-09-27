import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

@Entity({ name: 'refresh_tokens' })
@Index('refresh_token_user_device_uq', ['user', 'deviceIdentifierHash'], { unique: true })
@Index('refresh_token_hash_uq', ['tokenHash'], { unique: true })
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, (user) => user.refreshTokens, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  user!: User;

  @Column({ type: 'varchar', length: 128 })
  deviceIdentifierHash!: string;

  @Column({ type: 'varchar', length: 128 })
  tokenHash!: string;

  @Column({ type: 'boolean', default: false })
  isPersistent!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt?: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt?: Date | null;
}
