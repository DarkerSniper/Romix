import { readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Project, ProjectSummary } from "../src/shared/api";
import { paths } from "./paths";

/** Saved discs live in <app folder>/data/projects as one JSON file each. */
const file = (id: string) => join(paths.projects, `${id.replace(/[^\w-]/g, "")}.json`);

function summarize(p: Project): ProjectSummary {
  return {
    id: p.id,
    title: p.title,
    updatedAt: p.updatedAt,
    songs: p.tracks.length,
    durationSec: p.tracks.reduce((n, t) => n + t.durationSec, 0),
    covers: p.tracks.slice(0, 4).map((t) => t.cover),
  };
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const out: ProjectSummary[] = [];
  for (const name of await readdir(paths.projects).catch(() => [] as string[])) {
    if (!name.endsWith(".json")) continue;
    try {
      out.push(summarize(JSON.parse(await readFile(join(paths.projects, name), "utf8")) as Project));
    } catch {
      /* skip unreadable files */
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadProject(id: string): Promise<Project | null> {
  try {
    return JSON.parse(await readFile(file(id), "utf8")) as Project;
  } catch {
    return null;
  }
}

export async function saveProject(p: Omit<Project, "updatedAt">): Promise<ProjectSummary> {
  if (!p.id || !Array.isArray(p.tracks)) throw new Error("Invalid project");
  const full: Project = { ...p, title: p.title.trim() || "Untitled mix", updatedAt: Date.now() };
  const tmp = `${file(p.id)}.tmp`;
  await writeFile(tmp, JSON.stringify(full));
  await rename(tmp, file(p.id));
  return summarize(full);
}

export async function deleteProject(id: string) {
  await rm(file(id), { force: true });
}
