import type { TextAlign, TextRun, TextSlideElement, TextStyle, TextVAlign } from "../types/slide";
import { getBaseElement, getFillStyle, opacityToTransparency } from "./common";
import type { ParseContext } from "./common";

type TextSegment = Pick<
  StyledTextSegment,
  "characters" | "fills" | "fontName" | "fontSize" | "fontStyle" | "fontWeight" | "letterSpacing" | "lineHeight" | "textCase" | "textDecoration"
>;

const PX_TO_PT = 72 / 96;
const FIGMA_LINE_BREAK_PATTERN = /\r\n|\r|\n|\u2028|\u2029/g;

export function exportText(node: TextNode, context: ParseContext): TextSlideElement {
  const runs = getTextRuns(node, context);
  const style = {
    ...(runs[0]?.style ?? getTextStyle(node, context)),
    align: mapHorizontalAlign(node.textAlignHorizontal),
    valign: mapVerticalAlign(node.textAlignVertical)
  };

  return {
    ...getBaseElement(node, context),
    sourceMode: "PPT_TEXT",
    type: "text",
    text: normalizeTextLineBreaks(applyTextCase(node.characters, getTextCase(node.textCase))),
    autoResize: node.textAutoResize,
    style,
    runs: runs.length > 0 ? runs : undefined
  };
}

function getTextStyle(node: TextNode, context: ParseContext): TextStyle {
  const nodeOpacity = typeof node.opacity === "number" ? node.opacity : 1;
  const fontName = node.fontName;
  const fontSize = toPointSize(getMixedNumber(node.fontSize));
  const fill = getFillStyle(node.fills, nodeOpacity, context.warnings, node.name);

  if (fontName === figma.mixed) {
    context.warnings.push(`${node.name}: mixed text font styles could not be read as rich text and were reduced to one PowerPoint text style.`);
  }

  if (node.fontSize === figma.mixed || node.fills === figma.mixed) {
    context.warnings.push(`${node.name}: mixed text styles could not be read as rich text and were approximated.`);
  }

  return {
    fontFamily: fontName !== figma.mixed ? fontName.family : undefined,
    fontFace: fontName !== figma.mixed ? getPowerPointFontFace(fontName) : undefined,
    fontStyleName: fontName !== figma.mixed ? fontName.style : undefined,
    fontSize,
    fontWeight: fontName !== figma.mixed ? fontStyleToWeight(fontName.style) : undefined,
    bold: fontName !== figma.mixed ? getPowerPointBold(fontName, fontStyleToWeight(fontName.style)) : undefined,
    italic: fontName !== figma.mixed ? getPowerPointItalic(fontName) : undefined,
    color: fill?.kind === "solid" ? fill.color : fill?.kind === "gradient" ? fill.fallbackColor : undefined,
    transparency: getTextTransparency(fill, nodeOpacity),
    lineHeight: getLineHeight(node.lineHeight, fontSize),
    letterSpacing: getLetterSpacing(node.letterSpacing, fontSize)
  };
}

function getTextRuns(node: TextNode, context: ParseContext): TextRun[] {
  const segments = node.getStyledTextSegments([
    "fills",
    "fontName",
    "fontSize",
    "fontStyle",
    "fontWeight",
    "letterSpacing",
    "lineHeight",
    "textCase",
    "textDecoration"
  ]);
  const runs: TextRun[] = [];

  for (const segment of segments) {
    if (segment.characters.length === 0) continue;

    const style = getSegmentTextStyle(segment, node, context);

    for (const part of splitTextByLineBreaks(applyTextCase(segment.characters, segment.textCase))) {
      runs.push({
        text: part.text,
        style,
        softBreakBefore: part.softBreakBefore || undefined
      });
    }
  }

  return runs;
}

function splitTextByLineBreaks(text: string): Array<{ text: string; softBreakBefore?: boolean }> {
  const parts: Array<{ text: string; softBreakBefore?: boolean }> = [];
  let lastIndex = 0;
  let hasBreakBeforeNextPart = false;

  for (const match of text.matchAll(FIGMA_LINE_BREAK_PATTERN)) {
    const beforeBreak = text.slice(lastIndex, match.index);
    parts.push({
      text: beforeBreak,
      softBreakBefore: hasBreakBeforeNextPart || parts.length > 0
    });
    lastIndex = match.index + match[0].length;
    hasBreakBeforeNextPart = true;
  }

  parts.push({
    text: text.slice(lastIndex),
    softBreakBefore: hasBreakBeforeNextPart || parts.length > 0
  });

  return parts;
}

function normalizeTextLineBreaks(text: string): string {
  return text.replace(FIGMA_LINE_BREAK_PATTERN, "\n");
}

function applyTextCase(text: string, textCase: TextCase | undefined): string {
  if (!textCase || textCase === "ORIGINAL") {
    return text;
  }

  if (textCase === "UPPER" || textCase === "SMALL_CAPS" || textCase === "SMALL_CAPS_FORCED") {
    return text.toLocaleUpperCase();
  }

  if (textCase === "LOWER") {
    return text.toLocaleLowerCase();
  }

  if (textCase === "TITLE") {
    return text.toLocaleLowerCase().replace(/(^|[\s._\-:/([{])(\S)/g, (_match, prefix: string, char: string) => {
      return `${prefix}${char.toLocaleUpperCase()}`;
    });
  }

  return text;
}

function getTextCase(textCase: TextCase | typeof figma.mixed): TextCase | undefined {
  return textCase === figma.mixed ? undefined : textCase;
}

function getSegmentTextStyle(segment: TextSegment, node: TextNode, context: ParseContext): TextStyle {
  const nodeOpacity = typeof node.opacity === "number" ? node.opacity : 1;
  const fontSize = toPointSize(segment.fontSize);
  const fill = getFillStyle(segment.fills, nodeOpacity, context.warnings, node.name);

  return {
    fontFamily: segment.fontName.family,
    fontFace: getPowerPointFontFace(segment.fontName),
    fontStyleName: segment.fontName.style,
    fontSize,
    fontWeight: segment.fontWeight,
    bold: getPowerPointBold(segment.fontName, segment.fontWeight),
    italic: getPowerPointItalic(segment.fontName),
    underline: segment.textDecoration === "UNDERLINE",
    strike: segment.textDecoration === "STRIKETHROUGH",
    color: fill?.kind === "solid" ? fill.color : fill?.kind === "gradient" ? fill.fallbackColor : undefined,
    transparency: getTextTransparency(fill, nodeOpacity),
    lineHeight: getLineHeight(segment.lineHeight, fontSize),
    letterSpacing: getLetterSpacing(segment.letterSpacing, fontSize)
  };
}

function getMixedNumber(value: number | typeof figma.mixed): number | undefined {
  return value === figma.mixed ? undefined : value;
}

function getLineHeight(lineHeight: LineHeight | typeof figma.mixed, fontSize?: number): number | undefined {
  if (lineHeight === figma.mixed || lineHeight.unit === "AUTO") {
    return undefined;
  }

  if (lineHeight.unit === "PIXELS") {
    return toPointSize(lineHeight.value);
  }

  return fontSize ? (fontSize * lineHeight.value) / 100 : undefined;
}

function getLetterSpacing(letterSpacing: LetterSpacing | typeof figma.mixed, fontSize?: number): number | undefined {
  if (letterSpacing === figma.mixed) {
    return undefined;
  }

  if (letterSpacing.unit === "PIXELS") {
    return toPointSize(letterSpacing.value);
  }

  return fontSize ? (fontSize * letterSpacing.value) / 100 : undefined;
}

function getTextTransparency(fill: ReturnType<typeof getFillStyle>, nodeOpacity: number): number {
  if (fill?.kind === "solid" || fill?.kind === "gradient") {
    return fill.transparency;
  }

  return opacityToTransparency(nodeOpacity);
}

function mapHorizontalAlign(align: TextNode["textAlignHorizontal"]): TextAlign {
  if (align === "CENTER") return "center";
  if (align === "RIGHT") return "right";
  if (align === "JUSTIFIED") return "justify";
  return "left";
}

function mapVerticalAlign(align: TextNode["textAlignVertical"]): TextVAlign {
  if (align === "CENTER") return "middle";
  if (align === "BOTTOM") return "bottom";
  return "top";
}

function fontStyleToWeight(style: string): number {
  const normalized = style.toLowerCase();

  if (normalized.includes("thin")) return 100;
  if (normalized.includes("extra light") || normalized.includes("extralight")) return 200;
  if (normalized.includes("light")) return 300;
  if (normalized.includes("medium")) return 500;
  if (normalized.includes("semi bold") || normalized.includes("semibold") || normalized.includes("demi bold") || normalized.includes("demibold")) return 600;
  if (normalized.includes("extra bold") || normalized.includes("extrabold")) return 800;
  if (normalized.includes("black") || normalized.includes("heavy")) return 900;
  if (normalized.includes("bold")) return 700;

  return 400;
}

function getPowerPointFontFace(fontName: FontName): string {
  if (isBasicPowerPointStyle(fontName.style)) {
    return fontName.family;
  }

  return `${fontName.family} ${fontName.style}`.replace(/\s+/g, " ").trim();
}

function getPowerPointBold(fontName: FontName, fontWeight: number): boolean | undefined {
  if (!isBasicPowerPointStyle(fontName.style)) {
    return undefined;
  }

  return fontWeight >= 600 || undefined;
}

function getPowerPointItalic(fontName: FontName): boolean | undefined {
  if (!isBasicPowerPointStyle(fontName.style)) {
    return undefined;
  }

  return fontName.style.toLowerCase().includes("italic") || undefined;
}

function isBasicPowerPointStyle(style: string): boolean {
  const normalized = style
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized === "regular" || normalized === "italic" || normalized === "bold" || normalized === "bold italic";
}

function toPointSize(value: number | undefined): number | undefined {
  return typeof value === "number" ? value * PX_TO_PT : undefined;
}
