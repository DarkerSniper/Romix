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
- **Hear it first.** Preview the whole disc exactly as it will be burned, with gaps and crossfades, while a playhead sweeps around the disc.
- **Burn and check.** Writes the disc in one pass with Windows' own burning engine (gapless, or standard 2-second gaps), then reads every track back and compares it bit for bit. Pick the speed, burn several copies, erase CD-RWs.
- **Make it fit.** Over 80 minutes? Trim silent intros and outros automatically, trim songs by hand on their waveform, or speed the disc up 2 % without changing pitch.
- **Sort for flow.** Romix works out each song's tempo and key and can reorder the disc so it flows like a DJ set.
- **Print the case.** Front cover, back tray card with the tracklist, and a round disc label at real CD sizes, as a PDF or straight to the printer.
- **Saved projects and a shelf.** Save discs to burn again later; every disc you burn lands on the Shelf.
- **Run and go.** On first launch Romix downloads the free tools it needs (yt-dlp, FFmpeg, Node.js) into its own folder, verifies each one, and shows you what it's doing.
- **Native look.** Clean macOS-style design, dark mode by default, with Light and Auto in Settings.

## Audio quality

An audio CD is always 16-bit, 44.1 kHz stereo PCM (the Red Book standard). YouTube serves compressed audio (Opus or AAC), so Romix:

1. downloads the best audio-only stream as-is,
2. decodes it once and resamples to 44.1 kHz with the SoX resampler (soxr) at its highest precision, keeping 32-bit float,
3. applies any crossfade and loudness gain in float,
4. quantises to 16-bit exactly once, with triangular (TPDF) dither, and
5. never re-compresses anywhere in between.

**Loudness evening** measures every song with EBU R128 and changes volume only (no compression or limiting). The disc's target is its median loudness, lowered if needed so no song is pushed above −1 dB true peak.

**Track boundaries** on a CD must fall on 1/75-second sectors. For gapless and crossfaded discs Romix moves each boundary forward by a few milliseconds of the next song instead of inserting silence, so the music never drops out between tracks. Silence padding is only used before a 2-second gap and at the very end.

That gives the best possible CD from the source. It can't add back detail the source never had.

## Roadmap

| Milestone | Scope | Status |
| --- | --- | --- |
| 1 | UI shell: disc ring, track list, options, demo burn flow | ✅ Done |
| 2 | Electron desktop shell, real link import with yt-dlp (metadata, covers, errors, cache) | ✅ Done |
| 3 | Built-in setup, download and convert to CD audio (FFmpeg + soxr), disc preview, gaps and crossfade, loudness | ✅ Done |
| 4 | Drive detection, burning (Windows IMAPI2, disc-at-once), burn speed, bit-exact verify, saved projects and copies | ✅ Built · real-disc test pending |
| 5 | Printable inserts, shelf of past discs, trim to fit, mix-flow sorting, cache clean-up, installer and portable ZIP | ✅ Done |

**Known limits:** CD-Text (titles on stereos) isn't supported by Windows' burning engine. Tempo and key detection is good on steady pop and dance music, less reliable on live, classical or tempo-changing songs, and sometimes picks the relative key (e.g. D major for B minor).

## Install

Download from Releases:

- **Romix-Setup-x.y.z.exe**: installer. Choose any folder; no admin rights needed.
- **Romix-x.y.z-x64.zip**: portable. Unzip anywhere and run `Romix.exe`.

On first launch Romix downloads its tools into a `data` folder next to `Romix.exe`. Everything Romix stores stays in that folder. Updating keeps it; uninstalling asks before deleting it.

The app isn't code-signed yet, so Windows may show "Windows protected your PC" the first time: choose **More info → Run anyway**.

## Development

Requirements: Windows and Node.js 22+ (for the dev tools only; the app downloads its own Node for yt-dlp).

```bash
npm run setup        # installs packages, with npm and Electron caches kept in ./.cache
npm run app          # desktop app; first launch installs yt-dlp, FFmpeg and Node into ./bin
npm run dev          # browser-only UI preview with sample songs, http://localhost:1420
npm test             # unit tests
npm run test:live    # end-to-end: setup, live YouTube, download, convert, analyse, build disc, check format and burn layout
npm run test:burn    # real burner: dry run; add "-- write" to burn 3 songs and verify them bit for bit
npm run dist         # Windows installer + portable ZIP into ./release (build caches stay in ./.cache)
```

### Everything stays in the project folder

Romix never writes to AppData, Temp or your user folder:

| What | Where |
| --- | --- |
| Settings, song info, downloaded audio, CD audio, Chromium profile, logs, temp files | `.data/` (an installed copy uses `data/` next to `Romix.exe`) |
| yt-dlp, FFmpeg, Node.js (installed by the app on first run) | `bin/` (installed copy: `data/bin/`) |
| npm and Electron download caches | `.cache/` (via `npm run setup` and `.npmrc`) |

All three are git-ignored. Deleting them resets Romix completely.

### How link import works

The Electron main process runs `yt-dlp --dump-json --skip-download` for each link (3 at a time, with one retry), cleans up the title and artist, fetches the best cover, and caches the result. Preparing then downloads the audio and converts it (2 at a time) in the background. The UI talks to the main process only through the `window.romix` bridge; the renderer is sandboxed with no Node access, and disc audio reaches it through a `romix-audio://` scheme that serves only finished disc files.

### Third-party tools

Downloaded at first run from their official sources and checked against the publishers' SHA-256 checksums: [yt-dlp](https://github.com/yt-dlp/yt-dlp) (Unlicense), [FFmpeg](https://github.com/BtbN/FFmpeg-Builds) (GPL build, licence in `bin/ffmpeg/LICENSE.txt`), [Node.js](https://nodejs.org) (MIT). They run as separate programs and aren't part of Romix's source.

The burner helper (`electron/burner/RomixBurner.cs`) is Romix's own code. It's compiled on first run with the C# compiler that ships with Windows (.NET Framework 4.8), so nothing extra is downloaded for burning.

## Note

Downloading from YouTube may go against YouTube's Terms of Service. Romix is meant for personal use with music you have the right to copy.

## License

MIT
