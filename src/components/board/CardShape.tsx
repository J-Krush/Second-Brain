import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type TLBaseShape,
} from "tldraw";
import { styleFor } from "@/components/card-style";
import { useCardContext } from "./card-context";

export type CardShape = TLBaseShape<
  "card",
  { w: number; h: number; cardId: string }
>;

function CardShapeBody({ shape }: { shape: CardShape }) {
  const { cards } = useCardContext();
  const card = cards[shape.props.cardId];
  const style = styleFor(card?.type ?? "thought");
  const isQuote = card?.type === "quote" || card?.type === "mantra";
  // Links usually have no body; their note is the only text worth showing on the canvas.
  const text = card?.body || card?.note;
  const og = ((card?.props as Record<string, unknown> | undefined)?.og ?? undefined) as
    | { image?: string }
    | undefined;

  return (
    <HTMLContainer
      style={{
        width: shape.props.w,
        height: shape.props.h,
        overflow: "hidden",
        borderRadius: 10,
        border: "1px solid var(--color-line, #302d25)",
        background: "var(--color-surface, #1c1b16)",
        color: "var(--color-ink, #e7e3da)",
        display: "flex",
        flexDirection: "column",
        pointerEvents: "none",
      }}
    >
      {og?.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/files/${og.image}/thumb-400`}
          alt=""
          style={{ width: "100%", height: 90, objectFit: "cover" }}
        />
      )}
      <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 4 }}>
        <span
          style={{
            alignSelf: "flex-start",
            fontSize: 10,
            padding: "1px 6px",
            borderRadius: 4,
            background: "var(--color-surface-2, #24221c)",
            color: "var(--color-ink-dim, #9a958a)",
          }}
        >
          {style.label}
        </span>
        {card?.title && (
          <div style={{ fontWeight: 600, fontSize: 14 }}>{card.title}</div>
        )}
        {text && (
          <div
            style={{
              fontSize: 12,
              color: "var(--color-ink-dim, #b5bdc3)",
              fontStyle: isQuote ? "italic" : "normal",
              display: "-webkit-box",
              WebkitLineClamp: 4,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {text}
          </div>
        )}
        {!card && <div style={{ fontSize: 12, color: "#9a958a" }}>Missing card</div>}
      </div>
    </HTMLContainer>
  );
}

export class CardShapeUtil extends BaseBoxShapeUtil<CardShape> {
  static override type = "card" as const;
  static override props = {
    w: T.number,
    h: T.number,
    cardId: T.string,
  };

  override getDefaultProps(): CardShape["props"] {
    return { w: 240, h: 150, cardId: "" };
  }

  override canResize = () => true;

  // tldraw owns the pointer pipeline; drill-in is signalled from here so the
  // canvas can decide whether the target card is itself a board.
  override onDoubleClick(shape: CardShape) {
    window.dispatchEvent(
      new CustomEvent("sb:open-card", { detail: shape.props.cardId }),
    );
  }

  override component(shape: CardShape) {
    return <CardShapeBody shape={shape} />;
  }

  override getIndicatorPath(shape: CardShape) {
    const path = new Path2D();
    path.roundRect(0, 0, shape.props.w, shape.props.h, 10);
    return path;
  }
}
