export type BirFormAlign = "left" | "right" | "center";

export type BirFormCoord = {
  page: number;
  x: number;
  y: number;
  fontSize: number;
  maxWidth: number;
  align: BirFormAlign;
};

export type BirFormCoordWithMeta = BirFormCoord & {
  key: string;
  label: string;
  sourceText: string;
};
