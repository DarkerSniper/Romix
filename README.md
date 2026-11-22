<p align="center">
  <img src="public/romix.svg" width="72" alt="Romix logo" />
</p>

<h1 align="center">Romix</h1>

<p align="center">Paste YouTube Music links, arrange your songs on a live disc, and burn a real audio CD at the best quality the format allows.</p>

---

## What it does

- **Paste links, get a disc.** Drop in one or many YouTube / YouTube Music links. Romix fetches the title, artist, cover and length.
- **A live disc you can see.** Every song is a slice of the disc sized by its share of the running time, filled with its cover art. Slices grow, slide and close up as you add, reorder and remove songs.
- **Capacity at a glance.** A ring around the disc fills toward 80 minutes and turns amber past 74 and red past 80.
- **Transitions.** Gapless, 2-second gaps, or a 1–8 second crossfade.
- **Even out loudness** between songs (optional).
- **Local files.** Drag audio files from your computer into the window to mix them in.
- **Native look.** Clean macOS-style design, dark mode by default, with Light and Auto in Settings.

## Audio quality

An audio CD is always 16-bit, 44.1 kHz stereo PCM (the Red Book standard). YouTube serves compressed audio (Opus or AAC), so Romix:

1. downloads the best stream available for each song,
2. decodes it once and resamples to 44.1 kHz with the SoX resampler,
3. applies dither to 16-bit, and
4. never re-compresses anywhere in between.

That gives the best possible CD from the source. It can't add back detail the source never had.

## Roadmap

| Milestone | Scope | Status |
| --- | --- | --- |
| 1 | UI shell: disc ring, track list, options, demo burn flow | ✅ Done |
| 2 | Real link import with yt-dlp (metadata, covers, errors, duplicates) | Planned |
| 3 | Download and convert to CD audio (ffmpeg + soxr), cache, preview player, gaps and crossfade, loudness | Planned |
| 4 | Tauri desktop shell, drive detection, burning (IMAPI2 / cdrdao with CD-Text), burn speed, verify, saved projects and copies | Planned |
| 5 | Printable inserts (cover, tracklist, disc label), shelf of past discs, clip-to-fit trimming, mix flow sorting, installer | Planned |

## Development

Requires Node 20+. The desktop shell (milestone 4) also needs Rust.

```bash
npm install
npm run dev        # http://localhost:1420
npm run typecheck
```

## Note

Downloading from YouTube may go against YouTube's Terms of Service. Romix is meant for personal use with music you have the right to copy.

## License

MIT
