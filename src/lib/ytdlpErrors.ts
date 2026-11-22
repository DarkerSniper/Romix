import type { ResolveErrorCode } from "../shared/api";

/** Maps yt-dlp's stderr to a short, human message. Order matters: most specific first. */
const RULES: Array<[RegExp, ResolveErrorCode, string]> = [
  [/private video/i, "private", "This video is private"],
  [/members[- ]only|join this channel/i, "members", "This video is for channel members only"],
  [/confirm your age|age[- ]restricted|inappropriate for some users/i, "age", "This video is age-restricted"],
  [/not a bot|confirm you.re not a bot/i, "bot-check", "YouTube wants to check you're not a bot. Try again later or update yt-dlp in Settings."],
  [/available in your country|geo.?restrict|blocked it in your country/i, "unavailable", "Not available in your region"],
  [/live event will begin|premieres in|is_live|this live event/i, "live", "Live streams can't go on a CD"],
  [/getaddrinfo|failed to resolve|unable to download webpage.*(?:urlopen|connection)|network is unreachable|timed out|connection (?:reset|refused)/i, "offline", "Can't reach YouTube. Check your internet connection."],
  [/video unavailable|this video is unavailable|has been removed|account .* terminated|does not exist|no longer available/i, "unavailable", "This video isn't available. It may be removed or blocked in your region."],
];

export function classifyYtdlpError(stderr: string): { code: ResolveErrorCode; message: string } {
  for (const [re, code, message] of RULES) if (re.test(stderr)) return { code, message };
  const last = stderr.trim().split(/\r?\n/).filter(Boolean).pop() ?? "";
  return { code: "unknown", message: last ? `Couldn't read this video (${last.replace(/^ERROR:\s*/, "").slice(0, 120)})` : "Couldn't read this video" };
}
