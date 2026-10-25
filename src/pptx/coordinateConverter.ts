import type { BaseSlideElement, SlideModel } from "../types/slide";

const PX_PER_INCH = 96;
const MIN_SIZE_INCHES = 0.01;

export interface PptLayout {
  width: number;
  height: number;
}

export function pxToIn(value: number): number {
  return round(Math.max(0, value) / PX_PER_INCH);
}

export function getInitialLayout(slide: SlideModel): PptLayout {
  return {
    width: Math.max(pxToIn(slide.width), 1),
    height: Math.max(pxToIn(slide.height), 1)
  };
}

export function toPptPosition(element: BaseSlideElement, sourceSlide: SlideModel, layout: PptLayout) {
  const fit = getSlideFit(sourceSlide, layout);

  return {
    x: round(fit.offsetX + element.x * fit.scale),
    y: round(fit.offsetY + element.y * fit.scale),
    w: round(Math.max(element.w * fit.scale, MIN_SIZE_INCHES)),
    h: round(Math.max(element.h * fit.scale, MIN_SIZE_INCHES)),
    rotate: normalizeRotation(element.rotation)
  };
}

export function getSlideFit(slide: SlideModel, layout: PptLayout) {
  const scale = Math.min(layout.width / slide.width, layout.height / slide.height);
  const renderedWidth = slide.width * scale;
  const renderedHeight = slide.height * scale;

  return {
    scale,
    offsetX: (layout.width - renderedWidth) / 2,
    offsetY: (layout.height - renderedHeight) / 2,
    renderedWidth,
    renderedHeight
  };
}

function normalizeRotation(rotation: number): number {
  if (!Number.isFinite(rotation) || rotation === 0) {
    return 0;
  }

  return round(rotation);
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
