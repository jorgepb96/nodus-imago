import { useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { Region } from "../../shared/imageRotation";

const handles = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
type Point = { x: number; y: number };
type PointerLocation = { clientX: number; clientY: number };
export type ProposalGrip = (typeof handles)[number] | "move";
export type ProposalGeometry = {
  stage: HTMLDivElement | null;
  showBoxes: boolean;
  position: (region: Region) => CSSProperties;
  point: (event: PointerLocation) => Point;
  reshape: (region: Region, grip: ProposalGrip, dx: number, dy: number, from: Point) => Region;
};

export function VisionProposalBoxes<Id extends number | string>({
  stage, showBoxes, position, point, reshape, boxes, selected, onSelect, onChange, busy, testId = "viewer-proposal-box",
}: ProposalGeometry & {
  boxes: { id: Id; region: Region }[];
  selected: Id | null;
  onSelect: (id: Id) => void;
  onChange: (id: Id, region: Region) => void;
  busy: boolean;
  testId?: string;
}) {
  const drag = useRef<{ id: Id; grip: ProposalGrip; start: Region; from: Point } | null>(null);
  if (!stage || !showBoxes) return null;
  const update = (event: PointerLocation) => {
    const moving = drag.current;
    if (!moving) return;
    const to = point(event);
    onChange(moving.id, reshape(moving.start, moving.grip, to.x - moving.from.x, to.y - moving.from.y, moving.from));
  };
  return createPortal(boxes.map(({ id, region }) => {
    const active = selected === id && !busy;
    return (
      <div
        key={id}
        className={`viewer-proposal-box${active ? " is-active" : ""}${busy ? "" : " is-editable"}`}
        style={position(region)}
        data-testid={testId}
        onPointerDown={(event) => {
          if (busy || event.button !== 0) return;
          event.stopPropagation();
          onSelect(id);
          const grip = (event.target as HTMLElement).closest<HTMLElement>("[data-grip]")?.dataset.grip as ProposalGrip | undefined;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { id, grip: grip ?? "move", start: region, from: point(event) };
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          event.stopPropagation();
          update(event);
        }}
        onPointerUp={(event) => {
          if (!drag.current) return;
          event.stopPropagation();
          update(event);
          drag.current = null;
        }}
        onPointerCancel={() => {
          const moving = drag.current;
          drag.current = null;
          if (moving) onChange(moving.id, moving.start);
        }}
      >
        {active && handles.map((grip) => <span key={grip} className={`crop-grip is-${grip}`} data-grip={grip} />)}
      </div>
    );
  }), stage);
}
