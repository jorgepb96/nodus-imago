import mark from "../../build/icon-mark.svg";

/** Inside the window use only the lens + N, without the macOS app tile. */
export function ImagoMark({ size = 28 }: { size?: number }) {
  return (
    <span
      className="imago-mark"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <img src={mark} alt="" />
    </span>
  );
}
