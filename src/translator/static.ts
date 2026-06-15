export const SEGMENT_BITS = 0x7F;
export const CONTINUE_BIT = 0x80;

export enum Tag {
    End = 0x00,
    Byte = 0x01,
    Short = 0x02,
    Int = 0x03,
    Long = 0x04,
    Float = 0x05,
    Double = 0x06,
    ByteArray = 0x07,
    String = 0x08,
    List = 0x09,
    Compound = 0x0A,
    IntArray = 0x0B,
    LongArray = 0x0C,
}

export type FixedSizeTag = Extract<Tag,
    Tag.Byte
    | Tag.Short
    | Tag.Int
    | Tag.Long
    | Tag.Float
    | Tag.Double>;

export const isTag = (tag: any): tag is Tag =>
    Object.keys(Tag).includes(tag);

export const isFixedSizeTag = (tag: Tag): tag is FixedSizeTag =>
    isTag(tag) && (
        tag === Tag.Byte ||
        tag === Tag.Short ||
        tag === Tag.Int ||
        tag === Tag.Long ||
        tag === Tag.Float ||
        tag === Tag.Double
    );