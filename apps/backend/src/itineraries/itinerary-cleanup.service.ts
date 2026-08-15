import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { ItineraryDraftEntity } from './entities/itinerary-draft.entity';
@Injectable()
export class ItineraryCleanupService {
  constructor(@InjectRepository(ItineraryDraftEntity) private readonly drafts: Repository<ItineraryDraftEntity>) {}
  @Cron('0 * * * *') async removeExpired(): Promise<void> { await this.drafts.delete({ expiresAt: LessThan(new Date()) }); }
}
