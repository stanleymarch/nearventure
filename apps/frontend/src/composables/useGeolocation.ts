import { ref } from 'vue';

export interface GeoPoint {
  lat: number;
  lng: number;
}

/**
 * Browser geolocation wrapper with a reactive state. Returns a promise that
 * resolves to the position (or rejects) so callers can fly the map + route.
 */
const lastKnown = ref<GeoPoint | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

export function useGeolocation() {
  async function locate(): Promise<GeoPoint> {
    if (!('geolocation' in navigator)) {
      error.value = 'Геолокация не поддерживается этим браузером';
      throw new Error(error.value as string);
    }
    loading.value = true;
    error.value = null;
    return new Promise<GeoPoint>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const point = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          lastKnown.value = point;
          loading.value = false;
          resolve(point);
        },
        (err) => {
          loading.value = false;
          error.value =
            err.code === err.PERMISSION_DENIED
              ? 'Доступ к геолокации запрещён'
              : 'Не удалось определить местоположение';
          reject(new Error(error.value as string));
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
      );
    });
  }

  return { lastKnown, loading, error, locate };
}

/** Estimate a reasonable round-trip distance (meters) from a time budget + profile.
 *  mtb uses the same speed as generic bike (terrain-adjusted). */
export function budgetToDistance(minutes: number, profile: string): number {
  // Должно совпадать с Telegram-bot getTransportSpeed()
  const speeds: Record<string, number> = { bike: 15, mtb: 12, foot: 5, car: 40 }; // km/h
  const hours = minutes / 60;
  return Math.round((speeds[profile] ?? 15) * hours * 1000);
}

export function formatMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h <= 0) return `${m} МИН`;
  const hWord = h === 1 ? 'ЧАС' : h < 5 ? 'ЧАСА' : 'ЧАСОВ';
  return m > 0 ? `${h} ${hWord} ${m} МИН` : `${h} ${hWord}`;
}
