declare module 'bpmn-js/lib/Modeler' {
  export interface BpmnImportResult {
    warnings: unknown[];
  }
  export interface SaveXMLOptions {
    format?: boolean;
  }
  export interface SaveXMLResult {
    xml: string;
  }
  export interface SaveSVGResult {
    svg: string;
  }
  export default class BpmnModeler {
    constructor(options: { container: HTMLElement | string });
    importXML(xml: string): Promise<BpmnImportResult>;
    saveXML(options?: SaveXMLOptions): Promise<SaveXMLResult>;
    saveSVG(): Promise<SaveSVGResult>;
    get<T = unknown>(module: string): T;
    destroy(): void;
  }
}

declare module 'bpmn-js/lib/NavigatedViewer' {
  export interface BpmnImportResult {
    warnings: unknown[];
  }
  export interface SaveSVGResult {
    svg: string;
  }
  export default class NavigatedViewer {
    constructor(options: { container: HTMLElement | string });
    importXML(xml: string): Promise<BpmnImportResult>;
    saveSVG(): Promise<SaveSVGResult>;
    get<T = unknown>(module: string): T;
    destroy(): void;
  }
}
