import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RoutesService } from './routes.service';
import { RoutesCleanupService } from './routes-cleanup.service';
import { RoutesController } from './routes.controller';
import { GpxService } from './gpx.service';
import { RouteEntity } from './entities/route.entity';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';

@Module({
  // UsersModule provides UsersService consumed by the exported AdminGuard.
  imports: [TypeOrmModule.forFeature([RouteEntity]), AuthModule, UsersModule],
  controllers: [RoutesController],
  providers: [RoutesService, RoutesCleanupService, GpxService],
  exports: [RoutesService],
})
export class RoutesModule {}