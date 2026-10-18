import * as Location from 'expo-location';
import { useSyncExternalStore } from 'react';

import { signalSources } from '@/lib/nudges/settings';
import { readJSON, writeJSON } from '@/lib/storage';

/**
 * Places you've named ("Office", "Home"). Arriving at or leaving one becomes a `location` signal,
 * so reminders like "when I get to the office" can fire. Coordinates stay on this phone: only the
 * place's name is ever sent.
 */
export type Place = { id: string; name: string; latitude: number; longitude: number; radius: number; created_at: string };

/** Geofence events run this task (defined in nudges/engine.ts, which loads before the app). */
export const GEOFENCE_TASK = 'baymon-places-geofence';
const KEY = 'baymon.places';
const DEFAULT_RADIUS_M = 150;

let places: Place[] | null = null;
const listeners = new Set<() => void>();
const get = () => (places ??= readJSON<Place[]>(KEY) ?? []);

function set(next: Place[]) {
  places = next;
  writeJSON(KEY, next);
  listeners.forEach((l) => l());
  void syncGeofences();
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Metres between two points (haversine). */
export function distance(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export const placesStore = {
  list: get,

  find: (name: string) => get().find((p) => same(p.name, name)),

  /** The saved place you're at, if any. */
  at(point: { latitude: number; longitude: number }) {
    return get().find((p) => distance(p, point) <= p.radius);
  },

  /** Saves a place by name, at the given point or where the phone is now. Saving a name again moves it. */
  async save(name: string, point?: { latitude: number; longitude: number }, radius = DEFAULT_RADIUS_M) {
    const clean = name.trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!clean) throw new Error('Give the place a name.');
    let where = point;
    if (!where) {
      const { granted } = await Location.requestForegroundPermissionsAsync();
      if (!granted) throw new Error('Location permission is off. Allow it to save places.');
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      where = { latitude: position.coords.latitude, longitude: position.coords.longitude };
    }
    const place: Place = {
      id: get().find((p) => same(p.name, clean))?.id ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: clean,
      latitude: where.latitude,
      longitude: where.longitude,
      radius: Math.min(1_000, Math.max(75, Math.round(radius))),
      created_at: new Date().toISOString(),
    };
    set([...get().filter((p) => p.id !== place.id), place]);
    return place;
  },

  remove(idOrName: string) {
    const before = get();
    const next = before.filter((p) => p.id !== idOrName && !same(p.name, idOrName));
    if (next.length === before.length) return false;
    set(next);
    return true;
  },
};

export function usePlaces() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    get,
    get
  );
}

/** Whether arrive/leave alerts can run: places saved, the source on, and "Allow all the time" granted. */
export async function geofencingReady() {
  if (process.env.EXPO_OS !== 'android' && process.env.EXPO_OS !== 'ios') return false;
  if (!get().length || !signalSources.get().places) return false;
  try {
    return (await Location.getBackgroundPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** Keeps the OS geofences in step with the saved places. Safe to call often. */
export async function syncGeofences() {
  try {
    const started = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK).catch(() => false);
    if (!(await geofencingReady())) {
      if (started) await Location.stopGeofencingAsync(GEOFENCE_TASK);
      return;
    }
    // Starting again replaces the previous regions.
    await Location.startGeofencingAsync(
      GEOFENCE_TASK,
      get().map((p) => ({
        identifier: p.name,
        latitude: p.latitude,
        longitude: p.longitude,
        radius: p.radius,
        notifyOnEnter: true,
        notifyOnExit: true,
      }))
    );
  } catch {}
}
