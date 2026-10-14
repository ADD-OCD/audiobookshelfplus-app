// PDF.js loading parameters for the PDF reader (components/readers/PdfReader.vue -> @teckel/vue-pdf -> getDocument).
// isEvalSupported: false is the upstream workaround for CVE-2024-4367 (GHSA-wgrm-67xf-hhpq) in pdfjs-dist 2.7.570:
// PDF.js then never compiles font glyph paths with eval/Function. It is a mitigation, not an upgrade of PDF.js.
// Every load (initial open and the reload after a token renewal) builds its parameters here, so the setting cannot be
// dropped when a load is rebuilt.
export function pdfDocumentParams(url, token) {
  return {
    url,
    httpHeaders: {
      Authorization: `Bearer ${token}`
    },
    isEvalSupported: false
  }
}
