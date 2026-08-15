import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';

const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

/** Public build provenance, intentionally independent of GraphHopper health. */
@Public()
@ApiTags('build')
@Controller('build')
export class BuildController {
  @Get()
  @Header('Cache-Control', 'no-store')
  getBuildRevision(): { buildRevision: string | null } {
    const revision = process.env.GIT_SHA;
    return { buildRevision: revision && GIT_SHA_PATTERN.test(revision) ? revision : null };
  }
}
