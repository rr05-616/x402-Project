import assert from "node:assert/strict";
import JSZip from "jszip";
import { buildDeck, SAMPLE_README_RICH } from "../src/lib/deck";
import { createPptxBlob } from "../src/lib/pptx";

const deck = buildDeck(SAMPLE_README_RICH);
assert.equal(
  deck.slideCount,
  12,
  "The default generated deck must have 12 slides.",
);

const pptx = await createPptxBlob(deck);
assert.ok(pptx.size > 100, "The generated PowerPoint must not be empty.");

const zip = await JSZip.loadAsync(await pptx.arrayBuffer());
const getSlideXml = async (archive: JSZip, expectedCount: number) => {
  const slidePaths = Object.keys(archive.files).filter((path) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(path),
  );
  assert.equal(
    slidePaths.length,
    expectedCount,
    `The PowerPoint must contain exactly ${expectedCount} slide XML files.`,
  );
  return Promise.all(
    slidePaths.map((path) => archive.file(path)!.async("string")),
  );
};

const slideXml = await getSlideXml(zip, 12);
assert.ok(
  slideXml.every((xml) => xml.includes("<p:sp>") && xml.includes("<a:t>")),
  "Slides must contain editable PowerPoint shapes and text.",
);
assert.ok(
  slideXml.join("\n").includes(deck.title),
  "The generated project title must appear in editable slide text.",
);

const fundedDeck = buildDeck(
  `${SAMPLE_README_RICH}\n\n## Funding Ask\nWe are raising $1,000,000 to expand the product.`,
  13,
);
const fundedPptx = await createPptxBlob(fundedDeck);
const fundedZip = await JSZip.loadAsync(await fundedPptx.arrayBuffer());
const fundedSlideXml = await getSlideXml(fundedZip, 13);
assert.ok(
  fundedSlideXml.every(
    (xml) => xml.includes("<p:sp>") && xml.includes("<a:t>"),
  ),
  "Every funded deck slide must retain editable text and shapes.",
);

console.log("PPTX smoke passed: 12-slide and 13-slide editable PowerPoints.");
