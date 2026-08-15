import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AdminGuard } from './admin.guard';
import { UsersModule } from '../users/users.module';
import { jwtSecret } from '../common/app-config';

@Module({
  imports: [
    UsersModule,
    PassportModule.register({}),
    JwtModule.register({
      // Fails closed in production (throws at module init) when JWT_SECRET
      // is absent or still the dev default.
      secret: jwtSecret(),
      signOptions: { expiresIn: '24h' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, JwtAuthGuard, AdminGuard],
  exports: [AuthService, JwtAuthGuard, AdminGuard],
})
export class AuthModule {}
