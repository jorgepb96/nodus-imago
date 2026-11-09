declare module "heic-decode" {
  export interface DecodedHeic {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  }
  export default function decode(input: {
    buffer: Buffer;
  }): Promise<DecodedHeic>;
}
