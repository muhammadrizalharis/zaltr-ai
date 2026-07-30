declare module "pdf-parse/lib/pdf-parse.js" {
  const pdfParse: (buf: Buffer) => Promise<{ text: string }>;
  export default pdfParse;
}
