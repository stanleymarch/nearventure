import {
  Controller,
  Patch,
  Delete,
  Post,
  Param,
  Body,
  UseGuards,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/admin.guard';
import { PoisService } from './pois.service';
import { UpdatePoiDto } from './dto/update-poi.dto';
import { diskStorage } from 'multer';
import { extname, join } from 'path';

/**
 * Admin-only POI editing endpoints.
 * Requires JWT authentication + admin role.
 */
@UseGuards(AuthGuard('jwt'), AdminGuard)
@Controller('admin/pois')
export class AdminPoisController {
  constructor(private readonly poisService: PoisService) {}

  /**
   * Upsert override fields for a POI.
   * Only the provided fields are written; omitted fields keep existing values.
   * Pass `null` explicitly to clear a field and revert to pipeline data.
   */
  @Patch(':id')
  async updatePoi(@Param('id') id: string, @Body() dto: UpdatePoiDto) {
    await this.poisService.updateOverride(id, {
      display_name: dto.display_name,
      description: dto.description,
      image_url: dto.image_url,
      image_attribution: dto.image_attribution,
      osm_contributor: dto.osm_contributor,
      updated_by: 'admin',
    });
    return this.poisService.byId(id);
  }

  /**
   * Remove all manual overrides for a POI, reverting to pipeline data.
   */
  @Delete(':id/overrides')
  async deleteOverrides(@Param('id') id: string) {
    await this.poisService.deleteOverride(id);
    return this.poisService.byId(id);
  }

  /**
   * Upload a photo directly to the server.
   * Stores the file in the media directory and updates poi_overrides.image_url
   * to the local path.
   */
  @Post(':id/media')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: join(process.cwd(), 'media', 'poi'),
        filename: (_req: any, file: any, cb: Function) => {
          const ext = extname(file.originalname) || '.jpg';
          cb(null, `${_req.params?.id || 'unknown'}${ext}`);
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    }),
  )
  async uploadMedia(@Param('id') id: string, @UploadedFile() file: any) {
    if (!file) throw new BadRequestException('Файл не загружен');

    const localUrl = `/media/poi/${file.filename}`;
    await this.poisService.updateOverride(id, {
      image_url: localUrl,
      updated_by: 'admin',
    });
    return { imageUrl: localUrl, poi: await this.poisService.byId(id) };
  }
}
