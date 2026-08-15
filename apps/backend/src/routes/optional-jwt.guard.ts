import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Optional JWT auth: if a valid Bearer token is present, `req.user` is populated
 * (so `POST /api/routes` can attach a userId). If no token is present, the
 * request proceeds anonymously (req.user = undefined) — the route is still saved
 * with userId = null and gets a shareable link.
 *
 * Used by create-route so logged-in users keep their routes under their account
 * while anonymous visitors can still save + share.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const authHeader: string | undefined =
      req.headers?.authorization || req.headers?.Authorization;
    // No Bearer token → continue as anonymous.
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return true;
    }
    // Token present → run the jwt strategy (populates req.user).
    return super.canActivate(context);
  }

  /** Never hard-fail: an invalid/expired token just means "anonymous". */
  handleRequest<TUser = any>(_err: any, user: any): TUser {
    return user as TUser;
  }
}
