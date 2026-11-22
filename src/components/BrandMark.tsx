/**
 * Romix mark: a solid disc with one slice faded out, echoing the slice view.
 * Single colour (currentColor) so it follows the system label colour.
 */
export const MARK_DISC = "M57.98 17A30 30 0 1 1 32 2V25A7 7 0 1 0 38.06 28.5Z";
export const MARK_SLICE = "M33.5 2.04A30 30 0 0 1 57.23 15.7L39.4 26A7 7 0 0 0 33.5 25.16Z";

export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className="brand-mark" aria-hidden="true">
      <path fill="currentColor" d={MARK_DISC} />
      <path fill="currentColor" opacity="0.3" d={MARK_SLICE} />
    </svg>
  );
}
