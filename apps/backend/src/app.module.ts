import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PoisModule } from './pois/pois.module';
import { RoutingModule } from './routing/routing.module';
import { RoutesModule } from './routes/routes.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { TelegramModule } from './telegram/telegram.module';
import { UsersService } from './users/users.service';
import { ItineraryModule } from './itineraries/itinerary.module';
import { isProduction } from './common/app-config';
import { BuildModule } from './build/build.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    BuildModule,
    DatabaseModule,
    AuthModule,
    UsersModule,
    PoisModule,
    RoutingModule,
    RoutesModule,
    AnalyticsModule,
    TelegramModule,
    ItineraryModule,
  ],
})
export class AppModule implements OnModuleInit {
  private readonly logger = new Logger(AppModule.name);

  constructor(
    private readonly usersService: UsersService,
  ) {}

  async onModuleInit() {
    // Seed default admin on startup if no users exist
    await this.seedAdmin();
    this.logger.log('Database seeded if needed.');
  }

  /**
   * Creates the first admin account on an empty database.
   *
   * Security (release CRIT): production must NEVER fall back to the
   * well-known dev credentials. If the production DB is empty and
   * ADMIN_LOGIN/ADMIN_PASSWORD are not explicitly set, startup fails
   * (fail closed). Dev keeps the documented non-secret defaults from
   * `apps/backend/.env.example`. The password is never logged.
   */
  private async seedAdmin() {
    const count = await this.usersService.count();
    if (count.total > 0) return;

    let login = process.env.ADMIN_LOGIN;
    let password = process.env.ADMIN_PASSWORD;

    if (isProduction()) {
      if (!login || !password) {
        throw new Error(
          'Cannot seed the first admin in production: ADMIN_LOGIN and ADMIN_PASSWORD must be explicitly set.',
        );
      }
    } else {
      // Dev-only fallback: documented in apps/backend/.env.example. These are
      // known, non-secret development defaults — never used in production.
      login = login || 'admin';
      password = password || 'admin';
    }

    try {
      await this.usersService.create({ login, password, role: 'admin' });
      this.logger.log(
        `Admin "${login}" created.` + (isProduction() ? '' : ' (dev defaults — see apps/backend/.env.example)'),
      );
    } catch (e: any) {
      // User already exists (race condition during seed)
      this.logger.log(`Admin "${login}" already exists.`);
    }
  }
}
