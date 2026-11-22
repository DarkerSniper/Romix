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
| 2 | Electron desktop shell, real link import with yt-dlp (metadata, covers, errors, cache) | ✅ Done |
| 3 | Download and convert to CD audio (ffmpeg + soxr), preview player, gaps and crossfade, loudness | Planned |
| 4 | Drive detection, burning (IMAPI2 / cdrdao with CD-Text), burn speed, verify, saved projects and copies | Planned |
| 5 | Printable inserts (cover, tracklist, disc label), shelf of past discs, clip-to-fit trimming, mix flow sorting, installer | Planned |

## Development

Requirements:

- **Node.js 22 or newer.** It runs the dev tools, and yt-dlp uses it to solve YouTube's JavaScript challenges. If it isn't first on your PATH, point Romix at it in **Settings → YouTube engine**, or set `ROMIX_NODE` to the full path of `node.exe`.
- Windows (the burner backends in milestone 4 are Windows-only).

```bash
npm install
npm run fetch-bins   # downloads yt-dlp.exe into ./bin and verifies its checksum
npm run app          # desktop app (Electron) with real YouTube import
npm run dev          # browser-only UI preview with sample songs, http://localhost:1420
npm test             # unit tests
npm run test:live    # end-to-end check against live YouTube links
```

### How link import works

The Electron main process runs `yt-dlp --dump-json --skip-download` for each link (3 at a time, with one retry), cleans up the title and artist, fetches the best cover, and caches the result. The UI talks to it only through a five-function bridge (`window.romix`); the renderer is sandboxed with no Node access.

## Note

Downloading from YouTube may go against YouTube's Terms of Service. Romix is meant for personal use with music you have the right to copy.

## License

MIT
