import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { DiscRequest, RenderResult, RenderedTrack } from "../src/shared/api";
import { planDisc, renderKey, SAMPLE_RATE, type PlanInput, type PlannedTrack } from "../src/lib/discPlan";
import { paths } from "./paths";
import { pcmPath, probeSamples, readPcmMeta } from "./prep";
import { ffmpegPath, spawnLines } from "./tools";

/** How one source is cut and (optionally) sped up before it enters the disc plan. */
interface Source {
  key: string;
  /** First and last sample used from the prepared audio. */
  from: number;
  to: number;
  /** Tempo factor (1 = unchanged; 1.02 = 2 % faster, pitch kept). */
  tempo: number;
  /** Length after trimming and tempo change, in samples. */
  samples: number;
}

/**
 * Builds the final per-track 16-bit files exactly as they will be burned:
 * trims and optional tempo change, then the disc plan's crossfades and boundary
 * borrowing, gain for loudness evening, one TPDF-dithered conversion to 16-bit
 * and sector padding. Each track is cached by a key of everything that affects it.
 */
export async function renderDisc(req: DiscRequest): Promise<RenderResult> {
  const tempo = 1 + Math.max(0, Math.min(3, req.options.speedPct ?? 0)) / 100;
  const sources: Source[] = [];
  const inputs: PlanInput[] = [];
  for (const key of req.keys) {
    const meta = await readPcmMeta(key);
    if (!meta) return { ok: false, message: "Some songs aren't ready yet" };
    const trim = req.trims?.[key];
    const from = trim ? Math.max(0, Math.round(trim.startSec * SAMPLE_RATE)) : 0;
    const to = trim ? Math.min(meta.samples, Math.round(trim.endSec * SAMPLE_RATE)) : meta.samples;
    if (to - from < SAMPLE_RATE) return { ok: false, message: "A trimmed song is shorter than a second" };
    const samples = Math.floor((to - from) / tempo);
    sources.push({ key, from, to, tempo, samples });
    inputs.push({ key, samples, lufs: meta.lufs, truePeakDb: meta.truePeakDb });
  }
  if (inputs.length === 0) return { ok: false, message: "Add some songs first" };

  const plan = planDisc(inputs, req.options);
  const out: RenderedTrack[] = [];
  for (const t of plan.tracks) {
    const src = sources[t.index];
    const next = sources[t.index + 1];
    const sig = (s?: Source) => (s ? `${s.key}@${s.from}-${s.to}x${s.tempo}` : "");
    const id = createHash("sha1").update(`${renderKey(t, next?.key)}|${sig(src)}|${t.crossfadeOut || t.borrowFromNext ? sig(next) : ""}`).digest("hex").slice(0, 24);
    const file = join(paths.disc, `${id}.wav`);
    if (!existsSync(file)) {
      const ok = await renderTrack(t, src, next, file);
      if (!ok.ok) return { ok: false, message: ok.message };
    }
    out.push({ key: t.key, url: `romix-audio://disc/${id}.wav`, samples: t.samples, pregap: t.pregap, startSample: t.startSample, gainDb: t.gainDb });
  }
  return { ok: true, tracks: out, totalSamples: plan.totalSamples, targetLufs: plan.targetLufs };
}

/** Filter that cuts a source to its trimmed range and applies the tempo change. */
const prepare = (input: number, s: Source, label: string) =>
  `[${input}:a]atrim=start_sample=${s.from}:end_sample=${s.to},asetpts=PTS-STARTPTS${s.tempo !== 1 ? `,atempo=${s.tempo}` : ""}[${label}]`;

async function renderTrack(t: PlannedTrack, src: Source, next: Source | undefined, file: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const usesNext = Boolean(next && (t.crossfadeOut || t.borrowFromNext));
  const args = ["-hide_banner", "-nostdin", "-y", "-i", pcmPath(src.key)];
  if (usesNext) args.push("-i", pcmPath(next!.key));

  const parts: string[] = [prepare(0, src, "s0"), `[s0]atrim=start_sample=${t.trimStart},asetpts=PTS-STARTPTS[a]`];
  let cur = "a";
  if (usesNext) {
    parts.push(prepare(1, next!, "s1"), `[s1]asplit=2[n1][n2]`);
    if (t.crossfadeOut) {
      parts.push(`[n1]atrim=end_sample=${t.crossfadeOut},asetpts=PTS-STARTPTS[head]`);
      // Equal-power curves keep the perceived level steady through the overlap.
      parts.push(`[${cur}][head]acrossfade=ns=${t.crossfadeOut}:c1=qsin:c2=qsin[x]`);
      cur = "x";
    } else {
      parts.push(`[n1]anullsink`);
    }
    if (t.borrowFromNext) {
      parts.push(`[n2]atrim=start_sample=${t.crossfadeOut}:end_sample=${t.crossfadeOut + t.borrowFromNext},asetpts=PTS-STARTPTS[bw]`);
      parts.push(`[${cur}][bw]concat=n=2:v=0:a=1[y]`);
      cur = "y";
    } else {
      parts.push(`[n2]anullsink`);
    }
  }
  // Gain (float), then the single quantisation to 16-bit with triangular (TPDF) dither,
  // then pad/trim to the exact planned length so every track is whole sectors.
  parts.push(`[${cur}]volume=${t.gainDb}dB,aresample=osf=s16:dither_method=triangular,apad=whole_len=${t.samples},atrim=end_sample=${t.samples}[out]`);

  const tmp = `${file}.tmp.wav`;
  const r = await spawnLines(ffmpegPath(), [...args, "-filter_complex", parts.join(";"), "-map", "[out]", "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", "-f", "wav", tmp], {});
  if (r.code !== 0) {
    await rm(tmp, { force: true });
    return { ok: false, message: /No space left|ENOSPC/i.test(r.stderr) ? "Your disk is full" : "Couldn't build the disc audio" };
  }
  // Verify the result is exactly what the plan says before trusting it.
  const got = await probeSamples(tmp);
  if (got !== t.samples) {
    await rm(tmp, { force: true });
    return { ok: false, message: `Track ${t.index + 1} came out ${got - t.samples} samples off. Please report this.` };
  }
  await rename(tmp, file);
  return { ok: true };
}
