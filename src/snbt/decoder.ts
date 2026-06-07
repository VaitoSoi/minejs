import { UnexpectedValue } from "../error";

export class Decoder {
    private offset = 0;

    constructor(private readonly source: string) { }

    private skipWhiteSpace() {
        while (this.offset < this.source.length) {
            // console.log({
            //     off: this.offset,
            //     ch: this.source[this.offset],
            //     a: this.source[this.offset] !== " ",
            //     b: this.source[this.offset] !== "\n"
            // });
            if (
                this.source[this.offset] !== " " &&
                this.source[this.offset] !== "," &&
                this.source[this.offset] !== "\n"
            ) return;
            this.offset += 1;
        }
        throw new UnexpectedValue("end of SNBT", "white space");
    }

    private convertValue(val: string): number | bigint | boolean | string {
        if (
            (!isNaN(Number(val))) ||
            val.endsWith("b") || val.endsWith("B") ||
            val.endsWith("s") || val.endsWith("S") ||
            val.endsWith("i") || val.endsWith("I") ||
            val.endsWith("F") || val.endsWith("F")
        ) return Number(val);
        if (
            val.endsWith("l") || val.endsWith("L") ||
            val.endsWith("d") || val.endsWith("D") ||
            BigInt(val) % BigInt(1) !== BigInt(0)
        ) return BigInt(val);
        if (val === "true") return true;
        if (val === "false") return false;
        if (
            (val.startsWith("'") && val.endsWith("'")) ||
            (val.startsWith('"') && val.endsWith("'"))
        ) return String(val.slice(1, -1));
        return val;
    }

    // eoc = End Of Compound
    private seek(): [fieldName: string, value: any] | undefined {
        this.skipWhiteSpace();

        if (this.source[this.offset] == "}")
            return undefined;

        let fieldName = "";
        let sliceQuote: "'" | '"' | undefined = undefined;
        let ch: string;
        if (this.source[this.offset] === "'" || this.source[this.offset] === '"') {
            sliceQuote = this.source[this.offset] as "'" | '"';
            this.offset++;
        }
        while (true) {
            ch = this.source[this.offset]!;
            if (
                ((sliceQuote == undefined && ch === ":") ||
                    (sliceQuote && ch === sliceQuote)) ||
                this.offset >= this.source.length
            ) {
                this.offset++;
                break;
            }
            fieldName += ch;
            this.offset++;
        }
        if (sliceQuote)
            this.offset++;

        this.skipWhiteSpace();

        let stringtifiedVal = "",
            convertedVal: any = undefined,
            type: "number" | "string_1" | "string_2" | "list" | "array" = "number";

        outer:
        while (true) {
            ch = this.source[this.offset]!;
            console.dir({ ch, type });

            switch (ch) {
                case "[":
                    type = "list";
                    break;

                // End of Array or Line
                case "]":
                    if (type === "array" || type === "list") {
                        this.offset++;
                        break outer;
                    }
                    stringtifiedVal += ch;
                    break;

                case ",":
                    if (type !== "array" && type !== "list") {
                        this.offset++;
                        break outer;
                    }
                    stringtifiedVal += ch;
                    break;

                // String indicator, if found repeated mean it is the end of the string
                case "'":
                    if (stringtifiedVal.endsWith("\\") || type == "list") {
                        stringtifiedVal += ch;
                        break;
                    }
                    if (type == "string_1") {
                        this.offset++;
                        break outer;
                    }
                    type = "string_1";
                    break;
                case '"':
                    if (stringtifiedVal.endsWith("\\") || type == "list") {
                        stringtifiedVal += ch;
                        break;
                    }
                    if (type == "string_2") {
                        this.offset++;
                        break outer;
                    }
                    type = "string_2";
                    break;

                // Array type indicator
                case "B":
                case "I":
                case "L":
                    type = "array";
                    this.offset++;
                    break;

                case "{":
                    if (type != "list") {
                        convertedVal = this.obj();
                        break outer;
                    } else {
                        stringtifiedVal += ch;
                        break;
                    }

                default:
                    if (ch === " " && type == "number") break outer;
                    stringtifiedVal += ch;
                    break;
            }

            this.offset++;
        }

        if (stringtifiedVal !== "" && !convertedVal) {
            if (type == "array")
                convertedVal = stringtifiedVal.split(",")
                    .map(val =>
                        this.convertValue(val.trim())
                    );
            else if (type == "list") {
                convertedVal = stringtifiedVal.split(",")
                    .map(val => {
                        val = val.trim();
                        if (val.startsWith("{") && val.endsWith("}")) {
                            const decoder = new Decoder(val);
                            const obj = decoder.decode();
                            if (
                                Object.keys(obj).length != 1 ||
                                !("" in obj)
                            ) return obj;
                            return obj[""];
                        } else return this.convertValue(val);
                    });
            } else {
                if (type == "string_1" || type == "string_2")
                    convertedVal = stringtifiedVal;
                else
                    convertedVal = this.convertValue(stringtifiedVal);
            }
        }

        return [fieldName, convertedVal];
    }

    private obj() {
        if (this.source[this.offset] !== "{")
            throw new UnexpectedValue("start of compound", "{", this.source[this.offset]);
        this.offset++;
        const obj: Record<string, any> = {};
        while (this.offset < this.source.length) {
            const val = this.seek();
            if (!val) break;

            const [fieldName, fieldVal] = val;
            obj[fieldName] = fieldVal;
        }
        return obj;
    }


    public decode() {
        return this.obj();
    }
}