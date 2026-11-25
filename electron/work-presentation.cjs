const { createRequire } = require("node:module");

async function writePresentation(deck) {
  const Zip = createRequire(require.resolve("pptxgenjs"))("jszip");
  const archive = await Zip.loadAsync(await deck.write({ outputType: "nodebuffer" }));
  const wordBreak = ' eaLnBrk="0" latinLnBrk="0"';
  // The presentation library does not expose the DrawingML paragraph line-break settings.
  await Promise.all(archive.file(/^ppt\/slides\/slide\d+\.xml$/).map(async (slide) => {
    const xml = (await slide.async("string"))
      .replace(/<a:pPr(?=[\s/>])([^>]*?)(\/?)>/g, (_tag, attributes, closing) =>
        "<a:pPr" + attributes.replace(/\s+(?:eaLnBrk|latinLnBrk)="[^"]*"/g, "") + wordBreak + closing + ">")
      .replace(/<a:p>(?!<a:pPr[\s/>])/g, "<a:p><a:pPr" + wordBreak + "/>");
    archive.file(slide.name, xml);
  }));
  return archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

module.exports = { writePresentation };
