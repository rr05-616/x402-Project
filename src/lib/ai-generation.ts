export const SUPPORTED_LAYOUTS = [
  "title-hero",
  "two-column",
  "feature-cards",
  "process-flow",
  "timeline",
  "architecture",
  "data-visualization",
  "image-text",
  "summary",
] as const;

export type SupportedLayout = (typeof SUPPORTED_LAYOUTS)[number];

export interface ProjectFact {
  id: string;
  statement: string;
  sourceQuote: string;
}

export interface ProjectBrief {
  projectName?: string;
  problem?: string;
  audience?: string;
  solution?: string;
  features: string[];
  technology: string[];
  valueProposition?: string;
  facts: ProjectFact[];
  unknowns: string[];
}

export interface SlideOutlineItem {
  id: string;
  title: string;
  purpose: string;
  layout: SupportedLayout;
  evidenceFactIds: string[];
}

export interface SlideOutline {
  slideCount: 12 | 13;
  slides: SlideOutlineItem[];
}

export interface SlideElement {
  id: string;
  type: "text" | "shape" | "image" | "chart" | "diagram" | "table";
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface CanonicalSlide {
  id: string;
  title: string;
  purpose: string;
  layout: SupportedLayout;
  body: string[];
  evidenceFactIds: string[];
  elements: SlideElement[];
}

/** Server-side provider contract; credentials must never be supplied by the browser. */
export interface PitchForgeAIProvider {
  extractProjectBrief(source: string): Promise<ProjectBrief>;
  createOutline(
    brief: ProjectBrief,
    slideCount: 12 | 13,
  ): Promise<SlideOutline>;
  generateSlides(
    brief: ProjectBrief,
    outline: SlideOutline,
  ): Promise<CanonicalSlide[]>;
}

export interface GeneratedPresentation {
  brief: ProjectBrief;
  outline: SlideOutline;
  slides: CanonicalSlide[];
}

function normalize(text: string): string {
  return text.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function validateBrief(source: string, brief: ProjectBrief): void {
  if (!Array.isArray(brief.facts) || !Array.isArray(brief.unknowns)) {
    throw new Error("The AI provider returned an invalid project brief.");
  }
  const sourceText = normalize(source);
  const factIds = new Set<string>();
  for (const fact of brief.facts) {
    if (
      !fact.id.trim() ||
      !fact.statement.trim() ||
      !fact.sourceQuote.trim() ||
      factIds.has(fact.id) ||
      !sourceText.includes(normalize(fact.sourceQuote))
    ) {
      throw new Error(
        "The AI provider returned a fact that cannot be traced to the supplied source.",
      );
    }
    factIds.add(fact.id);
  }
}

function validateOutline(
  outline: SlideOutline,
  expectedCount: 12 | 13,
  knownFacts: Set<string>,
): void {
  if (
    outline.slideCount !== expectedCount ||
    !Array.isArray(outline.slides) ||
    outline.slides.length !== expectedCount ||
    outline.slides.length > 13
  ) {
    throw new Error(
      `The AI provider must return exactly ${expectedCount} slides.`,
    );
  }
  const ids = new Set<string>();
  const titles = new Set<string>();
  for (const slide of outline.slides) {
    const title = normalize(slide.title);
    if (!slide.id.trim() || !title || !slide.purpose.trim()) {
      throw new Error(
        "Every outlined slide needs an ID, title, and distinct purpose.",
      );
    }
    if (ids.has(slide.id) || titles.has(title)) {
      throw new Error(
        "The AI provider returned duplicate slide IDs or titles.",
      );
    }
    if (!SUPPORTED_LAYOUTS.includes(slide.layout)) {
      throw new Error(`Unsupported slide layout: ${slide.layout}`);
    }
    if (slide.evidenceFactIds.some((id) => !knownFacts.has(id))) {
      throw new Error(
        `Slide "${slide.title}" references facts absent from the project brief.`,
      );
    }
    ids.add(slide.id);
    titles.add(title);
  }
}

function validateSlides(
  slides: CanonicalSlide[],
  outline: SlideOutline,
  knownFacts: Set<string>,
): void {
  if (slides.length !== outline.slides.length || slides.length > 13) {
    throw new Error(
      "Generated slide content does not match the approved outline.",
    );
  }
  const slideIds = new Set<string>();
  for (const [index, slide] of slides.entries()) {
    const planned = outline.slides[index];
    if (
      slide.id !== planned.id ||
      slide.title.trim() !== planned.title.trim() ||
      slide.purpose.trim() !== planned.purpose.trim() ||
      slide.layout !== planned.layout ||
      slide.body.length === 0 ||
      slide.body.some((text) => !text.trim()) ||
      slide.evidenceFactIds.some(
        (id) => !knownFacts.has(id) || !planned.evidenceFactIds.includes(id),
      ) ||
      slideIds.has(slide.id)
    ) {
      throw new Error(
        `Generated content for slide ${index + 1} does not match its approved outline.`,
      );
    }
    for (const element of slide.elements) {
      if (
        !element.id.trim() ||
        element.x < 0 ||
        element.y < 0 ||
        element.width <= 0 ||
        element.height <= 0 ||
        element.x + element.width > 100 ||
        element.y + element.height > 100
      ) {
        throw new Error(
          `Slide "${slide.title}" contains an invalid layout element.`,
        );
      }
    }
    slideIds.add(slide.id);
  }
}

export async function generatePresentation(
  source: string,
  provider: PitchForgeAIProvider,
  slideCount: 12 | 13 = 12,
): Promise<GeneratedPresentation> {
  if (source.trim().length < 20) {
    throw new Error(
      "Provide at least 20 characters of project source material.",
    );
  }
  const brief = await provider.extractProjectBrief(source);
  validateBrief(source, brief);

  const outline = await provider.createOutline(brief, slideCount);
  const knownFacts = new Set(brief.facts.map((fact) => fact.id));
  validateOutline(outline, slideCount, knownFacts);

  const slides = await provider.generateSlides(brief, outline);
  validateSlides(slides, outline, knownFacts);
  return { brief, outline, slides };
}
