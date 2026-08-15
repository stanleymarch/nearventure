import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PoiEntity } from './entities/poi.entity';
import { PoiOverride } from './entities/poi-override.entity';
import { PoisController } from './pois.controller';
import { AdminPoisController } from './admin-pois.controller';
import { PoisService } from './pois.service';
import { RemoteImageFetcherService } from './remote-image-fetcher.service';
import { AnalyticsModule } from '../analytics/analytics.module';
import { UsersModule } from '../users/users.module';

@Module({
  // AnalyticsModule: records `poi_viewed` events on byId() lookups.
  // UsersModule: provides UsersService consumed by AdminGuard.
  imports: [TypeOrmModule.forFeature([PoiEntity, PoiOverride]), AnalyticsModule, UsersModule],
  controllers: [PoisController, AdminPoisController],
  providers: [PoisService, RemoteImageFetcherService],
  exports: [PoisService],
})
export class PoisModule {}
