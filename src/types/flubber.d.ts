declare module 'flubber' {
  export type Shape = string | Array<[number, number]>;
  export type Interpolator = (t: number) => string;
  export function interpolate(
    fromShape: Shape,
    toShape: Shape,
    options?: { maxSegmentLength?: number | false; string?: boolean },
  ): Interpolator;
}
