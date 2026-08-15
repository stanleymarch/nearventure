import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, StrategyOptions } from 'passport-jwt';
import { AuthService } from './auth.service';
import { jwtSecret } from '../common/app-config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly authService: AuthService) {
    const opts: StrategyOptions = {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Fails closed in production (throws) when JWT_SECRET is absent.
      secretOrKey: jwtSecret(),
    };
    super(opts);
  }

  async validate(payload: any) {
    const user = await this.authService.validateJwtPayload(payload);
    if (!user) {
      throw new UnauthorizedException();
    }
    return { id: payload.sub, login: payload.login };
  }
}
