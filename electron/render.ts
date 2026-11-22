import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { DiscRequest, RenderResult, RenderedTrack } from "../src/shared/api";
import { planDisc, renderKey, type PlanInput, type PlannedTrack } from "../src/lib/discPlan";
import { paths } from "./paths";
import { pcmPath, probeSamples, readPcmMeta } from "./prep";
import { ffmpegPath, spawnLines } from "./tools";

/**
 * Builds the final per-track 16-bit files exactly as they will be burned:
 * trims, crossfades and boundary borrowing from the disc plan, gain for
 * loudness evening, then one TPDF-dithered conversion to 16-bit and sector
 * padding. Each track is cached by a key of everything that affects it.
 */
export async function renderDisc(req: DiscRequest): Promise<RenderResult> {
  const inputs: PlanInput[] = [];
  for (const key of req.keys) {
    const meta = await readPcmMeta(key);
    if (!meta) return { ok: false, message: "Some songs aren't ready yet" };
    inputs.push({ key, samples: meta.samples, lufs: meta.lufs, truePeakDb: meta.truePeakDb });
  }
  if (inputs.length === 0) return { ok: false, message: "Add some songs first" };

  const plan = planDisc(inputs, req.options);
  const out: RenderedTrack[] = [];
  for (const t of plan.tracks) {
    const nextKey = plan.tracks[t.index + 1]?.key;
    const id = createHash("sha1").update(renderKey(t, nextKey)).digest("hex").slice(0, 24);
    const file = join(paths.disc, `${id}.wav`);
    if (!existsSync(file)) {
      const ok = await renderTrack(t, nextKey, file);
      if (!ok.ok) return { ok: false, message: ok.message };
    }
    out.push({ key: t.key, url: `romix-audio://disc/${id}.wav`, samples: t.samples, pregap: t.pregap, startSample: t.startSample, gainDb: t.gainDb });
  }
  return { ok: true, tracks: out, totalSamples: plan.totalSamples, targetLufs: plan.targetLufs };
}

async function renderTrack(t: PlannedTrack, nextKey: string | undefined, file: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const usesNext = Boolean(nextKey && (t.crossfadeOut || t.borrowFromNext));
  const args = ["-hide_banner", "-nostdin", "-y", "-i", pcmPath(t.key)];
  if (usesNext) args.push("-i", pcmPath(nextKey!));

  const parts: string[] = [`[0:a]atrim=start_sample=${t.trimStart},asetpts=PTS-STARTPTS[a]`];
  let cur = "a";
  if (usesNext) {
    parts.push(`[1:a]asplit=2[n1][n2]`);
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
  parts.push(
    `[${cur}]volume=${t.gainDb}dB,aresample=osf=s16:dither_method=triangular,apad=whole_len=${t.samples},atrim=end_sample=${t.samples}[out]`,
  );

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
