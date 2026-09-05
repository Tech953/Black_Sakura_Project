export interface ISize {
  width: number;
  height: number;
  type?: string;
}

export function imageSize(input: Uint8Array | string, callback?: (error: Error | null, dimensions?: ISize) => void): ISize | void;
export function disableFS(value: boolean): void;
export function disableTypes(types: string[]): void;
export function setConcurrency(value: number): void;
export const types: string[];
export default imageSize;