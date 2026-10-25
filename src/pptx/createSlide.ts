import type pptxgen from "pptxgenjs";
import type { FillStyle, ShapeSlideElement, SlideElement, SlideModel, StrokeStyle, TextStyle } from "../types/slide";
import { getSlideFit, toPptPosition, type PptLayout } from "./coordinateConverter";
import { bytesToDataUri, svgToDataUri } from "./dataUri";

type Pptx = InstanceType<typeof pptxgen>;
type PptSlide = ReturnType<Pptx["addSlide"]>;
type PptPosition = ReturnType<typeof toPptPosition>;

const TEXT_BOX_EXTRA_WIDTH_RATIO = 0.08;
const AUTO_WIDTH_TEXT_EXTRA_WIDTH_RATIO = 0.18;
const TEXT_BOX_MIN_EXTRA_WIDTH_IN = 8 / 96;
const AUTO_WIDTH_TEXT_MIN_EXTRA_WIDTH_IN = 12 / 96;
const TEXT_BOX_MAX_EXTRA_WIDTH_IN = 0.35;
const AUTO_WIDTH_TEXT_MAX_EXTRA_WIDTH_IN = 0.5;

export function createSlide(pptx: Pptx, sourceSlide: SlideModel, layout: PptLayout) {
  const slide = pptx.addSlide();
  const slideFit = getSlideFit(sourceSlide, layout);

  if (sourceSlide.background && sourceSlide.background.kind !== "none") {
    slide.addShape(pptx.ShapeType.rect, {
      x: slideFit.offsetX,
      y: slideFit.offsetY,
      w: slideFit.renderedWidth,
      h: slideFit.renderedHeight,
      fill: toPptFill(sourceSlide.background),
      line: { color: "FFFFFF", transparency: 100, width: 0 },
      objectName: `${sourceSlide.name} background`
    });
  }

  for (const element of sourceSlide.elements) {
    addElement(pptx, slide, sourceSlide, layout, element);
  }
}

function addElement(pptx: Pptx, slide: PptSlide, sourceSlide: SlideModel, layout: PptLayout, element: SlideElement) {
  const position = toPptPosition(element, sourceSlide, layout);

  switch (element.type) {
    case "text":
      slide.addText(getPptText(element), {
        ...getPptTextPosition(position, element),
        ...toPptTextStyle(element.style),
        fit: "none",
        margin: 0,
        wrap: element.autoResize === "WIDTH_AND_HEIGHT" ? false : undefined,
        objectName: element.name
      });
      break;

    case "shape":
      slide.addShape(toPptShape(pptx, element), {
        ...position,
        fill: toPptFill(element.style.fill),
        line: toPptLine(element.style.stroke),
        rectRadius: getRectRadius(element),
        objectName: element.name
      });
      break;

    case "line":
      slide.addShape(pptx.ShapeType.line, {
        ...position,
        fill: { color: "FFFFFF", transparency: 100 },
        line: toPptLine(element.style.stroke),
        objectName: element.name
      });
      break;

    case "image":
      slide.addImage({
        ...position,
        data: bytesToDataUri(element.data.bytes, element.data.mimeType),
        objectName: element.name
      });
      break;

    case "svg":
      slide.addImage({
        ...position,
        data: svgToDataUri(element.svg),
        objectName: element.name
      });
      break;
  }
}

function getPptTextPosition(position: PptPosition, element: Extract<SlideElement, { type: "text" }>): PptPosition {
  const isAutoWidth = element.autoResize === "WIDTH_AND_HEIGHT";
  const ratio = isAutoWidth ? AUTO_WIDTH_TEXT_EXTRA_WIDTH_RATIO : TEXT_BOX_EXTRA_WIDTH_RATIO;
  const minExtraWidth = isAutoWidth ? AUTO_WIDTH_TEXT_MIN_EXTRA_WIDTH_IN : TEXT_BOX_MIN_EXTRA_WIDTH_IN;
  const maxExtraWidth = isAutoWidth ? AUTO_WIDTH_TEXT_MAX_EXTRA_WIDTH_IN : TEXT_BOX_MAX_EXTRA_WIDTH_IN;
  const extraWidth = clamp(position.w * ratio, minExtraWidth, maxExtraWidth);

  return {
    ...position,
    x: roundPptPosition(getExpandedTextX(position.x, extraWidth, element.style.align)),
    w: roundPptPosition(position.w + extraWidth)
  };
}

function getExpandedTextX(x: number, extraWidth: number, align?: TextStyle["align"]) {
  if (align === "center") {
    return x - extraWidth / 2;
  }

  if (align === "right") {
    return x - extraWidth;
  }

  return x;
}

function getPptText(element: Extract<SlideElement, { type: "text" }>) {
  if (!element.runs?.length) {
    return element.text || " ";
  }

  return element.runs.map(run => ({
    text: run.text,
    options: {
      ...toPptTextStyle(run.style),
      softBreakBefore: run.softBreakBefore
    }
  }));
}

function toPptTextStyle(style: TextStyle) {
  return {
    fontFace: style.fontFace ?? style.fontFamily,
    fontSize: style.fontSize,
    bold: style.bold,
    italic: style.italic,
    underline: style.underline ? { style: "sng" as const } : undefined,
    strike: style.strike ? "sngStrike" as const : undefined,
    color: style.color,
    transparency: style.transparency,
    align: style.align,
    valign: style.valign,
    lineSpacing: style.lineHeight,
    charSpacing: style.letterSpacing
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundPptPosition(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function toPptShape(pptx: Pptx, element: ShapeSlideElement) {
  return pptx.ShapeType[element.shape] ?? element.shape;
}

function toPptFill(fill?: FillStyle) {
  if (!fill || fill.kind === "none") {
    return {
      color: "FFFFFF",
      transparency: 100
    };
  }

  if (fill.kind === "gradient") {
    return {
      color: fill.fallbackColor,
      transparency: fill.transparency
    };
  }

  return {
    color: fill.color,
    transparency: fill.transparency
  };
}

function toPptLine(stroke?: StrokeStyle) {
  if (!stroke) {
    return {
      color: "FFFFFF",
      transparency: 100,
      width: 0
    };
  }

  return {
    color: stroke.color,
    transparency: stroke.transparency,
    width: stroke.width,
    dashType: stroke.dash,
    beginArrowType: stroke.beginArrowType,
    endArrowType: stroke.endArrowType
  };
}

function getRectRadius(element: ShapeSlideElement): number | undefined {
  if (element.shape !== "roundRect" || !element.style.cornerRadius) {
    return undefined;
  }

  const shortestSide = Math.max(1, Math.min(element.w, element.h));
  return Math.max(0, Math.min(1, element.style.cornerRadius / shortestSide));
}
