/**
 * Minimal ambient typings for the `transformation-matrix` package (v3 ships
 * no TypeScript declarations). Only the surface `@suna/canvas` uses.
 */
declare module 'transformation-matrix' {
  export interface Matrix {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
  }

  /** Parsed transform-attribute descriptor (translate/scale/rotate/matrix/…). */
  export interface MatrixDescriptor {
    type: string;
    [key: string]: unknown;
  }

  export function identity(): Matrix;
  export function compose(...matrices: Array<Matrix | Matrix[]>): Matrix;
  export function inverse(matrix: Matrix): Matrix;
  export function translate(tx: number, ty?: number): Matrix;
  export function scale(sx: number, sy?: number, cx?: number, cy?: number): Matrix;
  export function applyToPoint(
    matrix: Matrix,
    point: { x: number; y: number },
  ): { x: number; y: number };
  export function fromDefinition(descriptors: MatrixDescriptor[]): Matrix[];
  export function fromTransformAttribute(transformString: string): MatrixDescriptor[];
  export function toSVG(matrix: Matrix): string;
}
