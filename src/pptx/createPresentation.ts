import pptxgen from "pptxgenjs";
import type { PresentationModel } from "../types/slide";
import { createSlide } from "./createSlide";
import { getInitialLayout } from "./coordinateConverter";

export function createPresentation(model: PresentationModel) {
  const pptx = new pptxgen();
  const layout = getInitialLayout(model.slides[0]);

  pptx.author = "DeckBridge";
  pptx.company = "Figma";
  pptx.subject = "Editable Figma export";
  pptx.title = model.slides[0]?.name ?? "Figma export";
  pptx.theme = {
    headFontFace: "Arial",
    bodyFontFace: "Arial"
  };

  pptx.defineLayout({
    name: "FIGMA_EXPORT",
    width: layout.width,
    height: layout.height
  });
  pptx.layout = "FIGMA_EXPORT";

  for (const slide of model.slides) {
    createSlide(pptx, slide, layout);
  }

  return pptx;
}
