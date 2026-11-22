import type { Page } from "../types";

type PlaceholderPage = Exclude<Page, "disc" | "settings">;

const COPY: Record<PlaceholderPage, { title: string; body: string; when: string }> = {
  projects: {
    title: "Saved projects",
    body: "Save a disc to burn more copies later, or queue several copies in a row.",
    when: "Milestone 4",
  },
  shelf: {
    title: "Your shelf",
    body: "Every disc you burn lands here as a jewel case, so you can see and re-burn your history.",
    when: "Milestone 5",
  },
  inserts: {
    title: "Printable inserts",
    body: "A front cover collage, a back tracklist and a round disc label, exported as print-ready PDF.",
    when: "Milestone 5",
  },
};

export function Placeholder({ page }: { page: PlaceholderPage }) {
  const c = COPY[page];
  return (
    <div className="placeholder">
      <h1>{c.title}</h1>
      <p>{c.body}</p>
      <span className="pill">Coming in {c.when}</span>
    </div>
  );
}
