import { Context, SessionFlavor } from 'grammy';
import { BotSession } from './session';

/**
 * Bot context — carries the FSM session. We attach the session lazily via a
 * middleware-ish helper in handlers (sessions.get(chatId)) rather than grammy's
 * session flavor wiring, to keep NestJS DI as the single source of truth.
 */
export type BotContext = Context & SessionFlavor<BotSession>;
