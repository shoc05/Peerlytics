// For tests only (dev dependencies; kept out of the image by Dockerfile.dockerignore):
// check a report against report.xsd with libxml2 (xmllint-wasm), and run report.xsl in Node.
import { readFileSync } from 'node:fs';
import { validateXML } from 'xmllint-wasm';
import { Xslt, XmlParser } from 'xslt-processor';

export const XSD = readFileSync(new URL('./report.xsd', import.meta.url), 'utf8');
export const XSL = readFileSync(new URL('./report.xsl', import.meta.url), 'utf8');

/** { valid, errors: string[] } */
export async function validate(xml) {
  const r = await validateXML({ xml: [{ fileName: 'report.xml', contents: xml }], schema: [{ fileName: 'report.xsd', contents: XSD }] });
  return { valid: r.valid, errors: r.errors.map((e) => e.rawMessage) };
}

/** The HTML report.xsl makes from `xml`. */
export async function toHtml(xml) {
  const parser = new XmlParser();
  return new Xslt().xsltProcess(parser.xmlParse(xml), parser.xmlParse(XSL));
}
