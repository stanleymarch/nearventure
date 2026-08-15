import { Body, Controller, Get, Header, Headers, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { CreateItineraryDto } from './dto/create-itinerary.dto';
import { AcceptAdditionCommandDto, AcceptReplacementCommandDto, AddPoiCommandDto, ApplySmartFixCommandDto, AutoFillCommandDto, CommandDto, DiscardItineraryCommandDto, RemovePlaceCommandDto, ReorderCommandDto, ReplacePlaceCommandDto, RouteImpactDto, SelectAlternativeCommandDto, SetLockedCommandDto, SetVisitModeCommandDto, UpdateSettingsCommandDto } from './dto/itinerary-command.dto';
import { ItineraryDraftService } from './itinerary-draft.service';
import { ItineraryOwnerService } from './itinerary-owner.service';

@Public()
@ApiTags('itineraries')
@Controller('itineraries')
export class ItineraryController {
  constructor(private readonly drafts: ItineraryDraftService, private readonly owners: ItineraryOwnerService) {}

  @Post() create(@Headers('x-nv-client-id') clientId: string | undefined, @Headers('x-telegram-initdata') initData: string | undefined, @Body() dto: CreateItineraryDto) { return this.drafts.create(this.owner(clientId, initData), dto); }
  @Get(':id') get(@Headers('x-nv-client-id') clientId: string | undefined, @Headers('x-telegram-initdata') initData: string | undefined, @Param('id') id: string) { return this.drafts.get(this.owner(clientId, initData), id); }
  @Post(':id/commands/add-poi') addPoi(@Headers('x-nv-client-id') clientId: string | undefined, @Headers('x-telegram-initdata') initData: string | undefined, @Param('id') id: string, @Body() dto: AddPoiCommandDto) { return this.drafts.addPoi(this.owner(clientId, initData), id, dto); }
  @Post(':id/commands/remove-place') removePlace(@Headers('x-nv-client-id') clientId: string | undefined, @Headers('x-telegram-initdata') initData: string | undefined, @Param('id') id: string, @Body() dto: RemovePlaceCommandDto) { return this.drafts.removePlace(this.owner(clientId, initData), id, dto); }
  @Post(':id/commands/set-visit-mode') setVisitMode(@Headers('x-nv-client-id') clientId: string | undefined, @Headers('x-telegram-initdata') initData: string | undefined, @Param('id') id: string, @Body() dto: SetVisitModeCommandDto) { return this.drafts.setVisitMode(this.owner(clientId, initData), id, dto); }
  @Post(':id/commands/set-locked') setLocked(@Headers('x-nv-client-id') clientId: string | undefined, @Headers('x-telegram-initdata') initData: string | undefined, @Param('id') id: string, @Body() dto: SetLockedCommandDto) { return this.drafts.setLocked(this.owner(clientId, initData), id, dto); }
  @Post(':id/commands/reorder') reorder(@Headers('x-nv-client-id') clientId: string | undefined, @Headers('x-telegram-initdata') initData: string | undefined, @Param('id') id: string, @Body() dto: ReorderCommandDto) { return this.drafts.reorder(this.owner(clientId, initData), id, dto); }
  @Post(':id/commands/update-settings') updateSettings(@Headers('x-nv-client-id') clientId: string | undefined, @Headers('x-telegram-initdata') initData: string | undefined, @Param('id') id: string, @Body() dto: UpdateSettingsCommandDto) { return this.drafts.updateSettings(this.owner(clientId, initData), id, dto); }
  @Post(':id/commands/auto-fill') autoFill(@Headers('x-nv-client-id') clientId: string | undefined, @Headers('x-telegram-initdata') initData: string | undefined, @Param('id') id: string, @Body() dto: AutoFillCommandDto, @Req() req: any) { return this.drafts.autoFill(this.owner(clientId, initData), id, dto, this.abortSignal(req)); }
  @Post(':id/commands/regenerate') regenerate(@Headers('x-nv-client-id') clientId: string | undefined, @Headers('x-telegram-initdata') initData: string | undefined, @Param('id') id: string, @Body() dto: AutoFillCommandDto, @Req() req: any) { return this.drafts.regenerate(this.owner(clientId, initData), id, dto, this.abortSignal(req)); }
  @Post(':id/commands/select-alternative') selectAlternative(@Headers('x-nv-client-id') clientId: string | undefined, @Headers('x-telegram-initdata') initData: string | undefined, @Param('id') id: string, @Body() dto: SelectAlternativeCommandDto) { return this.drafts.selectAlternative(this.owner(clientId, initData), id, dto); }
  @Get(':id/alternatives/:alternativeId/preview') @Header('Cache-Control', 'private, no-store') previewAlternative(@Headers('x-nv-client-id') clientId: string | undefined, @Headers('x-telegram-initdata') initData: string | undefined, @Param('id') id: string, @Param('alternativeId') alternativeId: string, @Query('expectedVersion') expectedVersion: string) { return this.drafts.previewAlternative(this.owner(clientId, initData), id, alternativeId, Number(expectedVersion)); }
  @Post(':id/commands/apply-smart-fix') applySmartFix(@Headers('x-nv-client-id') clientId: string | undefined, @Headers('x-telegram-initdata') initData: string | undefined, @Param('id') id: string, @Body() dto: ApplySmartFixCommandDto) { return this.drafts.applySmartFix(this.owner(clientId, initData), id, dto); }
  @Post(':id/commands/accept-addition') acceptAddition(@Headers('x-nv-client-id') clientId: string | undefined, @Headers('x-telegram-initdata') initData: string | undefined, @Param('id') id: string, @Body() dto: AcceptAdditionCommandDto) { return this.drafts.acceptAddition(this.owner(clientId, initData), id, dto); }
  @Post(':id/commands/replace-place') replacePlace(@Headers('x-nv-client-id') clientId: string | undefined, @Headers('x-telegram-initdata') initData: string | undefined, @Param('id') id: string, @Body() dto: ReplacePlaceCommandDto) { return this.drafts.replacePlace(this.owner(clientId, initData), id, dto); }
  @Post(':id/commands/accept-replacement') acceptReplacement(@Headers('x-nv-client-id') clientId: string | undefined, @Headers('x-telegram-initdata') initData: string | undefined, @Param('id') id: string, @Body() dto: AcceptReplacementCommandDto) { return this.drafts.acceptReplacement(this.owner(clientId, initData), id, dto); }
  @Post(':id/route-impact') routeImpact(@Headers('x-nv-client-id') clientId: string | undefined, @Headers('x-telegram-initdata') initData: string | undefined, @Param('id') id: string, @Body() dto: RouteImpactDto) { return this.drafts.routeImpact(this.owner(clientId, initData), id, dto.poiIds); }
  @Post(':id/commands/replan') replan(@Headers('x-nv-client-id') clientId: string | undefined, @Headers('x-telegram-initdata') initData: string | undefined, @Param('id') id: string, @Body() dto: CommandDto) { return this.drafts.replan(this.owner(clientId, initData), id, dto); }
  @Post(':id/commands/undo') undo(@Headers('x-nv-client-id') clientId: string | undefined, @Headers('x-telegram-initdata') initData: string | undefined, @Param('id') id: string, @Body() dto: CommandDto) { return this.drafts.undo(this.owner(clientId, initData), id, dto); }
  @Post(':id/commands/publish') publish(@Headers('x-nv-client-id') clientId: string | undefined, @Headers('x-telegram-initdata') initData: string | undefined, @Param('id') id: string, @Body() dto: CommandDto) { return this.drafts.publish(this.owner(clientId, initData), id, dto); }
  @Post(':id/commands/discard') @HttpCode(204) async discard(@Headers('x-nv-client-id') clientId: string | undefined, @Headers('x-telegram-initdata') initData: string | undefined, @Param('id') id: string, @Body() dto: DiscardItineraryCommandDto): Promise<void> { await this.drafts.discard(this.owner(clientId, initData), id, dto); }

  private owner(clientId?: string, initData?: string): string { return this.owners.resolve(clientId, initData).key; }
  private abortSignal(req: any): AbortSignal {
    const controller = new AbortController();
    req.once?.('aborted', () => controller.abort(new Error('Client disconnected')));
    req.once?.('close', () => { if (!req.complete) controller.abort(new Error('Client disconnected')); });
    return controller.signal;
  }
}
