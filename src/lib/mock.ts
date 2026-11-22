import type { Track } from "../types";
import { makeCover } from "./covers";

/**
 * Stand-in metadata until the yt-dlp resolver lands (milestone 2).
 * Titles and artists are invented.
 */
const CATALOG: Array<[string, string, number]> = [
  ["Glass Harbor", "Neon Atlas", 243],
  ["Slow Satellites", "Wren & The Tides", 318],
  ["Paper Moons", "Kaito Vale", 205],
  ["Afterglow District", "Lumen Park", 276],
  ["Coastline Static", "Juniper Ray", 362],
  ["Velvet Engine", "Mono Orchard", 228],
  ["Northern Fields", "Sable Youth", 291],
  ["Cassette Summer", "The Drift Society", 254],
  ["Low Orbit", "Ari Calder", 412],
  ["Honey & Chrome", "Pale Lagoon", 199],
  ["Midnight Laundromat", "Cosmo Hart", 237],
  ["Weightless", "Silver Fern", 344],
  ["Sundial", "Echo Valley", 266],
  ["Polaroid Rain", "Nova Kid", 183],
];

let cursor = 0;

export function mockMetadata(seed: string): Pick<Track, "title" | "artist" | "durationSec" | "cover" | "color"> {
  const [title, artist, durationSec] = CATALOG[cursor++ % CATALOG.length];
  const { cover, color } = makeCover(seed + title);
  return { title, artist, durationSec, cover, color };
}

export function initialTracks(): Track[] {
  return ["dQw4w9WgXcA", "kJQP7kiw5Fk", "9bZkp7q19f0", "3JZ_D3ELwOQ", "L_jWHffIx5E"].map((videoId) => ({
    id: crypto.randomUUID(),
    videoId,
    url: `https://music.youtube.com/watch?v=${videoId}`,
    source: "youtube" as const,
    status: "ready" as const,
    ...mockMetadata(videoId),
  }));
}
