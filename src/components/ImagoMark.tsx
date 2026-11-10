import lightMark from "../../build/icon-light.svg";
import darkMark from "../../build/icon-dark.svg";

/** The in-app brand uses the exact approved app artwork (objective + N), not
 *  a simplified glyph. The two images follow the resolved light/dark theme. */
export function ImagoMark({ size = 28 }: { size?: number }) {
  return (
    <span
      className="imago-mark"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <img className="imago-mark-light" src={lightMark} alt="" />
      <img className="imago-mark-dark" src={darkMark} alt="" />
    </span>
  );
}
