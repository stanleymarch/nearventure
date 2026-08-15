import { Controller, Get, Post, Patch, Delete, Param, Body, Query, Res, HttpException, HttpStatus, BadRequestException, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiProperty, ApiResponse as ApiSwaggerResponse } from '@nestjs/swagger';

import { RoutesService } from './routes.service';
import { CreateRouteDto, UpdateRouteDto } from './dto/create-route.dto';
import { CreateRouteFromMapDto } from './dto/create-route-from-map.dto';
import { GpxService } from './gpx.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import type { RoutingProfile, RouteResult } from '../routing/routing.types';

@ApiTags('routes')
@Controller('routes')
export class RoutesController {
  constructor(
    private readonly routesService: RoutesService,
    private readonly gpxService: GpxService,
  ) {}

  /**
   * Persist a route built on the map (frontend AdventureView).
   * Returns { id, createdAt } — the shareable id.
   */
  @Post()
  @ApiOperation({ summary: 'Create a route from map data (frontend).' })
  async createRoute(@Body() body: CreateRouteFromMapDto): Promise<{ id: string; createdAt: string }> {
    const route = await this.routesService.createRouteFromMap(body);
    return { id: route.id, createdAt: route.createdAt.toISOString() };
  }

  /**
   * Download a route as GPX 1.1.
   */
  @Get(':id/gpx')
  @ApiOperation({ summary: 'Download route as GPX.' })
  async downloadGpx(@Param('id') id: string, @Res() res: any): Promise<void> {
    const route = await this.routesService.getRouteEntity(id);
    if (!route) throw new HttpException('Route not found.', HttpStatus.NOT_FOUND);
    const geojson = route.geojson;
    const geometry = geojson?.features?.[0]?.geometry ?? geojson?.geometry ?? null;
    const gpx = this.gpxService.generate(geometry, route.title);
    // Increment gpxDownloads
    await this.routesService.incrementGpxDownloads(id);
    res.set('Content-Type', 'application/gpx+xml');
    res.set('Content-Disposition', `attachment; filename="${id}.gpx"`);
    res.send(gpx);
  }

  @Post('public')
  @ApiOperation({
    summary: 'Create a public route with shareable link',
    description: 'Creates a new route and returns a public URL. No auth required.',
  })
  @ApiSwaggerResponse({ status: 201, description: 'Public route created.' })
  async createPublicRoute(
    @Body() createRouteDto: CreateRouteDto,
    @Body('telegramChatId') telegramChatId?: string,
    @Body('anonymousId') anonymousId?: string,
    @Body('publicRequesterName') publicRequesterName?: string,
  ): Promise<{ routeId: string; publicUrl: string | null }> {
    this.assertSafeRequesterFields(telegramChatId, anonymousId, publicRequesterName);
    const result = await this.routesService.createPublicRoute(
      createRouteDto,
      {} as RouteResult,
      [],
      telegramChatId as string,
      publicRequesterName,
      anonymousId,
    );

    return {
      routeId: result.routeId,
      publicUrl: result.publicUrl,
    };
  }

  /**
   * The requester identifiers are persisted (createdBy) and later rendered on
   * the public share page — bound and restrict them so a spoofed body cannot
   * plant oversized or non-numeric values (release CRIT B-05: stored XSS /
   * text-field abuse via telegramChatId).
   */
  private assertSafeRequesterFields(
    telegramChatId?: string,
    anonymousId?: string,
    publicRequesterName?: string,
  ): void {
    if (telegramChatId !== undefined && telegramChatId !== null) {
      const s = String(telegramChatId).trim();
      if (!/^\d{1,64}$/.test(s)) {
        throw new BadRequestException(
          'telegramChatId must be a numeric chat id (up to 64 digits).',
        );
      }
    }
    if (anonymousId !== undefined && anonymousId !== null) {
      if (typeof anonymousId !== 'string' || anonymousId.length === 0 || anonymousId.length > 64) {
        throw new BadRequestException(
          'anonymousId must be a string of at most 64 characters.',
        );
      }
    }
    if (publicRequesterName !== undefined && publicRequesterName !== null) {
      if (typeof publicRequesterName !== 'string' || publicRequesterName.length > 200) {
        throw new BadRequestException(
          'publicRequesterName must be a string of at most 200 characters.',
        );
      }
    }
  }

  @Get('public')
  @ApiOperation({
    summary: 'Get route by public URL token',
    description: 'No auth required.',
  })
  @ApiSwaggerResponse({ status: 200, description: 'Route found.' })
  @ApiSwaggerResponse({ status: 404, description: 'Route not found or expired.' })
  async getRouteByPublicUrl(
    @Query('url') url: string,
    @Query('anonymousId') anonymousId?: string,
  ): Promise<any> {
    if (!url) {
      throw new BadRequestException('Query parameter "url" is required.');
    }
    const result = await this.routesService.getRouteByPublicUrl(url, anonymousId);
    if (!result.route) {
      throw new HttpException('Route not found or expired.', HttpStatus.NOT_FOUND);
    }

    return { ...result, route: this.routesService.toPublicRoute(result.route) };
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Get all routes statistics (public).',
    description: 'Returns total routes count and popular routes.',
  })
  @ApiSwaggerResponse({ status: 200, description: 'Statistics retrieved.' })
  async getRouteStats(
    @Query('includeExpired') includeExpired?: boolean,
  ): Promise<{
    totalRoutes: number;
    activeRoutes: number;
    expiredRoutes: number;
    popularRoutes: Array<{
      id: string;
      title: string;
      views: number;
      shares: number;
      downloads: number;
    }>;
  }> {
    const stats = await this.routesService.getRouteStats();
    return {
      totalRoutes: stats.totalRoutes,
      activeRoutes: stats.activeRoutes,
      expiredRoutes: includeExpired ? stats.expiredRoutes : 0,
      popularRoutes: stats.popularRoutes,
    };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get route by ID.',
    description: 'No auth required.',
  })
  @ApiSwaggerResponse({ status: 200, description: 'Route found.' })
  @ApiSwaggerResponse({ status: 404, description: 'Route not found.' })
  async getRoute(
    @Param('id') id: string,
    @Query('anonymousId') anonymousId?: string,
  ): Promise<any> {
    const result = await this.routesService.getRouteById(id, anonymousId);
    if (!result.route) {
      throw new HttpException('Route not found.', HttpStatus.NOT_FOUND);
    }
    return { ...result, route: this.routesService.toPublicRoute(result.route) };
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Update route (admin only).',
    description: 'Update title, status, hide/show route. Requires a valid admin JWT.',
  })
  @ApiSwaggerResponse({ status: 200, description: 'Route updated.' })
  @ApiSwaggerResponse({ status: 401, description: 'Not authenticated.' })
  @ApiSwaggerResponse({ status: 403, description: 'Not an admin.' })
  @ApiSwaggerResponse({ status: 404, description: 'Route not found.' })
  async updateRoute(
    @Param('id') id: string,
    @Body() updateRouteDto: UpdateRouteDto,
  ): Promise<any> {
    const route = await this.routesService.updateRoute(id, updateRouteDto);
    if (!route) {
      throw new HttpException('Route not found.', HttpStatus.NOT_FOUND);
    }
    return route;
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Delete route (admin only).',
    description: 'Delete route and all related analytics. Requires a valid admin JWT.',
  })
  @ApiSwaggerResponse({ status: 200, description: 'Route deleted.' })
  @ApiSwaggerResponse({ status: 401, description: 'Not authenticated.' })
  @ApiSwaggerResponse({ status: 403, description: 'Not an admin.' })
  async deleteRoute(
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    const success = await this.routesService.deleteRoute(id);
    return { success };
  }
}