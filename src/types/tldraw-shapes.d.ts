import "@tldraw/tlschema";

// Register the custom "card" shape into tldraw's shape union so ShapeUtil,
// createShape, and editor accessors are all correctly typed for it.
declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    card: { w: number; h: number; cardId: string };
  }
}
