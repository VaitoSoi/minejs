import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import stylistic from '@stylistic/eslint-plugin';
import { defineConfig } from "eslint/config";

export default defineConfig([
    ...tseslint.configs.recommended,
    ...tseslint.configs.strict,
    {
        files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
        plugins: { 
            js, 
            "@stylistic": stylistic 
        },
        extends: ["js/recommended"],
        languageOptions: { globals: globals.node },
        rules: {
            indent: ['warn', 4, { SwitchCase: 1 }],
            "semi": ["warn", "always"],
            "@typescript-eslint/no-explicit-any": ["off"],
            "@typescript-eslint/no-non-null-assertion": ["off"],
            "@typescript-eslint/no-unused-vars": ["off"],
            "no-unused-vars": ["off"]
        }
    },
    { ignores: ["build/", "node_modules", ".yarn", ".vscode", ".pnp.*"] },
]);
