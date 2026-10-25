import JSZip from "jszip";
import type {
  FillStyle,
  ImageSlideElement,
  LineSlideElement,
  PresentationModel,
  ShapeSlideElement,
  SlideElement,
  SlideModel,
  StrokeStyle,
  SvgSlideElement,
  TextRun,
  TextSlideElement,
  TextStyle,
  TextVAlign
} from "../types/slide";

const EMU_PER_INCH = 914400;
const PX_PER_INCH = 96;
const DEFAULT_SLIDE_WIDTH_EMU = 12192000;
const DEFAULT_SLIDE_HEIGHT_EMU = 6858000;

const SHAPE_TYPES = new Set<ShapeSlideElement["shape"]>([
  "rect",
  "roundRect",
  "ellipse",
  "triangle",
  "diamond",
  "pentagon",
  "hexagon",
  "heptagon",
  "octagon",
  "star4",
  "star5",
  "star6",
  "star7",
  "star8",
  "star10",
  "star12",
  "star16",
  "star24",
  "star32"
]);

interface Relationship {
  id: string;
  target: string;
  targetMode?: string;
}

interface CoordinateContext {
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
}

interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

interface ParseSlideContext {
  zip: JSZip;
  slidePath: string;
  rels: Map<string, Relationship>;
  warnings: string[];
  coordinates: CoordinateContext;
}

export async function parsePptx(file: File): Promise<PresentationModel> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const warnings: string[] = [];
  const presentationXml = await readXml(zip, "ppt/presentation.xml");
  const presentationRels = await readRelationships(zip, "ppt/presentation.xml");
  const slideSize = getSlideSize(presentationXml);
  const slidePaths = getSlidePaths(presentationXml, presentationRels, zip);

  if (slidePaths.length === 0) {
    throw new Error("This PPTX file contains no slides.");
  }

  const slides: SlideModel[] = [];

  for (let index = 0; index < slidePaths.length; index += 1) {
    const slidePath = slidePaths[index];
    const slideXml = await readXml(zip, slidePath);
    const rels = await readRelationships(zip, slidePath);
    const spTree = firstDescendant(slideXml.documentElement, "spTree");

    if (!spTree) {
      warnings.push(`${getSlideName(index)}: slide content could not be found.`);
      continue;
    }

    const context: ParseSlideContext = {
      zip,
      slidePath,
      rels,
      warnings,
      coordinates: {
        offsetX: 0,
        offsetY: 0,
        scaleX: 1,
        scaleY: 1
      }
    };

    slides.push({
      id: slidePath,
      name: getSlideName(index),
      width: slideSize.width,
      height: slideSize.height,
      background: parseSlideBackground(slideXml),
      elements: await parseSlideElements(spTree, context)
    });
  }

  if (slides.length === 0) {
    throw new Error("No slides could be imported from this PPTX file.");
  }

  return {
    source: "pptx",
    createdAt: new Date().toISOString(),
    rasterScale: 1,
    slides,
    logs: [],
    warnings
  };
}

async function parseSlideElements(spTree: Element, context: ParseSlideContext): Promise<SlideElement[]> {
  const elements: SlideElement[] = [];

  for (const child of Array.from(spTree.children)) {
    switch (child.localName) {
      case "sp":
        elements.push(...parseShape(child, context));
        break;

      case "pic": {
        const image = await parsePicture(child, context);
        if (image) elements.push(image);
        break;
      }

      case "cxnSp":
        elements.push(...parseConnector(child, context));
        break;

      case "graphicFrame":
        elements.push(...(await parseGraphicFrame(child, context)));
        break;

      case "grpSp":
        elements.push(...(await parseGroup(child, context)));
        break;
    }
  }

  return elements;
}

async function parseGroup(group: Element, context: ParseSlideContext): Promise<SlideElement[]> {
  const grpSpPr = directChild(group, "grpSpPr");
  const groupTransform = grpSpPr ? parseGroupTransform(grpSpPr, context.coordinates) : context.coordinates;

  return parseSlideElements(group, {
    ...context,
    coordinates: groupTransform
  });
}

function parseShape(shapeElement: Element, context: ParseSlideContext): SlideElement[] {
  const name = getElementName(shapeElement, "Shape");
  const spPr = directChild(shapeElement, "spPr");
  const txBody = directChild(shapeElement, "txBody");
  const bounds = mapBounds(parseBounds(spPr), context.coordinates);

  if (!bounds) {
    context.warnings.push(`${name}: shape skipped because its position is unavailable.`);
    return [];
  }

  const preset = getShapePreset(spPr);
  const shapeStyle = parseShapeStyle(spPr, directChild(shapeElement, "style"));
  const text = txBody ? parseText(txBody, name, bounds) : undefined;
  const elements: SlideElement[] = [];

  if (text) {
    if (hasVisibleShapeStyle(shapeStyle) && preset !== "line") {
      elements.push(createShapeElement(name, bounds, preset, shapeStyle));
    }

    elements.push(text);
    return elements;
  }

  if (preset === "line") {
    return [createLineElement(name, bounds, shapeStyle.stroke)];
  }

  return [createShapeElement(name, bounds, preset, shapeStyle)];
}

function parseConnector(connectorElement: Element, context: ParseSlideContext): SlideElement[] {
  const name = getElementName(connectorElement, "Connector");
  const spPr = directChild(connectorElement, "spPr");
  const bounds = mapBounds(parseConnectorBounds(spPr), context.coordinates);

  if (!bounds) {
    context.warnings.push(`${name}: connector skipped because its position is unavailable.`);
    return [];
  }

  return [createLineElement(name, bounds, parseStroke(spPr, directChild(connectorElement, "style")))];
}

async function parseGraphicFrame(frameElement: Element, context: ParseSlideContext): Promise<SlideElement[]> {
  const name = getElementName(frameElement, "Chart");
  const bounds = mapBounds(parseGraphicFrameBounds(frameElement), context.coordinates);
  const chartElement = firstDescendant(frameElement, "chart");
  const relationshipId = chartElement ? getRelationshipId(chartElement) : undefined;

  if (!bounds || !relationshipId) {
    context.warnings.push(`${name}: chart skipped because its position or linked data is unavailable.`);
    return [];
  }

  const relationship = context.rels.get(relationshipId);

  if (!relationship || relationship.targetMode === "External") {
    context.warnings.push(`${name}: externally linked charts are not imported.`);
    return [];
  }

  const chartPath = resolveTarget(context.slidePath, relationship.target);
  const chartFile = context.zip.file(chartPath);

  if (!chartFile) {
    context.warnings.push(`${name}: chart data ${chartPath} could not be found.`);
    return [];
  }

  const chartXml = parseXml(await chartFile.async("text"), chartPath);

  return parseChart(chartXml, name, bounds, context.warnings);
}

async function parsePicture(pic: Element, context: ParseSlideContext): Promise<ImageSlideElement | SvgSlideElement | undefined> {
  const name = getElementName(pic, "Image");
  const spPr = directChild(pic, "spPr");
  const bounds = mapBounds(parseBounds(spPr), context.coordinates);
  const relationshipId = getPictureRelationshipId(pic);

  if (!bounds || !relationshipId) {
    context.warnings.push(`${name}: image skipped because its position or linked data is unavailable.`);
    return undefined;
  }

  const relationship = context.rels.get(relationshipId);

  if (!relationship || relationship.targetMode === "External") {
    context.warnings.push(`${name}: externally linked images are not imported.`);
    return undefined;
  }

  const mediaPath = resolveTarget(context.slidePath, relationship.target);
  const mediaFile = context.zip.file(mediaPath);

  if (!mediaFile) {
    context.warnings.push(`${name}: image file ${mediaPath} could not be found.`);
    return undefined;
  }

  const mimeType = getImageMimeType(mediaPath);

  if (mimeType === "image/svg+xml") {
    return {
      ...createBaseElement(name, bounds),
      sourceMode: "SVG",
      type: "svg",
      svg: await mediaFile.async("text")
    };
  }

  if (!mimeType) {
    context.warnings.push(`${name}: this image format is not supported.`);
    return undefined;
  }

  return {
    ...createBaseElement(name, bounds),
    sourceMode: "PPT_IMAGE",
    type: "image",
    data: {
      mimeType,
      bytes: await mediaFile.async("uint8array")
    }
  };
}

function getPictureRelationshipId(pic: Element): string | undefined {
  const blip = firstDescendant(pic, "blip");
  const svgBlip = firstDescendant(pic, "svgBlip");

  return getAttribute(blip, "embed") ??
    getAttribute(blip, "link") ??
    getAttribute(svgBlip, "embed") ??
    getAttribute(svgBlip, "link");
}

function parseText(txBody: Element, name: string, bounds: Bounds): TextSlideElement | undefined {
  const bodyPr = directChild(txBody, "bodyPr");
  const paragraphs = directChildren(txBody, "p");
  const runs: TextRun[] = [];
  const paragraphStyles = paragraphs.map(paragraph => parseParagraphStyle(paragraph, bodyPr));

  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
    const paragraph = paragraphs[paragraphIndex];
    const paragraphStyle = paragraphStyles[paragraphIndex];

    if (paragraphIndex > 0) {
      runs.push({
        text: "\n",
        style: paragraphStyle
      });
    }

    for (const child of Array.from(paragraph.children)) {
      if (child.localName === "r" || child.localName === "fld") {
        const text = getTextContent(firstDescendant(child, "t"));
        if (!text) continue;

        runs.push({
          text,
          style: {
            ...paragraphStyle,
            ...parseRunStyle(child, paragraphStyle)
          }
        });
      }

      if (child.localName === "br") {
        runs.push({
          text: "\n",
          style: paragraphStyle
        });
      }
    }
  }

  const text = runs.map(run => run.text).join("");

  if (!text.trim()) {
    return undefined;
  }

  const style = runs.find(run => run.text.trim())?.style ?? paragraphStyles[0] ?? {};

  return {
    ...createBaseElement(name, bounds),
    sourceMode: "PPT_TEXT",
    type: "text",
    text,
    autoResize: "NONE",
    style,
    runs
  };
}

function parseParagraphStyle(paragraph: Element, bodyPr?: Element): TextStyle {
  const pPr = directChild(paragraph, "pPr");
  const defRPr = pPr ? directChild(pPr, "defRPr") : undefined;

  return {
    ...parseRunProperties(defRPr),
    align: mapTextAlign(pPr?.getAttribute("algn")),
    valign: mapTextVAlign(bodyPr?.getAttribute("anchor"))
  };
}

function parseRunStyle(run: Element, paragraphStyle: TextStyle): TextStyle {
  const rPr = directChild(run, "rPr");

  return {
    ...paragraphStyle,
    ...parseRunProperties(rPr)
  };
}

function parseRunProperties(rPr?: Element): TextStyle {
  if (!rPr) {
    return {};
  }

  const fontSize = getNumberAttribute(rPr, "sz");
  const latin = directChild(rPr, "latin");
  const solidFill = directChild(rPr, "solidFill");
  const color = solidFill ? parseSolidFill(solidFill) : undefined;
  const style: TextStyle = {};

  if (fontSize) style.fontSize = fontSize / 100;
  if (latin?.getAttribute("typeface")) style.fontFace = latin.getAttribute("typeface") ?? undefined;
  if (rPr.getAttribute("b") === "1") style.bold = true;
  if (rPr.getAttribute("i") === "1") style.italic = true;
  if (rPr.getAttribute("u") && rPr.getAttribute("u") !== "none") style.underline = true;
  if (rPr.getAttribute("strike") && rPr.getAttribute("strike") !== "noStrike") style.strike = true;
  if (color) {
    style.color = color.color;
    style.transparency = color.transparency;
  }

  return style;
}

function parseSlideBackground(slideXml: Document): FillStyle | undefined {
  const bgPr = firstDescendant(slideXml.documentElement, "bgPr");

  if (!bgPr) {
    return undefined;
  }

  return parseFill(bgPr);
}

function parseShapeStyle(spPr?: Element, style?: Element): ShapeSlideElement["style"] {
  return {
    fill: parseFill(spPr),
    stroke: parseStroke(spPr, style)
  };
}

function parseFill(parent?: Element): FillStyle | undefined {
  if (!parent) {
    return undefined;
  }

  if (directChild(parent, "noFill")) {
    return { kind: "none" };
  }

  const solidFill = directChild(parent, "solidFill");

  if (solidFill) {
    return parseSolidFill(solidFill);
  }

  const gradFill = directChild(parent, "gradFill");

  if (gradFill) {
    const firstStop = firstDescendant(gradFill, "gs");
    const fallback = firstStop ? parseSolidFill(firstStop) : undefined;

    return {
      kind: "gradient",
      fallbackColor: fallback?.color ?? "CCCCCC",
      transparency: fallback?.transparency ?? 0,
      gradientType: "pptx"
    };
  }

  return undefined;
}

function parseSolidFill(solidFill: Element): Extract<FillStyle, { kind: "solid" }> {
  const colorNode = firstDescendant(solidFill, "srgbClr") ??
    firstDescendant(solidFill, "schemeClr") ??
    firstDescendant(solidFill, "prstClr");

  return {
    kind: "solid",
    color: getColorValue(colorNode),
    transparency: getTransparency(colorNode)
  };
}

function parseStroke(spPr?: Element, style?: Element): StrokeStyle | undefined {
  const ln = spPr ? directChild(spPr, "ln") : undefined;

  if (!ln || directChild(ln, "noFill")) {
    return undefined;
  }

  const fill = parseFill(ln);
  const styleColor = parseStyleLineColor(style);
  const widthEmu = getNumberAttribute(ln, "w");
  const width = widthEmu ? emuLineWidthToPx(widthEmu) : 1;

  if (fill?.kind === "none") {
    return undefined;
  }

  if (!fill && !styleColor) {
    return undefined;
  }

  return {
    color: fill?.kind === "solid" ? fill.color : styleColor ?? "000000",
    transparency: fill?.kind === "solid" ? fill.transparency : 0,
    width,
    dash: mapDash(firstDescendant(ln, "prstDash")?.getAttribute("val") ?? undefined)
  };
}

function parseStyleLineColor(style?: Element): string | undefined {
  const lineRef = firstDescendant(style, "lnRef");
  const colorNode = firstDescendant(lineRef, "srgbClr") ??
    firstDescendant(lineRef, "schemeClr") ??
    firstDescendant(lineRef, "prstClr");

  return colorNode ? getColorValue(colorNode) : undefined;
}

function parseBounds(spPr?: Element): Bounds | undefined {
  const xfrm = spPr ? directChild(spPr, "xfrm") : undefined;
  const off = xfrm ? directChild(xfrm, "off") : undefined;
  const ext = xfrm ? directChild(xfrm, "ext") : undefined;

  if (!off || !ext) {
    return undefined;
  }

  return {
    x: emuToPx(getNumberAttribute(off, "x")),
    y: emuToPx(getNumberAttribute(off, "y")),
    w: emuToPx(getNumberAttribute(ext, "cx")),
    h: emuToPx(getNumberAttribute(ext, "cy")),
    rotation: ((getNumberAttribute(xfrm, "rot") ?? 0) / 60000) % 360
  };
}

function parseConnectorBounds(spPr?: Element): Bounds | undefined {
  const xfrm = spPr ? directChild(spPr, "xfrm") : undefined;
  const bounds = parseBounds(spPr);

  if (!bounds || !xfrm) {
    return bounds;
  }

  const flipH = xfrm.getAttribute("flipH") === "1";
  const flipV = xfrm.getAttribute("flipV") === "1";

  return {
    ...bounds,
    x: flipH ? bounds.x + bounds.w : bounds.x,
    y: flipV ? bounds.y + bounds.h : bounds.y,
    w: flipH ? -bounds.w : bounds.w,
    h: flipV ? -bounds.h : bounds.h
  };
}

function parseGraphicFrameBounds(frameElement: Element): Bounds | undefined {
  const xfrm = directChild(frameElement, "xfrm");
  const off = xfrm ? directChild(xfrm, "off") : undefined;
  const ext = xfrm ? directChild(xfrm, "ext") : undefined;

  if (!off || !ext) {
    return undefined;
  }

  return {
    x: emuToPx(getNumberAttribute(off, "x")),
    y: emuToPx(getNumberAttribute(off, "y")),
    w: emuToPx(getNumberAttribute(ext, "cx")),
    h: emuToPx(getNumberAttribute(ext, "cy")),
    rotation: ((getNumberAttribute(xfrm, "rot") ?? 0) / 60000) % 360
  };
}

function parseChart(chartXml: Document, name: string, bounds: Bounds, warnings: string[]): SlideElement[] {
  const barChart = firstDescendant(chartXml.documentElement, "barChart");
  const doughnutChart = firstDescendant(chartXml.documentElement, "doughnutChart");

  if (barChart) {
    return parseBarChart(chartXml, barChart, name, bounds);
  }

  if (doughnutChart) {
    return parseDoughnutChart(doughnutChart, name, bounds);
  }

  warnings.push(`${name}: this chart type is not supported yet.`);
  return [];
}

function parseBarChart(chartXml: Document, chartElement: Element, name: string, bounds: Bounds): SlideElement[] {
  const title = parseChartTitle(chartXml);
  const series = parseChartSeries(chartElement);

  if (series.length === 0) {
    return [];
  }

  const isHorizontal = directChild(chartElement, "barDir")?.getAttribute("val") === "bar";
  const isStacked = directChild(chartElement, "grouping")?.getAttribute("val") === "stacked";
  const explicitMin = getNumberAttribute(firstDescendant(firstDescendant(chartXml.documentElement, "valAx"), "min"), "val");
  const explicitMax = getNumberAttribute(firstDescendant(firstDescendant(chartXml.documentElement, "valAx"), "max"), "val");

  return [createChartSvgElement(name, bounds, renderBarChartSvg({
    title,
    series,
    isHorizontal,
    isStacked,
    minValue: explicitMin,
    maxValue: explicitMax,
    width: Math.max(round(bounds.w), 1),
    height: Math.max(round(bounds.h), 1)
  }))];
}

function createColumnBars(
  name: string,
  series: Array<{ categories: string[]; values: number[]; color: string }>,
  plot: { x: number; y: number; w: number; h: number },
  minValue: number,
  maxValue: number
): SlideElement[] {
  const elements: SlideElement[] = [];
  const categoryCount = Math.max(...series.map(item => item.values.length));
  const seriesCount = series.length;
  const zeroY = plot.y + plot.h - ((0 - minValue) / Math.max(maxValue - minValue, 1)) * plot.h;

  elements.push(createLineElement(`${name} axis`, {
    x: plot.x,
    y: zeroY,
    w: plot.w,
    h: 0,
    rotation: 0
  }, {
    color: "FFFFFF",
    transparency: 60,
    width: 1
  }));

  for (let categoryIndex = 0; categoryIndex < categoryCount; categoryIndex += 1) {
    const groupWidth = plot.w / categoryCount;
    const barWidth = Math.max(2, groupWidth * 0.58 / seriesCount);

    for (let seriesIndex = 0; seriesIndex < seriesCount; seriesIndex += 1) {
      const item = series[seriesIndex];
      const value = item.values[categoryIndex];
      if (value === undefined) continue;

      const height = Math.max(1, (value - minValue) / Math.max(maxValue - minValue, 1) * plot.h);
      const x = plot.x + categoryIndex * groupWidth + groupWidth * 0.21 + seriesIndex * barWidth;
      const y = plot.y + plot.h - height;

      elements.push(createChartRect(`${name} ${item.categories[categoryIndex] ?? categoryIndex + 1}`, {
        x,
        y,
        w: barWidth,
        h: height,
        rotation: 0
      }, item.color));

      elements.push(createTextElement(`${name} value ${categoryIndex + 1}`, formatChartValue(value), {
        x: x - groupWidth * 0.1,
        y: y - 24,
        w: groupWidth,
        h: 20,
        rotation: 0
      }, chartLabelStyle(13, "center")));
    }

    const label = series[0].categories[categoryIndex];
    if (label) {
      elements.push(createTextElement(`${name} label ${label}`, label, {
        x: plot.x + categoryIndex * groupWidth,
        y: plot.y + plot.h + 8,
        w: groupWidth,
        h: 24,
        rotation: 0
      }, chartLabelStyle(12, "center")));
    }
  }

  return elements;
}

function createHorizontalBars(
  name: string,
  series: Array<{ categories: string[]; values: number[]; color: string }>,
  plot: { x: number; y: number; w: number; h: number },
  minValue: number,
  maxValue: number
): SlideElement[] {
  const elements: SlideElement[] = [];
  const item = series[0];
  const count = item.values.length;
  const rowHeight = plot.h / Math.max(count, 1);
  const barHeight = Math.max(2, rowHeight * 0.52);

  for (let index = 0; index < count; index += 1) {
    const value = item.values[index];
    const width = Math.max(1, (value - minValue) / Math.max(maxValue - minValue, 1) * plot.w);
    const y = plot.y + index * rowHeight + (rowHeight - barHeight) / 2;

    elements.push(createTextElement(`${name} label ${index + 1}`, item.categories[index] ?? "", {
      x: plot.x - plot.w * 0.26,
      y: y - 2,
      w: plot.w * 0.24,
      h: barHeight + 4,
      rotation: 0
    }, chartLabelStyle(12, "right")));

    elements.push(createChartRect(`${name} bar ${index + 1}`, {
      x: plot.x,
      y,
      w: width,
      h: barHeight,
      rotation: 0
    }, item.color));

    elements.push(createTextElement(`${name} value ${index + 1}`, formatChartValue(value), {
      x: plot.x + width + 6,
      y: y - 2,
      w: 80,
      h: barHeight + 4,
      rotation: 0
    }, chartLabelStyle(12, "left")));
  }

  return elements;
}

function parseDoughnutChart(chartElement: Element, name: string, bounds: Bounds): SlideElement[] {
  const ser = directChildren(chartElement, "ser")[0];
  const values = ser ? readNumericCacheValues(firstDescendant(directChild(ser, "val"), "numCache")) : [];
  const categories = ser ? readChartCategories(ser) : [];

  if (!ser || values.length === 0) {
    return [];
  }

  const colors = values.map((_, index) => getDataPointColor(ser, index));
  const holeSize = (getNumberAttribute(directChild(chartElement, "holeSize"), "val") ?? 50) / 100;
  const svg = renderDoughnutChartSvg({
    values,
    categories,
    colors,
    holeSize,
    width: Math.max(round(bounds.w), 1),
    height: Math.max(round(bounds.h), 1)
  });

  return [createChartSvgElement(name, bounds, svg)];
}

interface ChartSeries {
  label: string;
  categories: string[];
  values: number[];
  valueFormat?: string;
  color: string;
}

function parseChartSeries(chartElement: Element): ChartSeries[] {
  return directChildren(chartElement, "ser")
    .map((ser, index) => ({
      label: readSeriesLabel(ser),
      categories: readChartCategories(ser),
      values: readNumericCacheValues(firstDescendant(directChild(ser, "val"), "numCache")),
      valueFormat: firstDescendant(directChild(ser, "val"), "formatCode")?.textContent ?? undefined,
      color: getSeriesColor(ser, index)
    }))
    .filter(item => item.values.length > 0);
}

function createChartSvgElement(name: string, bounds: Bounds, svg: string): SvgSlideElement {
  return {
    ...createBaseElement(name, bounds),
    sourceMode: "SVG",
    type: "svg",
    svg
  };
}

function renderBarChartSvg(options: {
  title?: string;
  series: ChartSeries[];
  isHorizontal: boolean;
  isStacked: boolean;
  minValue?: number;
  maxValue?: number;
  width: number;
  height: number;
}): string {
  const { title, series, isHorizontal, isStacked, width, height } = options;
  const categoryCount = Math.max(...series.map(item => item.values.length));
  const categories = getBestCategories(series);
  const dataMax = isStacked ? getMaxStackValue(series, categoryCount) : Math.max(...series.flatMap(item => item.values));
  const minValue = options.minValue ?? 0;
  const maxValue = options.maxValue ?? Math.max(dataMax, minValue + 1);
  const titleHeight = title ? clamp(height * 0.13, 34, 72) : clamp(height * 0.03, 12, 28);
  const margin = {
    top: titleHeight + 12,
    right: isHorizontal ? clamp(width * 0.1, 42, 110) : clamp(width * 0.04, 18, 54),
    bottom: clamp(height * 0.11, 34, 70),
    left: isHorizontal ? clamp(width * 0.24, 90, 180) : clamp(width * 0.08, 38, 86)
  };
  const plot = {
    x: margin.left,
    y: margin.top,
    w: Math.max(width - margin.left - margin.right, 20),
    h: Math.max(height - margin.top - margin.bottom, 20)
  };
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
  ];

  if (title) {
    parts.push(svgText(title, width / 2, titleHeight * 0.58, {
      size: clamp(height * 0.045, 18, 36),
      weight: 700,
      anchor: "middle"
    }));
  }

  parts.push(`<line x1="${plot.x}" y1="${plot.y + plot.h}" x2="${plot.x + plot.w}" y2="${plot.y + plot.h}" stroke="#FFFFFF" stroke-opacity="0.35" stroke-width="1"/>`);

  if (isHorizontal) {
    parts.push(renderHorizontalBarSvg(series, categories, plot, minValue, maxValue, isStacked));
  } else {
    parts.push(renderColumnBarSvg(series, categories, plot, minValue, maxValue, isStacked));
  }

  if (series.length > 1) {
    parts.push(renderLegendSvg(series, plot.x, height - margin.bottom + 34, plot.w));
  }

  parts.push("</svg>");

  return parts.join("");
}

function renderColumnBarSvg(
  series: ChartSeries[],
  categories: string[],
  plot: { x: number; y: number; w: number; h: number },
  minValue: number,
  maxValue: number,
  isStacked: boolean
): string {
  const parts: string[] = [];
  const categoryCount = Math.max(categories.length, ...series.map(item => item.values.length));
  const groupWidth = plot.w / Math.max(categoryCount, 1);
  const baseline = plot.y + plot.h;

  for (let categoryIndex = 0; categoryIndex < categoryCount; categoryIndex += 1) {
    const label = categories[categoryIndex] ?? String(categoryIndex + 1);

    if (isStacked) {
      const barWidth = Math.max(4, groupWidth * 0.5);
      let stackTop = baseline;
      let stackValue = 0;

      for (const item of series) {
        const value = item.values[categoryIndex] ?? 0;
        const height = valueToLength(value, minValue, maxValue, plot.h);
        const x = plot.x + categoryIndex * groupWidth + (groupWidth - barWidth) / 2;
        const y = stackTop - height;

        if (height > 0.5) {
          parts.push(svgRect(x, y, barWidth, height, item.color));
          if (height > 18) {
            parts.push(svgText(formatChartValue(value, item.valueFormat), x + barWidth / 2, y + height / 2 + 4, {
              size: 11,
              weight: 700,
              anchor: "middle"
            }));
          }
        }

        stackTop = y;
        stackValue += value;
      }

      parts.push(svgText(formatChartValue(stackValue), plot.x + categoryIndex * groupWidth + groupWidth / 2, stackTop - 8, {
        size: 11,
        weight: 700,
        anchor: "middle"
      }));
    } else {
      const barWidth = Math.max(3, groupWidth * 0.62 / Math.max(series.length, 1));

      for (let seriesIndex = 0; seriesIndex < series.length; seriesIndex += 1) {
        const item = series[seriesIndex];
        const value = item.values[categoryIndex] ?? 0;
        const height = valueToLength(value, minValue, maxValue, plot.h);
        const x = plot.x + categoryIndex * groupWidth + groupWidth * 0.19 + seriesIndex * barWidth;
        const y = baseline - height;

        parts.push(svgRect(x, y, barWidth, height, item.color));
        parts.push(svgText(formatChartValue(value, item.valueFormat), x + barWidth / 2, y - 8, {
          size: 11,
          weight: 700,
          anchor: "middle"
        }));
      }
    }

    parts.push(svgText(label, plot.x + categoryIndex * groupWidth + groupWidth / 2, baseline + 22, {
      size: 12,
      weight: 700,
      anchor: "middle"
    }));
  }

  return parts.join("");
}

function renderHorizontalBarSvg(
  series: ChartSeries[],
  categories: string[],
  plot: { x: number; y: number; w: number; h: number },
  minValue: number,
  maxValue: number,
  isStacked: boolean
): string {
  const parts: string[] = [];
  const categoryCount = Math.max(categories.length, ...series.map(item => item.values.length));
  const rowHeight = plot.h / Math.max(categoryCount, 1);
  const barHeight = Math.max(3, rowHeight * 0.56);

  for (let categoryIndex = 0; categoryIndex < categoryCount; categoryIndex += 1) {
    const y = plot.y + categoryIndex * rowHeight + (rowHeight - barHeight) / 2;
    let x = plot.x;

    parts.push(svgText(categories[categoryIndex] ?? String(categoryIndex + 1), plot.x - 10, y + barHeight / 2 + 4, {
      size: 12,
      weight: 700,
      anchor: "end"
    }));

    for (let seriesIndex = 0; seriesIndex < series.length; seriesIndex += 1) {
      const item = series[seriesIndex];
      const value = item.values[categoryIndex] ?? 0;
      const width = valueToLength(value, minValue, maxValue, plot.w);
      const barY = isStacked ? y : y + seriesIndex * (barHeight / Math.max(series.length, 1));
      const actualHeight = isStacked ? barHeight : barHeight / Math.max(series.length, 1);

      parts.push(svgRect(x, barY, width, actualHeight, item.color));

      if (width > 34) {
        parts.push(svgText(formatChartValue(value, item.valueFormat), x + width - 6, barY + actualHeight / 2 + 4, {
          size: 11,
          weight: 700,
          anchor: "end"
        }));
      }

      x = isStacked ? x + width : plot.x;
    }
  }

  return parts.join("");
}

function renderDoughnutChartSvg(options: {
  values: number[];
  categories: string[];
  colors: string[];
  holeSize: number;
  width: number;
  height: number;
}): string {
  const { values, categories, colors, holeSize, width, height } = options;
  const size = Math.min(width, height) * 0.78;
  const cx = width * 0.5;
  const cy = height * 0.47;
  const outerRadius = size / 2;
  const innerRadius = outerRadius * Math.max(0.05, Math.min(holeSize, 0.9));
  const total = values.reduce((sum, value) => sum + value, 0) || 1;
  let cursor = -90;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`];

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const sweep = value / total * 360;
    const path = describeDonutSegment(cx, cy, outerRadius, innerRadius, cursor, cursor + sweep);
    const angle = (cursor + sweep / 2) * Math.PI / 180;
    const labelRadius = outerRadius * 0.74;
    const label = formatChartValue(value, "0%");

    parts.push(`<path d="${path}" fill="#${colors[index] ?? getChartColor(index)}" stroke="#FFFFFF" stroke-opacity="0.95" stroke-width="2"/>`);

    if (sweep > 10) {
      parts.push(svgText(label, cx + Math.cos(angle) * labelRadius, cy + Math.sin(angle) * labelRadius + 4, {
        size: clamp(Math.min(width, height) * 0.036, 12, 22),
        weight: 700,
        anchor: "middle"
      }));
    }

    cursor += sweep;
  }

  if (categories.length > 0) {
    parts.push(renderLegendSvg(values.map((value, index) => ({
      label: `${categories[index] ?? index + 1}: ${formatChartValue(value, "0%")}`,
      categories: [],
      values: [value],
      color: colors[index] ?? getChartColor(index)
    })), width * 0.08, height - 36, width * 0.84));
  }

  parts.push("</svg>");
  return parts.join("");
}

function createChartRect(name: string, bounds: Bounds, color: string): ShapeSlideElement {
  return createShapeElement(name, bounds, "rect", {
    fill: {
      kind: "solid",
      color,
      transparency: 0
    },
    stroke: undefined
  });
}

function createTextElement(name: string, text: string, bounds: Bounds, style: TextStyle): TextSlideElement {
  return {
    ...createBaseElement(name, bounds),
    sourceMode: "PPT_TEXT",
    type: "text",
    text,
    autoResize: "NONE",
    style,
    runs: [{
      text,
      style
    }]
  };
}

function chartLabelStyle(fontSize: number, align: TextStyle["align"]): TextStyle {
  return {
    fontFace: "Arial",
    fontSize,
    bold: true,
    color: "FFFFFF",
    align,
    valign: "middle"
  };
}

function parseChartTitle(chartXml: Document): string | undefined {
  const title = firstDescendant(chartXml.documentElement, "title");
  const text = title ? getTextContent(firstDescendant(title, "t")).trim() : "";

  return text || undefined;
}

function readCacheValues(cache: Element | undefined): string[] {
  if (!cache) {
    return [];
  }

  return directChildren(cache, "pt")
    .sort((a, b) => (getNumberAttribute(a, "idx") ?? 0) - (getNumberAttribute(b, "idx") ?? 0))
    .map(point => getTextContent(directChild(point, "v")));
}

function readNumericCacheValues(cache: Element | undefined): number[] {
  return readCacheValues(cache)
    .map(value => Number(value.replace(",", ".")))
    .filter(Number.isFinite);
}

function readChartCategories(ser: Element): string[] {
  const stringCategories = readCacheValues(firstDescendant(directChild(ser, "cat"), "strCache"));

  return stringCategories.length > 0
    ? stringCategories
    : readCacheValues(firstDescendant(directChild(ser, "cat"), "numCache"));
}

function readSeriesLabel(ser: Element): string {
  const tx = directChild(ser, "tx");

  return getTextContent(firstDescendant(tx, "v")) ||
    getTextContent(firstDescendant(tx, "t"));
}

function getBestCategories(series: ChartSeries[]): string[] {
  return series.find(item => item.categories.length > 0)?.categories ?? [];
}

function getMaxStackValue(series: ChartSeries[], categoryCount: number): number {
  let maxValue = 0;

  for (let categoryIndex = 0; categoryIndex < categoryCount; categoryIndex += 1) {
    const stackValue = series.reduce((sum, item) => sum + Math.max(item.values[categoryIndex] ?? 0, 0), 0);
    maxValue = Math.max(maxValue, stackValue);
  }

  return maxValue;
}

function valueToLength(value: number, minValue: number, maxValue: number, length: number): number {
  return Math.max(0, (value - minValue) / Math.max(maxValue - minValue, 1) * length);
}

function renderLegendSvg(series: Array<Pick<ChartSeries, "label" | "color">>, x: number, y: number, width: number): string {
  const parts: string[] = [];
  const itemHeight = 18;
  let currentX = x;
  let currentY = y;

  for (const item of series) {
    const label = item.label || "";
    const estimatedWidth = clamp(label.length * 7 + 26, 48, 170);

    if (currentX + estimatedWidth > x + width && currentX > x) {
      currentX = x;
      currentY += itemHeight;
    }

    parts.push(`<rect x="${round(currentX)}" y="${round(currentY - 10)}" width="10" height="10" fill="#${item.color}"/>`);
    parts.push(svgText(label, currentX + 16, currentY, {
      size: 11,
      weight: 700,
      anchor: "start"
    }));
    currentX += estimatedWidth;
  }

  return parts.join("");
}

function svgRect(x: number, y: number, width: number, height: number, color: string): string {
  return `<rect x="${round(x)}" y="${round(y)}" width="${round(Math.max(width, 0))}" height="${round(Math.max(height, 0))}" fill="#${color}"/>`;
}

function svgText(text: string, x: number, y: number, options: { size: number; weight: number; anchor: "start" | "middle" | "end" }): string {
  return `<text x="${round(x)}" y="${round(y)}" fill="#FFFFFF" font-family="Arial, sans-serif" font-size="${round(options.size)}" font-weight="${options.weight}" text-anchor="${options.anchor}">${escapeSvgText(text)}</text>`;
}

function escapeSvgText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getSeriesColor(ser: Element, index: number): string {
  const fill = parseFill(directChild(ser, "spPr"));

  return fill?.kind === "solid" ? fill.color : getChartColor(index);
}

function getDataPointColor(ser: Element, index: number): string {
  const point = directChildren(ser, "dPt")
    .find(item => getNumberAttribute(directChild(item, "idx"), "val") === index);
  const fill = parseFill(directChild(point, "spPr"));

  return fill?.kind === "solid" ? fill.color : getChartColor(index);
}

function getChartColor(index: number): string {
  const colors = ["4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47"];

  return colors[index % colors.length];
}

function formatChartValue(value: number, formatCode?: string): string {
  const shouldFormatAsPercent = Boolean(formatCode?.includes("%")) ||
    (Math.abs(value) > 0 && Math.abs(value) < 1);

  if (shouldFormatAsPercent) {
    return `${Math.round(value * 100)}%`;
  }

  return Number.isInteger(value) ? String(value) : value.toLocaleString("ru-RU", {
    maximumFractionDigits: 2
  });
}

function createDoughnutSvg(values: number[], colors: string[], holeSize: number): string {
  const size = 1000;
  const outerRadius = 470;
  const innerRadius = outerRadius * Math.max(0.05, Math.min(holeSize, 0.9));
  const center = size / 2;
  const total = values.reduce((sum, value) => sum + value, 0) || 1;
  let cursor = -90;
  const paths = values.map((value, index) => {
    const sweep = value / total * 360;
    const path = describeDonutSegment(center, center, outerRadius, innerRadius, cursor, cursor + sweep);
    cursor += sweep;
    return `<path d="${path}" fill="#${colors[index]}"/>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${paths.join("")}</svg>`;
}

function describeDonutSegment(cx: number, cy: number, outerRadius: number, innerRadius: number, startAngle: number, endAngle: number): string {
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  const startOuter = polarPoint(cx, cy, outerRadius, endAngle);
  const endOuter = polarPoint(cx, cy, outerRadius, startAngle);
  const startInner = polarPoint(cx, cy, innerRadius, startAngle);
  const endInner = polarPoint(cx, cy, innerRadius, endAngle);

  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 0 ${endOuter.x} ${endOuter.y}`,
    `L ${startInner.x} ${startInner.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 1 ${endInner.x} ${endInner.y}`,
    "Z"
  ].join(" ");
}

function polarPoint(cx: number, cy: number, radius: number, angleDegrees: number) {
  const angle = angleDegrees * Math.PI / 180;

  return {
    x: round(cx + radius * Math.cos(angle)),
    y: round(cy + radius * Math.sin(angle))
  };
}

function parseGroupTransform(grpSpPr: Element, parent: CoordinateContext): CoordinateContext {
  const xfrm = directChild(grpSpPr, "xfrm");
  const off = xfrm ? directChild(xfrm, "off") : undefined;
  const ext = xfrm ? directChild(xfrm, "ext") : undefined;
  const chOff = xfrm ? directChild(xfrm, "chOff") : undefined;
  const chExt = xfrm ? directChild(xfrm, "chExt") : undefined;

  if (!off || !ext || !chOff || !chExt) {
    return parent;
  }

  const groupX = emuToPx(getNumberAttribute(off, "x"));
  const groupY = emuToPx(getNumberAttribute(off, "y"));
  const groupW = emuToPx(getNumberAttribute(ext, "cx"));
  const groupH = emuToPx(getNumberAttribute(ext, "cy"));
  const childX = emuToPx(getNumberAttribute(chOff, "x"));
  const childY = emuToPx(getNumberAttribute(chOff, "y"));
  const childW = Math.max(emuToPx(getNumberAttribute(chExt, "cx")), 1);
  const childH = Math.max(emuToPx(getNumberAttribute(chExt, "cy")), 1);
  const groupScaleX = groupW / childW;
  const groupScaleY = groupH / childH;

  return {
    offsetX: parent.offsetX + (groupX - childX * groupScaleX) * parent.scaleX,
    offsetY: parent.offsetY + (groupY - childY * groupScaleY) * parent.scaleY,
    scaleX: parent.scaleX * groupScaleX,
    scaleY: parent.scaleY * groupScaleY
  };
}

function mapBounds(bounds: Bounds | undefined, context: CoordinateContext): Bounds | undefined {
  if (!bounds) {
    return undefined;
  }

  return {
    x: round(context.offsetX + bounds.x * context.scaleX),
    y: round(context.offsetY + bounds.y * context.scaleY),
    w: round(Math.max(bounds.w * context.scaleX, 1)),
    h: round(Math.max(bounds.h * context.scaleY, 1)),
    rotation: bounds.rotation
  };
}

function createShapeElement(
  name: string,
  bounds: Bounds,
  preset: string,
  style: ShapeSlideElement["style"]
): ShapeSlideElement {
  return {
    ...createBaseElement(name, bounds),
    type: "shape",
    shape: toKnownShape(preset),
    style
  };
}

function createLineElement(name: string, bounds: Bounds, stroke?: StrokeStyle): LineSlideElement {
  return {
    ...createBaseElement(name, bounds),
    sourceMode: "PPT_LINE",
    type: "line",
    style: {
      stroke
    }
  };
}

function createBaseElement(name: string, bounds: Bounds) {
  return {
    id: `${name}-${Math.random().toString(36).slice(2)}`,
    name,
    x: bounds.x,
    y: bounds.y,
    w: bounds.w,
    h: bounds.h,
    rotation: bounds.rotation,
    opacity: 1,
    sourceMode: "PPT_SHAPE" as const
  };
}

function hasVisibleShapeStyle(style: ShapeSlideElement["style"]): boolean {
  return (style.fill !== undefined && style.fill.kind !== "none" && getFillTransparency(style.fill) < 100) ||
    (style.stroke !== undefined && style.stroke.width > 0 && style.stroke.transparency < 100);
}

function getFillTransparency(fill: FillStyle): number {
  if (fill.kind === "none") return 100;
  return fill.transparency;
}

function getSlidePaths(presentationXml: Document, rels: Map<string, Relationship>, zip: JSZip): string[] {
  const slideIds = Array.from(firstDescendant(presentationXml.documentElement, "sldIdLst")?.children ?? [])
    .filter(element => element.localName === "sldId");
  const paths = slideIds
    .map(slideId => getRelationshipId(slideId))
    .map(relationshipId => relationshipId ? rels.get(relationshipId) : undefined)
    .filter((relationship): relationship is Relationship => Boolean(relationship))
    .map(relationship => resolveTarget("ppt/presentation.xml", relationship.target));

  if (paths.length > 0) {
    return paths;
  }

  return Object.keys(zip.files)
    .filter(path => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => getTrailingNumber(a) - getTrailingNumber(b));
}

function getSlideSize(presentationXml: Document) {
  const sizeElement = firstDescendant(presentationXml.documentElement, "sldSz");

  return {
    width: emuToPx(getNumberAttribute(sizeElement, "cx") ?? DEFAULT_SLIDE_WIDTH_EMU),
    height: emuToPx(getNumberAttribute(sizeElement, "cy") ?? DEFAULT_SLIDE_HEIGHT_EMU)
  };
}

async function readRelationships(zip: JSZip, sourcePath: string): Promise<Map<string, Relationship>> {
  const relPath = getRelationshipPath(sourcePath);
  const relFile = zip.file(relPath);
  const relationships = new Map<string, Relationship>();

  if (!relFile) {
    return relationships;
  }

  const relXml = parseXml(await relFile.async("text"), relPath);

  for (const element of Array.from(relXml.documentElement.children)) {
    if (element.localName !== "Relationship") {
      continue;
    }

    const id = element.getAttribute("Id");
    const target = element.getAttribute("Target");

    if (!id || !target) {
      continue;
    }

    relationships.set(id, {
      id,
      target,
      targetMode: element.getAttribute("TargetMode") ?? undefined
    });
  }

  return relationships;
}

async function readXml(zip: JSZip, path: string): Promise<Document> {
  const file = zip.file(path);

  if (!file) {
    throw new Error(`This PPTX file is missing a required file: ${path}.`);
  }

  return parseXml(await file.async("text"), path);
}

function parseXml(xml: string, path: string): Document {
  const document = new DOMParser().parseFromString(xml, "application/xml");

  if (document.getElementsByTagName("parsererror").length > 0) {
    throw new Error(`This PPTX file contains unreadable slide data: ${path}.`);
  }

  return document;
}

function directChild(element: Element | undefined, localName: string): Element | undefined {
  if (!element) {
    return undefined;
  }

  return Array.from(element.children).find(child => child.localName === localName);
}

function directChildren(element: Element, localName: string): Element[] {
  return Array.from(element.children).filter(child => child.localName === localName);
}

function firstDescendant(element: Element | undefined, localName: string): Element | undefined {
  if (!element) {
    return undefined;
  }

  if (element.localName === localName) {
    return element;
  }

  for (const child of Array.from(element.children)) {
    const match = firstDescendant(child, localName);
    if (match) return match;
  }

  return undefined;
}

function getAttribute(element: Element | undefined, localName: string): string | undefined {
  if (!element) {
    return undefined;
  }

  for (const attribute of Array.from(element.attributes)) {
    if (attribute.localName === localName) {
      return attribute.value;
    }
  }

  return undefined;
}

function getRelationshipId(element: Element): string | undefined {
  return element.getAttribute("r:id") ??
    Array.from(element.attributes).find(attribute => attribute.name === "r:id")?.value;
}

function getNumberAttribute(element: Element | undefined, localName: string): number | undefined {
  const raw = element ? getAttribute(element, localName) : undefined;
  const value = raw === undefined ? undefined : Number(raw);

  return Number.isFinite(value) ? value : undefined;
}

function getTextContent(element: Element | undefined): string {
  return element?.textContent ?? "";
}

function getElementName(element: Element, fallback: string): string {
  return firstDescendant(element, "cNvPr")?.getAttribute("name") ?? fallback;
}

function getShapePreset(spPr?: Element): string {
  return firstDescendant(spPr, "prstGeom")?.getAttribute("prst") ?? "rect";
}

function toKnownShape(preset: string): ShapeSlideElement["shape"] {
  return SHAPE_TYPES.has(preset as ShapeSlideElement["shape"])
    ? preset as ShapeSlideElement["shape"]
    : "rect";
}

function getColorValue(colorNode: Element | undefined): string {
  if (!colorNode) {
    return "000000";
  }

  const value = colorNode.getAttribute("val");

  if (colorNode.localName === "srgbClr" && value) {
    return value.toUpperCase();
  }

  if (colorNode.localName === "prstClr" && value) {
    return mapPresetColor(value);
  }

  if (colorNode.localName === "schemeClr" && value) {
    return mapSchemeColor(value);
  }

  return "000000";
}

function getTransparency(colorNode: Element | undefined): number {
  const alpha = getNumberAttribute(firstDescendant(colorNode, "alpha"), "val");

  if (alpha === undefined) {
    return 0;
  }

  return round(100 - alpha / 1000);
}

function mapTextAlign(value: string | null | undefined): TextStyle["align"] {
  if (value === "ctr") return "center";
  if (value === "r") return "right";
  if (value === "just" || value === "dist") return "justify";
  return "left";
}

function mapTextVAlign(value: string | null | undefined): TextVAlign {
  if (value === "mid") return "middle";
  if (value === "btm") return "bottom";
  return "top";
}

function mapDash(value: string | undefined): StrokeStyle["dash"] {
  if (value === "dash") return "dash";
  if (value === "dashDot") return "dashDot";
  return "solid";
}

function getImageMimeType(path: string): ImageSlideElement["data"]["mimeType"] | "image/svg+xml" | undefined {
  const lowerPath = path.toLowerCase();

  if (lowerPath.endsWith(".png")) return "image/png";
  if (lowerPath.endsWith(".jpg") || lowerPath.endsWith(".jpeg")) return "image/jpeg";
  if (lowerPath.endsWith(".svg")) return "image/svg+xml";
  return undefined;
}

function resolveTarget(sourcePath: string, target: string): string {
  if (target.startsWith("/")) {
    return normalizePath(target.slice(1));
  }

  return normalizePath(`${sourcePath.slice(0, sourcePath.lastIndexOf("/") + 1)}${target}`);
}

function getRelationshipPath(sourcePath: string): string {
  const slashIndex = sourcePath.lastIndexOf("/");
  const dir = slashIndex === -1 ? "" : sourcePath.slice(0, slashIndex + 1);
  const fileName = slashIndex === -1 ? sourcePath : sourcePath.slice(slashIndex + 1);

  return `${dir}_rels/${fileName}.rels`;
}

function normalizePath(path: string): string {
  const parts: string[] = [];

  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }

    parts.push(part);
  }

  return parts.join("/");
}

function getSlideName(index: number): string {
  return `Slide ${index + 1}`;
}

function getTrailingNumber(path: string): number {
  return Number(path.match(/(\d+)\.xml$/)?.[1] ?? 0);
}

function emuToPx(value = 0): number {
  return round(value / EMU_PER_INCH * PX_PER_INCH);
}

function emuLineWidthToPx(value: number): number {
  return round(value / 12700 * PX_PER_INCH / 72);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mapSchemeColor(value: string): string {
  const colors: Record<string, string> = {
    bg1: "FFFFFF",
    tx1: "000000",
    bg2: "F2F2F2",
    tx2: "1F1F1F",
    accent1: "4472C4",
    accent2: "ED7D31",
    accent3: "A5A5A5",
    accent4: "FFC000",
    accent5: "5B9BD5",
    accent6: "70AD47",
    dk1: "000000",
    lt1: "FFFFFF",
    dk2: "1F1F1F",
    lt2: "F2F2F2"
  };

  return colors[value] ?? "000000";
}

function mapPresetColor(value: string): string {
  const colors: Record<string, string> = {
    black: "000000",
    white: "FFFFFF",
    red: "FF0000",
    green: "008000",
    blue: "0000FF",
    yellow: "FFFF00",
    cyan: "00FFFF",
    magenta: "FF00FF",
    gray: "808080"
  };

  return colors[value] ?? "000000";
}
