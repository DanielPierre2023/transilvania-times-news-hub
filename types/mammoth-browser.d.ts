// Ambient declaration for mammoth's browser build, which ships no .d.ts.
// Only the surface used by the Birou editorial .docx import is declared.
declare module 'mammoth/mammoth.browser' {
  export interface ConvertInput {
    arrayBuffer: ArrayBuffer
  }
  export interface ConvertResult {
    value: string
    messages: Array<{ type: string; message: string }>
  }
  export function convertToHtml(input: ConvertInput): Promise<ConvertResult>
  const _default: { convertToHtml: typeof convertToHtml }
  export default _default
}
