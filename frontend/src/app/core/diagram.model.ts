export interface DiagramSummary {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Diagram extends DiagramSummary {
  xml: string;
}

export interface DiagramRequest {
  name: string;
  xml: string;
}
